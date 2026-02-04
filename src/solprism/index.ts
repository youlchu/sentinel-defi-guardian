/**
 * SOLPRISM Integration for SENTINEL DeFi Risk Guardian
 *
 * Wraps every risk decision in a cryptographic commit-reveal cycle so that
 * SENTINEL's reasoning is provably recorded *before* market conditions change.
 *
 * Flow:
 *   1. SENTINEL evaluates a position → produces a RiskReasoningContext
 *   2. commitRiskDecision() hashes the context and writes the hash onchain
 *   3. SENTINEL executes the action (alert, rebalance, etc.)
 *   4. revealRiskDecision() publishes the full reasoning onchain
 *
 * Anyone can later verify that the reasoning was committed before the action
 * by checking the onchain timestamp and hash.
 *
 * @see https://www.solprism.app/
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import {
  RiskReasoningContext,
  RiskActionType,
  SentinelCommitRecord,
  SolprismIntegrationConfig,
} from './types';
import { RiskScore, LiquidationPrediction } from '../risk/riskEngine';
import { Position } from '../monitor/positionMonitor';

// ─── Constants ────────────────────────────────────────────────────────────

const SOLPRISM_PROGRAM_ID = 'CZcvoryaQNrtZ3qb3gC1h9opcYpzEP1D9Mu1RVwFQeBu';
const SOLPRISM_EXPLORER = 'https://www.solprism.app';

// ─── Hashing ──────────────────────────────────────────────────────────────

/**
 * Hash a risk reasoning context into a 32-byte commitment hash.
 * Uses the same canonical JSON → SHA-256 approach as the SOLPRISM SDK.
 */
function hashReasoningContext(context: RiskReasoningContext): Buffer {
  const canonical = JSON.stringify(context, Object.keys(context).sort());
  return createHash('sha256').update(canonical).digest();
}

function hashReasoningContextHex(context: RiskReasoningContext): string {
  return hashReasoningContext(context).toString('hex');
}

// ─── Main Integration Class ──────────────────────────────────────────────

/**
 * SolprismRiskGuard — the bridge between SENTINEL and SOLPRISM.
 *
 * Drop-in module that wraps SENTINEL's risk decisions with onchain
 * commit-reveal reasoning. Every alert, prediction, and rebalance
 * action gets a verifiable audit trail.
 *
 * @example
 * ```typescript
 * const guard = new SolprismRiskGuard({
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   agentName: 'SENTINEL-Guardian',
 *   autoReveal: true,
 *   enabled: true,
 * });
 *
 * await guard.initialize(walletKeypair);
 *
 * // Wrap a risk assessment
 * const record = await guard.commitRiskDecision(position, riskScore, 'warning_alert');
 * // ... SENTINEL sends the alert ...
 * await guard.revealRiskDecision(record.commitmentAddress);
 * ```
 */
export class SolprismRiskGuard {
  private config: SolprismIntegrationConfig;
  private connection: Connection;
  private wallet?: Keypair;
  private agentRegistered: boolean = false;
  private programId: PublicKey;

  /** Local store of pending commitments (not yet revealed) */
  private pendingCommitments: Map<string, SentinelCommitRecord> = new Map();

  /** Full history of all commitments this session */
  private commitmentHistory: SentinelCommitRecord[] = [];

  constructor(config: SolprismIntegrationConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.programId = new PublicKey(config.programId || SOLPRISM_PROGRAM_ID);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Initialize the SOLPRISM guard with a wallet keypair.
   * Registers the agent onchain if not already registered.
   */
  async initialize(wallet: Keypair): Promise<void> {
    if (!this.config.enabled) {
      console.log('[SOLPRISM] Integration disabled — running without onchain commitments');
      return;
    }

    this.wallet = wallet;
    console.log(`[SOLPRISM] Initializing with authority: ${wallet.publicKey.toBase58()}`);
    console.log(`[SOLPRISM] Program: ${this.programId.toBase58()}`);
    console.log(`[SOLPRISM] Explorer: ${SOLPRISM_EXPLORER}`);

    // Check if agent is already registered
    try {
      const agentPda = this.deriveAgentPDA(wallet.publicKey);
      const accountInfo = await this.connection.getAccountInfo(agentPda);

      if (accountInfo) {
        console.log(`[SOLPRISM] Agent already registered at ${agentPda.toBase58()}`);
        this.agentRegistered = true;
      } else {
        console.log('[SOLPRISM] Agent not registered — will register on first commit');
      }
    } catch (error) {
      console.warn('[SOLPRISM] Could not check agent registration:', error);
    }
  }

  /**
   * Check whether the guard is active and ready to commit.
   */
  isActive(): boolean {
    return this.config.enabled && this.wallet !== undefined;
  }

  // ─── Commit ───────────────────────────────────────────────────────────

  /**
   * Commit a risk decision onchain *before* executing the action.
   *
   * This is the core trust primitive: the hash of SENTINEL's full reasoning
   * is recorded onchain with a timestamp that proves it existed before
   * the market moved or the action was taken.
   *
   * @param position - The DeFi position being evaluated
   * @param riskScore - The computed risk score
   * @param actionType - What action SENTINEL is about to take
   * @param prediction - Optional liquidation prediction
   * @returns A commit record, or null if SOLPRISM is disabled
   */
  async commitRiskDecision(
    position: Position,
    riskScore: RiskScore,
    actionType: RiskActionType,
    prediction?: LiquidationPrediction,
  ): Promise<SentinelCommitRecord | null> {
    if (!this.isActive()) {
      return null;
    }

    // Build the reasoning context
    const reasoning: RiskReasoningContext = {
      actionType,
      positionId: position.id,
      protocol: position.protocol,
      riskScore: {
        healthFactor: riskScore.healthFactor,
        riskLevel: riskScore.riskLevel,
        collateralRatio: riskScore.collateralRatio,
        volatilityScore: riskScore.volatilityScore,
        liquidationPrice: riskScore.liquidationPrice,
        currentPrice: riskScore.currentPrice,
        distanceToLiquidation: riskScore.distanceToLiquidation,
      },
      prediction: prediction
        ? {
            probability: prediction.probability,
            minutesToLiquidation: prediction.minutesToLiquidation,
            confidence: prediction.confidence,
            factors: prediction.factors,
          }
        : undefined,
      decision: this.describeDecision(actionType, riskScore),
      confidence: this.computeConfidence(riskScore, prediction),
      timestamp: Date.now(),
    };

    // Hash the reasoning
    const commitmentHash = hashReasoningContext(reasoning);
    const commitmentHashHex = commitmentHash.toString('hex');

    console.log(`[SOLPRISM] Committing ${actionType} reasoning for position ${position.id}`);
    console.log(`[SOLPRISM] Hash: ${commitmentHashHex}`);

    try {
      // Build and send the commit transaction
      const result = await this.sendCommitTransaction(
        commitmentHash,
        actionType,
        this.computeConfidence(riskScore, prediction),
      );

      const record: SentinelCommitRecord = {
        commitmentAddress: result.commitmentAddress,
        commitTxSignature: result.signature,
        commitmentHash: commitmentHashHex,
        reasoning,
        slot: result.slot,
        revealed: false,
      };

      // Store for later reveal
      this.pendingCommitments.set(record.commitmentAddress, record);
      this.commitmentHistory.push(record);

      console.log(`[SOLPRISM] ✅ Committed at slot ${result.slot}`);
      console.log(`[SOLPRISM]    Address: ${result.commitmentAddress}`);
      console.log(`[SOLPRISM]    Tx: ${result.signature}`);
      console.log(`[SOLPRISM]    View: ${SOLPRISM_EXPLORER}/commitment/${result.commitmentAddress}`);

      return record;
    } catch (error) {
      console.error('[SOLPRISM] ❌ Commitment failed:', error);
      // SENTINEL continues operating even if SOLPRISM commitment fails.
      // Risk protection is the priority; verifiability is a bonus.
      return null;
    }
  }

  // ─── Reveal ───────────────────────────────────────────────────────────

  /**
   * Reveal the full reasoning for a previously committed decision.
   *
   * Call this *after* the action (alert, rebalance, etc.) has executed.
   * The revealed reasoning URI is stored onchain, allowing anyone to
   * fetch the full analysis and verify the hash matches.
   *
   * @param commitmentAddress - The commitment PDA to reveal
   * @param reasoningUri - Optional override URI (defaults to auto-generated)
   * @returns Updated commit record, or null if not found
   */
  async revealRiskDecision(
    commitmentAddress: string,
    reasoningUri?: string,
  ): Promise<SentinelCommitRecord | null> {
    if (!this.isActive()) {
      return null;
    }

    const record = this.pendingCommitments.get(commitmentAddress);
    if (!record) {
      console.warn(`[SOLPRISM] No pending commitment found for ${commitmentAddress}`);
      return null;
    }

    // Generate reasoning URI if not provided
    const uri = reasoningUri || this.generateReasoningUri(record);

    console.log(`[SOLPRISM] Revealing reasoning for ${commitmentAddress}`);
    console.log(`[SOLPRISM] URI: ${uri}`);

    try {
      const signature = await this.sendRevealTransaction(commitmentAddress, uri);

      record.revealed = true;
      record.revealTxSignature = signature;
      record.revealUri = uri;

      // Remove from pending
      this.pendingCommitments.delete(commitmentAddress);

      console.log(`[SOLPRISM] ✅ Revealed — tx: ${signature}`);
      console.log(`[SOLPRISM]    Verify: ${SOLPRISM_EXPLORER}/verify/${commitmentAddress}`);

      return record;
    } catch (error) {
      console.error('[SOLPRISM] ❌ Reveal failed:', error);
      return null;
    }
  }

  /**
   * Reveal all pending commitments. Useful for batch cleanup
   * or when shutting down gracefully.
   */
  async revealAllPending(): Promise<number> {
    let revealed = 0;

    for (const [address] of this.pendingCommitments) {
      const result = await this.revealRiskDecision(address);
      if (result) revealed++;
    }

    console.log(`[SOLPRISM] Revealed ${revealed} pending commitments`);
    return revealed;
  }

  // ─── Convenience Wrappers ─────────────────────────────────────────────

  /**
   * Wrap a warning alert with commit-reveal reasoning.
   *
   * Call this instead of (or alongside) AlertSystem.sendWarningAlert().
   * Returns a record that can be revealed after the alert fires.
   */
  async commitWarningAlert(
    position: Position,
    riskScore: RiskScore,
  ): Promise<SentinelCommitRecord | null> {
    return this.commitRiskDecision(position, riskScore, 'warning_alert');
  }

  /**
   * Wrap a critical alert with commit-reveal reasoning.
   */
  async commitCriticalAlert(
    position: Position,
    riskScore: RiskScore,
  ): Promise<SentinelCommitRecord | null> {
    return this.commitRiskDecision(position, riskScore, 'critical_alert');
  }

  /**
   * Wrap a liquidation prediction with commit-reveal reasoning.
   */
  async commitLiquidationPrediction(
    position: Position,
    riskScore: RiskScore,
    prediction: LiquidationPrediction,
  ): Promise<SentinelCommitRecord | null> {
    return this.commitRiskDecision(position, riskScore, 'liquidation_prediction', prediction);
  }

  /**
   * Wrap a position rebalance decision with commit-reveal reasoning.
   */
  async commitRebalanceDecision(
    position: Position,
    riskScore: RiskScore,
  ): Promise<SentinelCommitRecord | null> {
    return this.commitRiskDecision(position, riskScore, 'position_rebalance');
  }

  // ─── Query ────────────────────────────────────────────────────────────

  /**
   * Get all commitment records from this session.
   */
  getCommitmentHistory(): SentinelCommitRecord[] {
    return [...this.commitmentHistory];
  }

  /**
   * Get commitments that haven't been revealed yet.
   */
  getPendingCommitments(): SentinelCommitRecord[] {
    return Array.from(this.pendingCommitments.values());
  }

  /**
   * Get a specific commitment record by address.
   */
  getCommitment(commitmentAddress: string): SentinelCommitRecord | undefined {
    return (
      this.pendingCommitments.get(commitmentAddress) ||
      this.commitmentHistory.find((r) => r.commitmentAddress === commitmentAddress)
    );
  }

  /**
   * Get the SOLPRISM explorer URL for a commitment.
   */
  getExplorerUrl(commitmentAddress: string): string {
    return `${SOLPRISM_EXPLORER}/commitment/${commitmentAddress}`;
  }

  /**
   * Get the verification URL for a commitment.
   */
  getVerifyUrl(commitmentAddress: string): string {
    return `${SOLPRISM_EXPLORER}/verify/${commitmentAddress}`;
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────

  /**
   * Derive the agent PDA for a given authority.
   */
  private deriveAgentPDA(authority: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), authority.toBuffer()],
      this.programId,
    );
    return pda;
  }

  /**
   * Derive the commitment PDA for a given agent + nonce.
   */
  private deriveCommitmentPDA(agentProfile: PublicKey, nonce: number): PublicKey {
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(BigInt(nonce));
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('commitment'), agentProfile.toBuffer(), nonceBuf],
      this.programId,
    );
    return pda;
  }

  /**
   * Build a human-readable decision description from the risk action.
   */
  private describeDecision(actionType: RiskActionType, riskScore: RiskScore): string {
    switch (actionType) {
      case 'risk_assessment':
        return `Assessed position risk as ${riskScore.riskLevel} (health: ${riskScore.healthFactor.toFixed(3)})`;
      case 'warning_alert':
        return `Issuing warning alert — health factor ${riskScore.healthFactor.toFixed(3)} below warning threshold`;
      case 'critical_alert':
        return `Issuing CRITICAL alert — health factor ${riskScore.healthFactor.toFixed(3)} at immediate liquidation risk`;
      case 'liquidation_prediction':
        return `Predicted liquidation risk — health factor ${riskScore.healthFactor.toFixed(3)}, distance to liquidation ${riskScore.distanceToLiquidation.toFixed(1)}%`;
      case 'position_rebalance':
        return `Triggering position rebalance to improve health factor from ${riskScore.healthFactor.toFixed(3)}`;
      case 'emergency_action':
        return `EMERGENCY: Taking protective action — health factor ${riskScore.healthFactor.toFixed(3)} critically low`;
      default:
        return `Risk action: ${actionType}`;
    }
  }

  /**
   * Compute a 0-100 confidence score from the risk analysis.
   */
  private computeConfidence(
    riskScore: RiskScore,
    prediction?: LiquidationPrediction,
  ): number {
    // Base confidence from risk level certainty
    let confidence = 70;

    // Higher confidence when risk is clearly in one direction
    if (riskScore.healthFactor < 1.05 || riskScore.healthFactor > 2.0) {
      confidence += 15; // Clear signal
    }

    // Prediction confidence contributes if available
    if (prediction) {
      confidence = Math.round((confidence + prediction.confidence * 100) / 2);
    }

    // Clamp to 0-100
    return Math.min(100, Math.max(0, confidence));
  }

  /**
   * Generate a reasoning URI for onchain reveal.
   * In production, this would upload to IPFS/Arweave.
   */
  private generateReasoningUri(record: SentinelCommitRecord): string {
    const base = this.config.storageBaseUri || 'https://sentinel.risk/reasoning';
    return `${base}/${record.commitmentHash}`;
  }

  // ─── Transaction Builders ─────────────────────────────────────────────

  /**
   * Encode a string in Borsh format: [u32 length][utf8 bytes]
   */
  private encodeString(s: string): Buffer {
    const bytes = Buffer.from(s, 'utf-8');
    const buf = Buffer.alloc(4 + bytes.length);
    buf.writeUInt32LE(bytes.length, 0);
    bytes.copy(buf, 4);
    return buf;
  }

  /**
   * Encode a u64 as 8 bytes LE.
   */
  private encodeU64(n: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(n));
    return buf;
  }

  /**
   * Send the commit_reasoning transaction.
   */
  private async sendCommitTransaction(
    commitmentHash: Buffer,
    actionType: string,
    confidence: number,
  ): Promise<{ signature: string; commitmentAddress: string; slot: number }> {
    if (!this.wallet) throw new Error('Wallet not initialized');

    const { Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } =
      await import('@solana/web3.js');

    const authority = this.wallet.publicKey;
    const agentProfile = this.deriveAgentPDA(authority);

    // Get current nonce from agent profile
    let nonce = 0;
    try {
      const agentInfo = await this.connection.getAccountInfo(agentProfile);
      if (agentInfo && agentInfo.data.length >= 82) {
        // Read total_commitments (u64) at offset 8 + 32 (authority) + 4 + name_len
        // Simplified: just scan for the nonce field
        nonce = Number(agentInfo.data.readBigUInt64LE(44));
      }
    } catch {
      nonce = 0;
    }

    const commitmentAddress = this.deriveCommitmentPDA(agentProfile, nonce);

    // Instruction discriminator for commit_reasoning
    const discriminator = Buffer.from([163, 80, 25, 135, 94, 49, 218, 44]);

    const data = Buffer.concat([
      discriminator,
      commitmentHash,                          // [u8; 32]
      this.encodeString(actionType),            // String
      Buffer.from([confidence]),                // u8
      this.encodeU64(nonce),                    // u64
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: commitmentAddress, isSigner: false, isWritable: true },
        { pubkey: agentProfile, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });

    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.wallet], {
      commitment: 'confirmed',
    });

    // Fetch slot
    const status = await this.connection.getSignatureStatus(signature);
    const slot = status?.value?.slot ?? 0;

    return {
      signature,
      commitmentAddress: commitmentAddress.toBase58(),
      slot,
    };
  }

  /**
   * Send the reveal_reasoning transaction.
   */
  private async sendRevealTransaction(
    commitmentAddress: string,
    reasoningUri: string,
  ): Promise<string> {
    if (!this.wallet) throw new Error('Wallet not initialized');

    const { Transaction, TransactionInstruction, PublicKey: PK, sendAndConfirmTransaction } =
      await import('@solana/web3.js');

    const authority = this.wallet.publicKey;
    const agentProfile = this.deriveAgentPDA(authority);
    const commitPubkey = new PK(commitmentAddress);

    // Instruction discriminator for reveal_reasoning
    const discriminator = Buffer.from([76, 215, 6, 241, 209, 207, 84, 96]);

    const data = Buffer.concat([discriminator, this.encodeString(reasoningUri)]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: commitPubkey, isSigner: false, isWritable: true },
        { pubkey: agentProfile, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
      ],
      programId: this.programId,
      data,
    });

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.wallet], {
      commitment: 'confirmed',
    });
  }
}

export { RiskReasoningContext, RiskActionType, SentinelCommitRecord, SolprismIntegrationConfig } from './types';

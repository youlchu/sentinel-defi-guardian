/**
 * SOLPRISM Risk Verifier for SENTINEL
 *
 * Standalone module for verifying that SENTINEL's risk decisions
 * match their onchain commitments. This can be used by:
 *
 * - External auditors reviewing SENTINEL's decision history
 * - Other agents that depend on SENTINEL's risk assessments
 * - Post-incident analysis of risk management failures
 * - Regulatory compliance demonstrations
 *
 * The verifier is read-only — it never submits transactions.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import { RiskReasoningContext } from './types';

const SOLPRISM_PROGRAM_ID = 'CZcvoryaQNrtZ3qb3gC1h9opcYpzEP1D9Mu1RVwFQeBu';

// Account discriminator for ReasoningCommitment
const COMMITMENT_DISCRIMINATOR = Buffer.from([67, 22, 65, 98, 26, 124, 5, 25]);

/**
 * Result of verifying a risk reasoning commitment.
 */
export interface RiskVerificationResult {
  /** Whether the reasoning matches the onchain commitment */
  valid: boolean;

  /** Human-readable summary */
  message: string;

  /** The hash computed from the provided reasoning */
  computedHash: string;

  /** The hash stored onchain */
  storedHash: string;

  /** Onchain commitment details */
  onchain: {
    /** The action type recorded onchain */
    actionType: string;

    /** Confidence recorded onchain (0-100) */
    confidence: number;

    /** Unix timestamp of the commitment */
    timestamp: number;

    /** Whether the commitment has been revealed */
    revealed: boolean;

    /** Reasoning URI (if revealed) */
    reasoningUri: string | null;
  } | null;
}

/**
 * Verify a SENTINEL risk decision against its onchain SOLPRISM commitment.
 *
 * @param connection - Solana RPC connection
 * @param commitmentAddress - The onchain commitment PDA
 * @param reasoning - The full risk reasoning to verify
 * @returns Verification result with match status and details
 *
 * @example
 * ```typescript
 * import { verifyRiskDecision } from './solprism/verifier';
 *
 * const result = await verifyRiskDecision(
 *   connection,
 *   'CommitmentPDAAddress...',
 *   reasoningContext,
 * );
 *
 * if (result.valid) {
 *   console.log('✅ Risk decision verified — reasoning matches onchain commitment');
 * } else {
 *   console.log('❌ Mismatch — reasoning does not match commitment');
 * }
 * ```
 */
export async function verifyRiskDecision(
  connection: Connection,
  commitmentAddress: string,
  reasoning: RiskReasoningContext,
  programId: string = SOLPRISM_PROGRAM_ID,
): Promise<RiskVerificationResult> {
  // Hash the provided reasoning
  const canonical = JSON.stringify(reasoning, Object.keys(reasoning).sort());
  const computedHash = createHash('sha256').update(canonical).digest('hex');

  // Fetch the onchain commitment
  try {
    const pubkey = new PublicKey(commitmentAddress);
    const accountInfo = await connection.getAccountInfo(pubkey);

    if (!accountInfo || !accountInfo.data) {
      return {
        valid: false,
        message: 'Commitment account not found onchain',
        computedHash,
        storedHash: '',
        onchain: null,
      };
    }

    const data = Buffer.from(accountInfo.data);

    // Verify discriminator
    if (!data.slice(0, 8).equals(COMMITMENT_DISCRIMINATOR)) {
      return {
        valid: false,
        message: 'Account is not a SOLPRISM ReasoningCommitment',
        computedHash,
        storedHash: '',
        onchain: null,
      };
    }

    // Parse the commitment account
    let offset = 8;

    // agent: Pubkey (32 bytes)
    offset += 32;

    // authority: Pubkey (32 bytes)
    offset += 32;

    // commitment_hash: [u8; 32]
    const storedHashBytes = data.slice(offset, offset + 32);
    const storedHash = storedHashBytes.toString('hex');
    offset += 32;

    // action_type: String (4-byte len + utf8)
    const actionTypeLen = data.readUInt32LE(offset);
    offset += 4;
    const actionType = data.slice(offset, offset + actionTypeLen).toString('utf-8');
    offset += actionTypeLen;

    // confidence: u8
    const confidence = data[offset];
    offset += 1;

    // timestamp: i64
    const timestamp = Number(data.readBigInt64LE(offset));
    offset += 8;

    // revealed: bool
    const revealed = data[offset] === 1;
    offset += 1;

    // reasoning_uri: String
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const reasoningUri = uriLen > 0 ? data.slice(offset, offset + uriLen).toString('utf-8') : null;

    // Compare hashes
    const valid = computedHash === storedHash;

    return {
      valid,
      message: valid
        ? '✅ Risk decision verified — the reasoning matches the onchain commitment'
        : '❌ Mismatch — the provided reasoning does not match the onchain commitment',
      computedHash,
      storedHash,
      onchain: {
        actionType,
        confidence,
        timestamp,
        revealed,
        reasoningUri,
      },
    };
  } catch (error) {
    return {
      valid: false,
      message: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
      computedHash,
      storedHash: '',
      onchain: null,
    };
  }
}

/**
 * Fetch all SENTINEL commitments for an agent authority.
 * Useful for auditing the full decision history.
 *
 * @param connection - Solana RPC connection
 * @param authority - The agent authority public key
 * @param programId - SOLPRISM program ID
 * @returns Array of commitment addresses and their onchain data
 */
export async function fetchSentinelCommitments(
  connection: Connection,
  authority: string,
  programId: string = SOLPRISM_PROGRAM_ID,
): Promise<
  Array<{
    address: string;
    actionType: string;
    confidence: number;
    timestamp: number;
    revealed: boolean;
    reasoningUri: string | null;
    commitmentHash: string;
  }>
> {
  const programPubkey = new PublicKey(programId);
  const authorityPubkey = new PublicKey(authority);

  // Derive agent PDA
  const [agentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), authorityPubkey.toBuffer()],
    programPubkey,
  );

  // Fetch all commitment accounts for this agent
  const accounts = await connection.getProgramAccounts(programPubkey, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: Buffer.from(COMMITMENT_DISCRIMINATOR).toString('base64'),
          encoding: 'base64' as any,
        },
      },
      {
        memcmp: {
          offset: 8, // agent field after discriminator
          bytes: agentPda.toBase58(),
        },
      },
    ],
  });

  return accounts.map((acc) => {
    const data = Buffer.from(acc.account.data);
    let offset = 8 + 32 + 32; // skip discriminator + agent + authority

    const commitmentHash = data.slice(offset, offset + 32).toString('hex');
    offset += 32;

    const actionTypeLen = data.readUInt32LE(offset);
    offset += 4;
    const actionType = data.slice(offset, offset + actionTypeLen).toString('utf-8');
    offset += actionTypeLen;

    const confidence = data[offset];
    offset += 1;

    const timestamp = Number(data.readBigInt64LE(offset));
    offset += 8;

    const revealed = data[offset] === 1;
    offset += 1;

    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const reasoningUri = uriLen > 0 ? data.slice(offset, offset + uriLen).toString('utf-8') : null;

    return {
      address: acc.pubkey.toBase58(),
      actionType,
      confidence,
      timestamp,
      revealed,
      reasoningUri,
      commitmentHash,
    };
  });
}

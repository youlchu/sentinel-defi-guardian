/**
 * SOLPRISM integration types for SENTINEL DeFi Risk Guardian.
 *
 * These types map SENTINEL's risk domain concepts (health factors,
 * liquidation predictions, alert levels) into SOLPRISM reasoning traces
 * that can be committed and verified onchain.
 */

import { RiskScore, LiquidationPrediction } from '../risk/riskEngine';

// ─── Risk Action Types ────────────────────────────────────────────────────

/**
 * Every risk decision SENTINEL can make, mapped to a SOLPRISM action type.
 * These strings are stored onchain in the commitment account.
 */
export type RiskActionType =
  | 'risk_assessment'
  | 'warning_alert'
  | 'critical_alert'
  | 'liquidation_prediction'
  | 'position_rebalance'
  | 'emergency_action';

// ─── Reasoning Context ────────────────────────────────────────────────────

/**
 * The full reasoning context that SENTINEL commits before taking action.
 * This is hashed and committed onchain *before* the action executes,
 * so no one can claim the reasoning was fabricated after the fact.
 */
export interface RiskReasoningContext {
  /** Which SENTINEL action triggered this reasoning */
  actionType: RiskActionType;

  /** The position being evaluated */
  positionId: string;

  /** Which DeFi protocol (marginfi, kamino, drift) */
  protocol: string;

  /** Full risk score at decision time */
  riskScore: {
    healthFactor: number;
    riskLevel: string;
    collateralRatio: number;
    volatilityScore: number;
    liquidationPrice: number;
    currentPrice: number;
    distanceToLiquidation: number;
  };

  /** Liquidation prediction, if computed */
  prediction?: {
    probability: number;
    minutesToLiquidation: number;
    confidence: number;
    factors: string[];
  };

  /** The decision SENTINEL made based on this analysis */
  decision: string;

  /** Confidence in the decision (0-100) */
  confidence: number;

  /** Unix timestamp when reasoning was produced */
  timestamp: number;
}

// ─── Commitment Records ───────────────────────────────────────────────────

/**
 * A completed commitment record, stored locally for later reveal.
 */
export interface SentinelCommitRecord {
  /** Onchain commitment PDA address */
  commitmentAddress: string;

  /** Transaction signature of the commit */
  commitTxSignature: string;

  /** SHA-256 hash of the reasoning trace */
  commitmentHash: string;

  /** The full reasoning context (kept locally until reveal) */
  reasoning: RiskReasoningContext;

  /** Slot at which the commitment was confirmed */
  slot: number;

  /** Whether this commitment has been revealed */
  revealed: boolean;

  /** Transaction signature of the reveal (if revealed) */
  revealTxSignature?: string;

  /** URI where revealed reasoning is stored */
  revealUri?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────

/**
 * Configuration for the SOLPRISM integration layer.
 */
export interface SolprismIntegrationConfig {
  /** Solana RPC endpoint */
  rpcUrl: string;

  /** Path to the agent's keypair JSON file */
  keypairPath?: string;

  /** Agent display name for SOLPRISM registration */
  agentName: string;

  /** Whether to auto-reveal after each action completes */
  autoReveal: boolean;

  /** Base URI for storing revealed reasoning (e.g. IPFS gateway, Arweave) */
  storageBaseUri?: string;

  /** SOLPRISM program ID override (defaults to mainnet program) */
  programId?: string;

  /** Whether SOLPRISM integration is enabled */
  enabled: boolean;
}

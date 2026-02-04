# SOLPRISM Integration — Verifiable Risk Reasoning for SENTINEL

> **Every risk decision SENTINEL makes is now provably committed onchain before the market moves.**

## Overview

SENTINEL is an autonomous DeFi risk guardian that monitors lending positions across Marginfi, Kamino, and Drift. It calculates risk scores, predicts liquidations, and fires alerts — all in real time.

But how do you *trust* that SENTINEL's risk reasoning was genuine and not fabricated after the fact?

**SOLPRISM** solves this with a commit-reveal protocol on Solana:

1. **Before** SENTINEL takes any action (alert, rebalance trigger, etc.), it hashes its full reasoning and commits the hash onchain
2. **After** the action executes, it reveals the full reasoning
3. **Anyone** can verify that the reasoning hash matches the commitment — proving it existed *before* the action

This creates a **tamper-proof audit trail** for every risk decision.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         SENTINEL                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Position Monitor → Risk Engine → Alert System                   │
│         │                │              │                        │
│         │                │              │                        │
│         │         ┌──────▼──────┐       │                        │
│         │         │  SOLPRISM   │       │                        │
│         │         │ Risk Guard  │       │                        │
│         │         └──────┬──────┘       │                        │
│         │                │              │                        │
│         │    ┌───────────▼───────────┐  │                        │
│         │    │   Commit-Reveal Flow  │  │                        │
│         │    │                       │  │                        │
│         │    │  1. Hash reasoning    │  │                        │
│         │    │  2. Commit hash ──────┼──┼──→ Solana (SOLPRISM)   │
│         │    │  3. Execute action ◄──┼──┘                        │
│         │    │  4. Reveal reasoning ─┼─────→ Solana (SOLPRISM)   │
│         │    └───────────────────────┘                           │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
   SOLPRISM Explorer (solprism.app)
   → View commitments
   → Verify reasoning
   → Audit decision history
```

## Quick Start

### 1. Install

```bash
npm install @solprism/sdk
```

### 2. Configure

Add to your `.env`:

```bash
# SOLPRISM Configuration
SOLPRISM_ENABLED=true
SOLPRISM_AGENT_NAME=SENTINEL-Guardian
SOLPRISM_AUTO_REVEAL=true
SOLPRISM_KEYPAIR_PATH=./sentinel-keypair.json
```

### 3. Initialize in SENTINEL

```typescript
import { SolprismRiskGuard } from './solprism';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';

// Load your agent's keypair
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync('./sentinel-keypair.json', 'utf-8')))
);

// Create the SOLPRISM guard
const solprismGuard = new SolprismRiskGuard({
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  agentName: 'SENTINEL-Guardian',
  autoReveal: true,
  enabled: true,
});

// Initialize (registers agent onchain if needed)
await solprismGuard.initialize(keypair);
```

### 4. Wrap Risk Decisions

```typescript
// In your monitoring loop, BEFORE sending an alert:
const commitRecord = await solprismGuard.commitRiskDecision(
  position,
  riskScore,
  'critical_alert',
  prediction,  // optional
);

// Send the alert as usual
await alertSystem.sendCriticalAlert(position, riskScore);

// AFTER the alert, reveal the reasoning
if (commitRecord) {
  await solprismGuard.revealRiskDecision(commitRecord.commitmentAddress);
}
```

## What Gets Committed

Every SOLPRISM commitment contains a hash of SENTINEL's full reasoning context:

```typescript
{
  actionType: 'critical_alert',
  positionId: 'ABC123...def',
  protocol: 'marginfi',
  riskScore: {
    healthFactor: 1.05,
    riskLevel: 'critical',
    collateralRatio: 105.0,
    volatilityScore: 0.042,
    liquidationPrice: 142.50,
    currentPrice: 149.80,
    distanceToLiquidation: 4.87,
  },
  prediction: {
    probability: 0.72,
    minutesToLiquidation: 18,
    confidence: 0.85,
    factors: [
      'Critical health factor (<1.1)',
      'High market volatility (>5%)',
      'Close to liquidation price (<10%)',
    ],
  },
  decision: 'Issuing CRITICAL alert — health factor 1.050 at immediate liquidation risk',
  confidence: 85,
  timestamp: 1738656000000,
}
```

This entire object is SHA-256 hashed and the hash is committed onchain. After the action executes, the full object is revealed, and anyone can verify:

```
SHA-256(canonical_json(reasoning)) === onchain_commitment_hash
```

## Supported Risk Actions

| Action Type | Trigger | Description |
|---|---|---|
| `risk_assessment` | Every evaluation cycle | Routine position risk scoring |
| `warning_alert` | Health < warning threshold | Position approaching danger zone |
| `critical_alert` | Health < critical threshold | Immediate liquidation risk |
| `liquidation_prediction` | ML prediction fires | Predicted liquidation within horizon |
| `position_rebalance` | Auto-rebalance trigger | Adjusting position to improve health |
| `emergency_action` | Health < 1.02 | Last-resort protective action |

## Verification

### Using the SOLPRISM Explorer

Visit [solprism.app](https://www.solprism.app) and paste any commitment address to:

- See when the commitment was made (slot + timestamp)
- View the revealed reasoning (if revealed)
- Verify the hash match independently

### Programmatic Verification

```typescript
import { verifyRiskDecision, fetchSentinelCommitments } from './solprism/verifier';

// Verify a single decision
const result = await verifyRiskDecision(
  connection,
  'CommitmentPDAAddress...',
  reasoningContext,
);

console.log(result.valid);    // true
console.log(result.message);  // ✅ Risk decision verified...

// Audit all SENTINEL decisions
const history = await fetchSentinelCommitments(connection, agentAuthority);
for (const commit of history) {
  console.log(`${commit.actionType} at ${new Date(commit.timestamp)} — revealed: ${commit.revealed}`);
}
```

## Why This Matters for DeFi Risk

### The Problem
AI-based risk guardians make hundreds of decisions per day. When a liquidation occurs, there's no way to prove the agent's reasoning was sound *at the time of the decision* — it could be fabricated post-hoc.

### The SOLPRISM Solution
- **Pre-commitment**: Risk reasoning is hashed and committed onchain *before* the action
- **Timestamped**: Solana slots provide immutable ordering — the commitment provably existed before the market moved
- **Verifiable**: Anyone can recompute the hash and verify it matches the onchain commitment
- **Auditable**: Full decision history is stored onchain and queryable

### Use Cases
- **Post-incident analysis**: When a position gets liquidated, verify that SENTINEL's warnings were issued with valid reasoning
- **Regulatory compliance**: Demonstrate that risk decisions followed a consistent, verifiable process
- **Agent accountability**: Build reputation through a track record of verified risk assessments
- **Multi-agent trust**: Other agents can verify SENTINEL's risk calls before acting on them

## SOLPRISM Program

| Field | Value |
|---|---|
| Program ID | `CZcvoryaQNrtZ3qb3gC1h9opcYpzEP1D9Mu1RVwFQeBu` |
| Network | Solana Devnet (mainnet deployment planned) |
| Explorer | [solprism.app](https://www.solprism.app) |
| SDK | `@solprism/sdk` v0.1.0 |

## Configuration Reference

| Env Variable | Default | Description |
|---|---|---|
| `SOLPRISM_ENABLED` | `false` | Enable/disable SOLPRISM integration |
| `SOLPRISM_AGENT_NAME` | `SENTINEL` | Agent display name on SOLPRISM |
| `SOLPRISM_AUTO_REVEAL` | `true` | Auto-reveal after each action |
| `SOLPRISM_KEYPAIR_PATH` | — | Path to agent keypair JSON |
| `SOLPRISM_PROGRAM_ID` | `CZcv...QeBu` | Override program ID |
| `SOLPRISM_STORAGE_URI` | — | Base URI for reasoning storage |

## API Reference

### `SolprismRiskGuard`

The main integration class. See [`src/solprism/index.ts`](../src/solprism/index.ts) for full JSDoc.

**Key methods:**

- `initialize(wallet)` — Register and activate the guard
- `commitRiskDecision(position, riskScore, actionType)` — Commit reasoning before action
- `revealRiskDecision(commitmentAddress)` — Reveal reasoning after action
- `commitWarningAlert(position, riskScore)` — Shorthand for warning commits
- `commitCriticalAlert(position, riskScore)` — Shorthand for critical commits
- `commitLiquidationPrediction(position, riskScore, prediction)` — Shorthand for prediction commits
- `getCommitmentHistory()` — Get all commitments this session
- `getPendingCommitments()` — Get unrevealed commitments
- `revealAllPending()` — Batch reveal all pending

### `verifyRiskDecision(connection, address, reasoning)`

Standalone verification function. See [`src/solprism/verifier.ts`](../src/solprism/verifier.ts).

### `fetchSentinelCommitments(connection, authority)`

Fetch all SENTINEL commitments for an agent. Useful for auditing.

---

**SOLPRISM** — Verifiable Reasoning, Onchain · [solprism.app](https://www.solprism.app) · Program `CZcvoryaQNrtZ3qb3gC1h9opcYpzEP1D9Mu1RVwFQeBu`

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { PositionMonitor } from './monitor/positionMonitor';
import { RiskEngine } from './risk/riskEngine';
import { AlertSystem } from './alerts/alertSystem';
import { HeartbeatService } from './heartbeat';
import { SolprismRiskGuard } from './solprism';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   ███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██╗ ║
║   ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║ ║
║   ███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║ ║
║   ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║ ║
║   ███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗ ║
║   ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝ ║
║                                                               ║
║   Autonomous DeFi Risk Guardian for Solana                    ║
║   Agent: mrrobot (#472) | Colosseum Hackathon 2026           ║
╚═══════════════════════════════════════════════════════════════╝
`);

interface SentinelConfig {
  rpcUrl: string;
  heliusApiKey?: string;
  webhookUrl?: string;
  liquidationWarningThreshold: number;
  criticalHealthThreshold: number;
  predictionHorizonMinutes: number;
  solprism?: {
    enabled: boolean;
    agentName: string;
    autoReveal: boolean;
    keypairPath?: string;
    programId?: string;
    storageBaseUri?: string;
  };
}

class Sentinel {
  private connection: Connection;
  private positionMonitor: PositionMonitor;
  private riskEngine: RiskEngine;
  private alertSystem: AlertSystem;
  private heartbeat: HeartbeatService;
  private solprismGuard: SolprismRiskGuard;
  private config: SentinelConfig;

  constructor(config: SentinelConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.positionMonitor = new PositionMonitor(this.connection);
    this.riskEngine = new RiskEngine(config);
    this.alertSystem = new AlertSystem(config.webhookUrl);
    this.heartbeat = new HeartbeatService();

    // Initialize SOLPRISM verifiable reasoning guard
    this.solprismGuard = new SolprismRiskGuard({
      rpcUrl: config.rpcUrl,
      agentName: config.solprism?.agentName || 'SENTINEL-Guardian',
      autoReveal: config.solprism?.autoReveal ?? true,
      enabled: config.solprism?.enabled ?? false,
      keypairPath: config.solprism?.keypairPath,
      programId: config.solprism?.programId,
      storageBaseUri: config.solprism?.storageBaseUri,
    });
  }

  async start(): Promise<void> {
    console.log('[SENTINEL] Starting autonomous risk monitoring...');
    console.log(`[SENTINEL] RPC: ${this.config.rpcUrl}`);
    console.log(`[SENTINEL] Warning threshold: ${this.config.liquidationWarningThreshold}`);
    console.log(`[SENTINEL] Critical threshold: ${this.config.criticalHealthThreshold}`);
    console.log(`[SENTINEL] Prediction horizon: ${this.config.predictionHorizonMinutes} minutes`);

    // Initialize SOLPRISM if enabled
    if (this.config.solprism?.enabled && this.config.solprism.keypairPath) {
      try {
        const keypairData = JSON.parse(fs.readFileSync(this.config.solprism.keypairPath, 'utf-8'));
        const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
        await this.solprismGuard.initialize(wallet);
        console.log('[SENTINEL] SOLPRISM verifiable reasoning: ✅ ACTIVE');
        console.log('[SENTINEL] Explorer: https://www.solprism.app');
      } catch (error) {
        console.warn('[SENTINEL] SOLPRISM initialization failed — continuing without verifiable reasoning:', error);
      }
    } else {
      console.log('[SENTINEL] SOLPRISM verifiable reasoning: disabled (set SOLPRISM_ENABLED=true to activate)');
    }

    // Start heartbeat for hackathon
    await this.heartbeat.start();

    // Start position monitoring loop
    this.monitorLoop();
  }

  private async monitorLoop(): Promise<void> {
    console.log('[SENTINEL] Entering monitoring loop...');

    while (true) {
      try {
        // 1. Fetch all positions from supported protocols
        const positions = await this.positionMonitor.fetchAllPositions();
        console.log(`[MONITOR] Found ${positions.length} active positions`);

        // 2. Calculate risk scores for each position
        for (const position of positions) {
          const riskScore = await this.riskEngine.calculateRisk(position);

          // 3. Check if alert needed — with SOLPRISM commit-reveal reasoning
          if (riskScore.healthFactor < this.config.criticalHealthThreshold) {
            // SOLPRISM: commit reasoning BEFORE the alert fires
            const commitRecord = await this.solprismGuard.commitCriticalAlert(position, riskScore);

            await this.alertSystem.sendCriticalAlert(position, riskScore);

            // SOLPRISM: reveal reasoning AFTER the alert fires
            if (commitRecord && this.config.solprism?.autoReveal) {
              await this.solprismGuard.revealRiskDecision(commitRecord.commitmentAddress);
            }
          } else if (riskScore.healthFactor < this.config.liquidationWarningThreshold) {
            const commitRecord = await this.solprismGuard.commitWarningAlert(position, riskScore);

            await this.alertSystem.sendWarningAlert(position, riskScore);

            if (commitRecord && this.config.solprism?.autoReveal) {
              await this.solprismGuard.revealRiskDecision(commitRecord.commitmentAddress);
            }
          }

          // 4. ML-based prediction — with SOLPRISM commit-reveal reasoning
          const prediction = await this.riskEngine.predictLiquidation(position);
          if (prediction.minutesToLiquidation < this.config.predictionHorizonMinutes) {
            const commitRecord = await this.solprismGuard.commitLiquidationPrediction(
              position,
              riskScore,
              prediction,
            );

            await this.alertSystem.sendPredictionAlert(position, prediction);

            if (commitRecord && this.config.solprism?.autoReveal) {
              await this.solprismGuard.revealRiskDecision(commitRecord.commitmentAddress);
            }
          }
        }

        // Wait before next iteration (10 seconds)
        await this.sleep(10000);

      } catch (error) {
        console.error('[SENTINEL] Error in monitoring loop:', error);
        await this.sleep(5000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main entry point
async function main() {
  const config: SentinelConfig = {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    heliusApiKey: process.env.HELIUS_API_KEY,
    webhookUrl: process.env.WEBHOOK_URL,
    liquidationWarningThreshold: parseFloat(process.env.LIQUIDATION_WARNING_THRESHOLD || '1.3'),
    criticalHealthThreshold: parseFloat(process.env.CRITICAL_HEALTH_THRESHOLD || '1.1'),
    predictionHorizonMinutes: parseInt(process.env.PREDICTION_HORIZON_MINUTES || '30'),
    solprism: {
      enabled: process.env.SOLPRISM_ENABLED === 'true',
      agentName: process.env.SOLPRISM_AGENT_NAME || 'SENTINEL-Guardian',
      autoReveal: process.env.SOLPRISM_AUTO_REVEAL !== 'false',
      keypairPath: process.env.SOLPRISM_KEYPAIR_PATH,
      programId: process.env.SOLPRISM_PROGRAM_ID,
      storageBaseUri: process.env.SOLPRISM_STORAGE_URI,
    },
  };

  const sentinel = new Sentinel(config);
  await sentinel.start();
}

main().catch(console.error);

export { Sentinel, SentinelConfig };

import { Connection, PublicKey } from '@solana/web3.js';
import { PositionMonitor } from './monitor/positionMonitor';
import { RiskEngine } from './risk/riskEngine';
import { AlertSystem } from './alerts/alertSystem';
import { HeartbeatService } from './heartbeat';
import dotenv from 'dotenv';

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
}

class Sentinel {
  private connection: Connection;
  private positionMonitor: PositionMonitor;
  private riskEngine: RiskEngine;
  private alertSystem: AlertSystem;
  private heartbeat: HeartbeatService;
  private config: SentinelConfig;

  constructor(config: SentinelConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.positionMonitor = new PositionMonitor(this.connection);
    this.riskEngine = new RiskEngine(config);
    this.alertSystem = new AlertSystem(config.webhookUrl);
    this.heartbeat = new HeartbeatService();
  }

  async start(): Promise<void> {
    console.log('[SENTINEL] Starting autonomous risk monitoring...');
    console.log(`[SENTINEL] RPC: ${this.config.rpcUrl}`);
    console.log(`[SENTINEL] Warning threshold: ${this.config.liquidationWarningThreshold}`);
    console.log(`[SENTINEL] Critical threshold: ${this.config.criticalHealthThreshold}`);
    console.log(`[SENTINEL] Prediction horizon: ${this.config.predictionHorizonMinutes} minutes`);

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

          // 3. Check if alert needed
          if (riskScore.healthFactor < this.config.criticalHealthThreshold) {
            await this.alertSystem.sendCriticalAlert(position, riskScore);
          } else if (riskScore.healthFactor < this.config.liquidationWarningThreshold) {
            await this.alertSystem.sendWarningAlert(position, riskScore);
          }

          // 4. ML-based prediction
          const prediction = await this.riskEngine.predictLiquidation(position);
          if (prediction.minutesToLiquidation < this.config.predictionHorizonMinutes) {
            await this.alertSystem.sendPredictionAlert(position, prediction);
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
  };

  const sentinel = new Sentinel(config);
  await sentinel.start();
}

main().catch(console.error);

export { Sentinel, SentinelConfig };

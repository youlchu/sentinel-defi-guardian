import { Connection, PublicKey } from '@solana/web3.js';
import { PositionMonitor } from './monitor/positionMonitor';
import { RiskEngine } from './risk/riskEngine';
import { AlertSystem } from './alerts/alertSystem';
import { HeartbeatService } from './heartbeat';
import express, { Express, Request, Response } from 'express';
import http from 'http';
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
  port?: number;
}

class Sentinel {
  private connection: Connection;
  private positionMonitor: PositionMonitor;
  private riskEngine: RiskEngine;
  private alertSystem: AlertSystem;
  private heartbeat: HeartbeatService;
  private config: SentinelConfig;
  private app: Express;
  private server: http.Server | null = null;
  private isShuttingDown = false;
  private positions: any[] = [];
  private lastPositionsUpdate = 0;

  constructor(config: SentinelConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.positionMonitor = new PositionMonitor(this.connection);
    this.riskEngine = new RiskEngine(config);
    this.alertSystem = new AlertSystem(config.webhookUrl);
    this.heartbeat = new HeartbeatService();
    this.app = express();
    this.setupExpressApp();
    this.setupGracefulShutdown();
  }

  private setupExpressApp(): void {
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        rpcUrl: this.config.rpcUrl,
        totalPositions: this.positions.length,
        lastUpdate: new Date(this.lastPositionsUpdate).toISOString()
      };
      res.json(healthData);
    });

    // Position status endpoint
    this.app.get('/positions', async (req: Request, res: Response) => {
      try {
        const positionsWithRisk = await Promise.all(
          this.positions.map(async (position) => {
            const riskScore = await this.riskEngine.calculateRisk(position);
            const prediction = await this.riskEngine.predictLiquidation(position);
            return {
              ...position,
              riskScore,
              prediction,
              lastUpdated: new Date(this.lastPositionsUpdate).toISOString()
            };
          })
        );

        res.json({
          positions: positionsWithRisk,
          totalCount: positionsWithRisk.length,
          timestamp: new Date().toISOString(),
          riskSummary: {
            critical: positionsWithRisk.filter(p => p.riskScore.healthFactor < this.config.criticalHealthThreshold).length,
            warning: positionsWithRisk.filter(p => p.riskScore.healthFactor < this.config.liquidationWarningThreshold && p.riskScore.healthFactor >= this.config.criticalHealthThreshold).length,
            healthy: positionsWithRisk.filter(p => p.riskScore.healthFactor >= this.config.liquidationWarningThreshold).length
          }
        });
      } catch (error) {
        console.error('[API] Error fetching positions:', error);
        res.status(500).json({
          error: 'Failed to fetch positions',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Graceful shutdown status
    this.app.get('/shutdown', (req: Request, res: Response) => {
      res.json({
        shuttingDown: this.isShuttingDown,
        timestamp: new Date().toISOString()
      });
    });
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`[SENTINEL] Received ${signal}, starting graceful shutdown...`);
      this.isShuttingDown = true;

      if (this.server) {
        this.server.close(() => {
          console.log('[SENTINEL] HTTP server closed');
        });
      }

      try {
        await this.heartbeat.stop();
        console.log('[SENTINEL] Services stopped successfully');
        process.exit(0);
      } catch (error) {
        console.error('[SENTINEL] Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  async start(): Promise<void> {
    console.log('[SENTINEL] Starting autonomous risk monitoring...');
    console.log(`[SENTINEL] RPC: ${this.config.rpcUrl}`);
    console.log(`[SENTINEL] Warning threshold: ${this.config.liquidationWarningThreshold}`);
    console.log(`[SENTINEL] Critical threshold: ${this.config.criticalHealthThreshold}`);
    console.log(`[SENTINEL] Prediction horizon: ${this.config.predictionHorizonMinutes} minutes`);

    // Start Express server
    const port = this.config.port || 3000;
    this.server = this.app.listen(port, () => {
      console.log(`[SENTINEL] API server started on port ${port}`);
      console.log(`[SENTINEL] Health check: http://localhost:${port}/health`);
      console.log(`[SENTINEL] Positions API: http://localhost:${port}/positions`);
    });

    // Start heartbeat for hackathon
    await this.heartbeat.start();

    // Start position monitoring loop
    this.monitorLoop();
  }

  private async monitorLoop(): Promise<void> {
    console.log('[SENTINEL] Entering monitoring loop...');

    while (!this.isShuttingDown) {
      try {
        // 1. Fetch all positions from supported protocols
        const positions = await this.positionMonitor.fetchAllPositions();
        this.positions = positions;
        this.lastPositionsUpdate = Date.now();
        console.log(`[MONITOR] Found ${positions.length} active positions`);

        // 2. Calculate risk scores for each position
        for (const position of positions) {
          if (this.isShuttingDown) break;

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

    console.log('[SENTINEL] Monitoring loop stopped');
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
    port: parseInt(process.env.PORT || '3000'),
  };

  const sentinel = new Sentinel(config);
  await sentinel.start();
}

main().catch(console.error);

export { Sentinel, SentinelConfig };
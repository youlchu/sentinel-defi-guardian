import { Connection, PublicKey } from "@solana/web3.js";
import { PositionMonitor } from "./monitor/positionMonitor";
import { RiskEngine } from "./risk/riskEngine";
import { AlertSystem, WebhookConfig } from "./alerts/alertSystem";
import { HeartbeatService } from "./heartbeat";
import express, { Express, Request, Response } from "express";
import http from "http";
import dotenv from "dotenv";

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

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  rpcUrl: string;
  totalPositions: number;
  lastUpdate: string;
  services: {
    positionMonitor: boolean;
    riskEngine: boolean;
    alertSystem: boolean;
    heartbeat: boolean;
  };
  memoryUsage: NodeJS.MemoryUsage;
  connectionStatus: "connected" | "disconnected" | "unknown";
}

interface PositionStatus {
  positions: any[];
  totalCount: number;
  timestamp: string;
  riskSummary: {
    critical: number;
    warning: number;
    healthy: number;
  };
  lastMonitoringCycle: string;
  averageHealthFactor: number;
  topRiskyPositions: any[];
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
  private lastMonitoringCycle = 0;
  private serviceStatus = {
    positionMonitor: true,
    riskEngine: true,
    alertSystem: true,
    heartbeat: true,
  };

  constructor(config: SentinelConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.positionMonitor = new PositionMonitor(
      this.connection,
      config.heliusApiKey || ""
    );
    this.riskEngine = new RiskEngine(config);

    // Convert webhookUrl to WebhookConfig array
    const webhooks: WebhookConfig[] = config.webhookUrl
      ? [
          {
            type: "discord",
            url: config.webhookUrl,
            enabled: true,
            name: "default",
            rateLimitPerMinute: 30,
            retryAttempts: 3,
            timeout: 10000,
            priority: "medium",
            alertTypes: ["warning", "critical", "prediction", "info"]
          },
        ]
      : [];
    this.alertSystem = new AlertSystem(webhooks);

    this.heartbeat = new HeartbeatService();
    this.app = express();
    this.setupExpressApp();
    this.setupGracefulShutdown();
  }

  private setupExpressApp(): void {
    this.app.use(express.json());
    this.app.use((req: Request, res: Response, next) => {
      console.log(
        `[API] ${req.method} ${req.path} - ${new Date().toISOString()}`
      );
      next();
    });

    this.app.get("/health", async (req: Request, res: Response) => {
      try {
        const connectionStatus = await this.checkRPCConnection();
        const healthData: HealthStatus = {
          status: this.determineOverallHealth(connectionStatus),
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: process.env.npm_package_version || "1.0.0",
          environment: process.env.NODE_ENV || "development",
          rpcUrl: this.config.rpcUrl,
          totalPositions: this.positions.length,
          lastUpdate: this.lastPositionsUpdate
            ? new Date(this.lastPositionsUpdate).toISOString()
            : "never",
          services: { ...this.serviceStatus },
          memoryUsage: process.memoryUsage(),
          connectionStatus,
        };

        const statusCode =
          healthData.status === "healthy"
            ? 200
            : healthData.status === "degraded"
            ? 200
            : 503;

        res.status(statusCode).json(healthData);
      } catch (error) {
        console.error("[API] Health check error:", error);
        res.status(503).json({
          status: "unhealthy",
          error: "Health check failed",
          timestamp: new Date().toISOString(),
        });
      }
    });

    this.app.get("/positions", async (req: Request, res: Response) => {
      try {
        const positionsWithRisk = await Promise.all(
          this.positions.map(async (position) => {
            try {
              const riskScore = await this.riskEngine.calculateRisk(position);
              const prediction = await this.riskEngine.predictLiquidation(
                position
              );
              return {
                ...position,
                riskScore,
                prediction,
                lastUpdated: new Date(this.lastPositionsUpdate).toISOString(),
              };
            } catch (error) {
              console.error("[API] Error processing position:", error);
              return {
                ...position,
                error: "Risk calculation failed",
                lastUpdated: new Date(this.lastPositionsUpdate).toISOString(),
              };
            }
          })
        );

        const healthyPositions = positionsWithRisk.filter(
          (p) =>
            p.riskScore &&
            p.riskScore.healthFactor >= this.config.liquidationWarningThreshold
        );
        const warningPositions = positionsWithRisk.filter(
          (p) =>
            p.riskScore &&
            p.riskScore.healthFactor <
              this.config.liquidationWarningThreshold &&
            p.riskScore.healthFactor >= this.config.criticalHealthThreshold
        );
        const criticalPositions = positionsWithRisk.filter(
          (p) =>
            p.riskScore &&
            p.riskScore.healthFactor < this.config.criticalHealthThreshold
        );

        const validHealthFactors = positionsWithRisk
          .filter(
            (p) => p.riskScore && typeof p.riskScore.healthFactor === "number"
          )
          .map((p) => p.riskScore.healthFactor);

        const averageHealthFactor =
          validHealthFactors.length > 0
            ? validHealthFactors.reduce((sum, hf) => sum + hf, 0) /
              validHealthFactors.length
            : 0;

        const topRiskyPositions = positionsWithRisk
          .filter((p) => p.riskScore)
          .sort((a, b) => a.riskScore.healthFactor - b.riskScore.healthFactor)
          .slice(0, 5);

        const positionStatus: PositionStatus = {
          positions: positionsWithRisk,
          totalCount: positionsWithRisk.length,
          timestamp: new Date().toISOString(),
          riskSummary: {
            critical: criticalPositions.length,
            warning: warningPositions.length,
            healthy: healthyPositions.length,
          },
          lastMonitoringCycle: this.lastMonitoringCycle
            ? new Date(this.lastMonitoringCycle).toISOString()
            : "never",
          averageHealthFactor,
          topRiskyPositions,
        };

        res.json(positionStatus);
      } catch (error) {
        console.error("[API] Error fetching positions:", error);
        res.status(500).json({
          error: "Failed to fetch positions",
          message: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        });
      }
    });

    this.app.get("/positions/:id", async (req: Request, res: Response) => {
      try {
        const positionId = req.params.id;
        const position = this.positions.find(
          (p) => p.id === positionId || p.publicKey === positionId
        );

        if (!position) {
          return res.status(404).json({
            error: "Position not found",
            timestamp: new Date().toISOString(),
          });
        }

        const riskScore = await this.riskEngine.calculateRisk(position);
        const prediction = await this.riskEngine.predictLiquidation(position);

        res.json({
          ...position,
          riskScore,
          prediction,
          lastUpdated: new Date(this.lastPositionsUpdate).toISOString(),
        });
      } catch (error) {
        console.error("[API] Error fetching position:", error);
        res.status(500).json({
          error: "Failed to fetch position",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.get("/status", (req: Request, res: Response) => {
      res.json({
        isRunning: !this.isShuttingDown,
        shuttingDown: this.isShuttingDown,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
      });
    });

    this.app.post("/shutdown", (req: Request, res: Response) => {
      if (this.isShuttingDown) {
        return res.json({
          message: "Shutdown already in progress",
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        message: "Graceful shutdown initiated",
        timestamp: new Date().toISOString(),
      });

      setTimeout(() => {
        process.kill(process.pid, "SIGTERM");
      }, 1000);
    });

    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: "Not Found",
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString(),
      });
    });

    this.app.use((error: Error, req: Request, res: Response, next: any) => {
      console.error("[API] Unhandled error:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private async checkRPCConnection(): Promise<
    "connected" | "disconnected" | "unknown"
  > {
    try {
      await this.connection.getSlot();
      return "connected";
    } catch (error) {
      console.error("[HEALTH] RPC connection check failed:", error);
      return "disconnected";
    }
  }

  private determineOverallHealth(
    connectionStatus: "connected" | "disconnected" | "unknown"
  ): "healthy" | "degraded" | "unhealthy" {
    if (connectionStatus === "disconnected") {
      return "unhealthy";
    }

    const servicesDown = Object.values(this.serviceStatus).filter(
      (status) => !status
    ).length;

    if (servicesDown === 0) {
      return "healthy";
    } else if (servicesDown <= 2) {
      return "degraded";
    } else {
      return "unhealthy";
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(
        `[SENTINEL] Received ${signal}, starting graceful shutdown...`
      );
      this.isShuttingDown = true;

      const shutdownTimeout = setTimeout(() => {
        console.log("[SENTINEL] Shutdown timeout reached, forcing exit");
        process.exit(1);
      }, 30000);

      try {
        if (this.server) {
          await new Promise<void>((resolve) => {
            this.server!.close(() => {
              console.log("[SENTINEL] HTTP server closed");
              resolve();
            });
          });
        }

        await this.heartbeat.stop();
        console.log("[SENTINEL] Services stopped successfully");

        clearTimeout(shutdownTimeout);
        process.exit(0);
      } catch (error) {
        console.error("[SENTINEL] Error during shutdown:", error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("uncaughtException", (error) => {
      console.error("[SENTINEL] Uncaught exception:", error);
      shutdown("uncaughtException");
    });
    process.on("unhandledRejection", (reason, promise) => {
      console.error(
        "[SENTINEL] Unhandled rejection at:",
        promise,
        "reason:",
        reason
      );
      shutdown("unhandledRejection");
    });
  }

  async start(): Promise<void> {
    console.log("[SENTINEL] Starting autonomous risk monitoring...");
    console.log(`[SENTINEL] RPC: ${this.config.rpcUrl}`);
    console.log(
      `[SENTINEL] Warning threshold: ${this.config.liquidationWarningThreshold}`
    );
    console.log(
      `[SENTINEL] Critical threshold: ${this.config.criticalHealthThreshold}`
    );
    console.log(
      `[SENTINEL] Prediction horizon: ${this.config.predictionHorizonMinutes} minutes`
    );

    try {
      const port = this.config.port || 3000;
      this.server = this.app.listen(port, () => {
        console.log(`[SENTINEL] API server started on port ${port}`);
        console.log(`[SENTINEL] Health check: http://localhost:${port}/health`);
        console.log(
          `[SENTINEL] Positions API: http://localhost:${port}/positions`
        );
        console.log(`[SENTINEL] Status: http://localhost:${port}/status`);
        console.log(
          `[SENTINEL] Shutdown: POST http://localhost:${port}/shutdown`
        );
      });

      this.server.on("error", (error) => {
        console.error("[SENTINEL] Server error:", error);
        this.serviceStatus.alertSystem = false;
      });

      await this.heartbeat.start();
      this.monitorLoop();
    } catch (error) {
      console.error("[SENTINEL] Failed to start server:", error);
      throw error;
    }
  }

  private async monitorLoop(): Promise<void> {
    console.log("[SENTINEL] Entering monitoring loop...");

    while (!this.isShuttingDown) {
      const cycleStart = Date.now();

      try {
        this.serviceStatus.positionMonitor = true;
        const positions = await this.positionMonitor.fetchAllPositions();
        this.positions = positions;
        this.lastPositionsUpdate = Date.now();
        console.log(`[MONITOR] Found ${positions.length} active positions`);

        this.serviceStatus.riskEngine = true;
        for (const position of positions) {
          if (this.isShuttingDown) break;

          try {
            const riskScore = await this.riskEngine.calculateRisk(position);

            this.serviceStatus.alertSystem = true;
            if (riskScore.healthFactor < this.config.criticalHealthThreshold) {
              await this.alertSystem.sendCriticalAlert(position, riskScore);
            } else if (
              riskScore.healthFactor < this.config.liquidationWarningThreshold
            ) {
              await this.alertSystem.sendWarningAlert(position, riskScore);
            }

            const prediction = await this.riskEngine.predictLiquidation(
              position
            );
            if (
              prediction.minutesToLiquidation <
              this.config.predictionHorizonMinutes
            ) {
              await this.alertSystem.sendPredictionAlert(position, prediction);
            }
          } catch (error) {
            console.error("[MONITOR] Error processing position:", error);
            this.serviceStatus.riskEngine = false;
          }
        }

        this.lastMonitoringCycle = Date.now();
        const cycleDuration = this.lastMonitoringCycle - cycleStart;
        console.log(`[MONITOR] Cycle completed in ${cycleDuration}ms`);

        await this.sleep(Math.max(1000, 10000 - cycleDuration));
      } catch (error) {
        console.error("[SENTINEL] Error in monitoring loop:", error);
        this.serviceStatus.positionMonitor = false;
        await this.sleep(5000);
      }
    }

    console.log("[SENTINEL] Monitoring loop stopped");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function main() {
  const config: SentinelConfig = {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    heliusApiKey: process.env.HELIUS_API_KEY,
    webhookUrl: process.env.WEBHOOK_URL,
    liquidationWarningThreshold: parseFloat(
      process.env.LIQUIDATION_WARNING_THRESHOLD || "1.3"
    ),
    criticalHealthThreshold: parseFloat(
      process.env.CRITICAL_HEALTH_THRESHOLD || "1.1"
    ),
    predictionHorizonMinutes: parseInt(
      process.env.PREDICTION_HORIZON_MINUTES || "30"
    ),
    port: parseInt(process.env.PORT || "3000"),
  };

  const sentinel = new Sentinel(config);
  await sentinel.start();
}

main().catch(console.error);

export { Sentinel, SentinelConfig, HealthStatus, PositionStatus };
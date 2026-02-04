import axios from 'axios';
import { Position } from '../monitor/positionMonitor';
import { RiskScore, LiquidationPrediction } from '../risk/riskEngine';

export interface Alert {
  id: string;
  type: 'warning' | 'critical' | 'prediction' | 'info';
  positionId: string;
  protocol: string;
  message: string;
  data: any;
  timestamp: number;
}

export class AlertSystem {
  private webhookUrl?: string;
  private alertHistory: Alert[] = [];
  private cooldownMap: Map<string, number> = new Map();
  private cooldownMs: number = 60000; // 1 minute cooldown between same alerts

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl;
  }

  async sendWarningAlert(position: Position, riskScore: RiskScore): Promise<void> {
    const alertKey = `warning-${position.id}`;

    if (this.isOnCooldown(alertKey)) {
      return;
    }

    const alert: Alert = {
      id: `alert-${Date.now()}`,
      type: 'warning',
      positionId: position.id,
      protocol: position.protocol,
      message: `⚠️ WARNING: Position health factor dropped to ${riskScore.healthFactor.toFixed(2)}`,
      data: {
        healthFactor: riskScore.healthFactor,
        riskLevel: riskScore.riskLevel,
        collateralRatio: riskScore.collateralRatio,
        distanceToLiquidation: riskScore.distanceToLiquidation,
      },
      timestamp: Date.now(),
    };

    await this.dispatchAlert(alert);
    this.setCooldown(alertKey);
  }

  async sendCriticalAlert(position: Position, riskScore: RiskScore): Promise<void> {
    const alertKey = `critical-${position.id}`;

    // Critical alerts have shorter cooldown
    if (this.isOnCooldown(alertKey, 30000)) {
      return;
    }

    const alert: Alert = {
      id: `alert-${Date.now()}`,
      type: 'critical',
      positionId: position.id,
      protocol: position.protocol,
      message: `🚨 CRITICAL: Position at immediate liquidation risk! Health: ${riskScore.healthFactor.toFixed(2)}`,
      data: {
        healthFactor: riskScore.healthFactor,
        riskLevel: riskScore.riskLevel,
        collateralRatio: riskScore.collateralRatio,
        distanceToLiquidation: riskScore.distanceToLiquidation,
        liquidationPrice: riskScore.liquidationPrice,
        currentPrice: riskScore.currentPrice,
      },
      timestamp: Date.now(),
    };

    await this.dispatchAlert(alert);
    this.setCooldown(alertKey, 30000);
  }

  async sendPredictionAlert(position: Position, prediction: LiquidationPrediction): Promise<void> {
    const alertKey = `prediction-${position.id}`;

    if (this.isOnCooldown(alertKey)) {
      return;
    }

    const alert: Alert = {
      id: `alert-${Date.now()}`,
      type: 'prediction',
      positionId: position.id,
      protocol: position.protocol,
      message: `🔮 PREDICTION: ${(prediction.probability * 100).toFixed(0)}% chance of liquidation in ${prediction.minutesToLiquidation.toFixed(0)} minutes`,
      data: {
        probability: prediction.probability,
        minutesToLiquidation: prediction.minutesToLiquidation,
        confidence: prediction.confidence,
        factors: prediction.factors,
      },
      timestamp: Date.now(),
    };

    await this.dispatchAlert(alert);
    this.setCooldown(alertKey);
  }

  async sendInfoAlert(message: string, data?: any): Promise<void> {
    const alert: Alert = {
      id: `alert-${Date.now()}`,
      type: 'info',
      positionId: '',
      protocol: '',
      message: `ℹ️ ${message}`,
      data: data || {},
      timestamp: Date.now(),
    };

    await this.dispatchAlert(alert);
  }

  private async dispatchAlert(alert: Alert): Promise<void> {
    // Store in history
    this.alertHistory.push(alert);
    if (this.alertHistory.length > 1000) {
      this.alertHistory.shift();
    }

    // Console output
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[ALERT] ${alert.type.toUpperCase()} - ${new Date(alert.timestamp).toISOString()}`);
    console.log(`[ALERT] ${alert.message}`);
    if (alert.positionId) {
      console.log(`[ALERT] Position: ${alert.positionId} (${alert.protocol})`);
    }
    console.log(`[ALERT] Data:`, JSON.stringify(alert.data, null, 2));
    console.log(`${'='.repeat(60)}\n`);

    // Send to webhook if configured
    if (this.webhookUrl) {
      try {
        await axios.post(this.webhookUrl, {
          alert,
          source: 'SENTINEL',
          agent: 'mrrobot',
        });
        console.log('[ALERT] Webhook notification sent');
      } catch (error) {
        console.error('[ALERT] Failed to send webhook:', error);
      }
    }
  }

  private isOnCooldown(key: string, customCooldown?: number): boolean {
    const lastAlert = this.cooldownMap.get(key);
    if (!lastAlert) return false;

    const cooldown = customCooldown || this.cooldownMs;
    return Date.now() - lastAlert < cooldown;
  }

  private setCooldown(key: string, customCooldown?: number): void {
    this.cooldownMap.set(key, Date.now());
  }

  getAlertHistory(limit: number = 50): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  clearCooldowns(): void {
    this.cooldownMap.clear();
  }
}

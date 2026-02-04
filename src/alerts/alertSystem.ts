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

export interface AlertThresholds {
  healthFactorWarning: number;
  healthFactorCritical: number;
  liquidationProbability: number;
  distanceToLiquidationPercent: number;
  collateralRatioWarning: number;
  collateralRatioCritical: number;
}

export interface WebhookConfig {
  type: 'discord' | 'telegram' | 'generic';
  url: string;
  enabled: boolean;
  name?: string;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  timestamp: string;
  footer?: {
    text: string;
  };
}

export interface TelegramMessage {
  chat_id?: string;
  text: string;
  parse_mode?: string;
  disable_web_page_preview?: boolean;
}

export class AlertSystem {
  private webhooks: WebhookConfig[] = [];
  private alertHistory: Alert[] = [];
  private cooldownMap: Map<string, number> = new Map();
  private cooldownMs: number = 60000;
  private thresholds: AlertThresholds;

  constructor(webhooks: WebhookConfig[] = [], customThresholds?: Partial<AlertThresholds>) {
    this.webhooks = webhooks;
    this.thresholds = {
      healthFactorWarning: 1.3,
      healthFactorCritical: 1.1,
      liquidationProbability: 0.7,
      distanceToLiquidationPercent: 10,
      collateralRatioWarning: 1.5,
      collateralRatioCritical: 1.2,
      ...customThresholds,
    };
  }

  addWebhook(webhook: WebhookConfig): void {
    this.webhooks.push(webhook);
  }

  removeWebhook(name: string): void {
    this.webhooks = this.webhooks.filter(w => w.name !== name);
  }

  updateThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }

  getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  shouldSendWarning(riskScore: RiskScore): boolean {
    return riskScore.healthFactor <= this.thresholds.healthFactorWarning ||
           riskScore.collateralRatio <= this.thresholds.collateralRatioWarning ||
           riskScore.distanceToLiquidation <= this.thresholds.distanceToLiquidationPercent;
  }

  shouldSendCritical(riskScore: RiskScore): boolean {
    return riskScore.healthFactor <= this.thresholds.healthFactorCritical ||
           riskScore.collateralRatio <= this.thresholds.collateralRatioCritical ||
           riskScore.distanceToLiquidation <= 5;
  }

  shouldSendPrediction(prediction: LiquidationPrediction): boolean {
    return prediction.probability >= this.thresholds.liquidationProbability;
  }

  async sendWarningAlert(position: Position, riskScore: RiskScore): Promise<void> {
    if (!this.shouldSendWarning(riskScore)) {
      return;
    }

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
    if (!this.shouldSendCritical(riskScore)) {
      return;
    }

    const alertKey = `critical-${position.id}`;

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
    if (!this.shouldSendPrediction(prediction)) {
      return;
    }

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

  private formatDiscordMessage(alert: Alert): { embeds: DiscordEmbed[] } {
    const color = this.getAlertColor(alert.type);
    const embed: DiscordEmbed = {
      title: `${this.getAlertEmoji(alert.type)} ${alert.type.toUpperCase()} Alert`,
      description: alert.message,
      color: color,
      fields: [],
      timestamp: new Date(alert.timestamp).toISOString(),
      footer: {
        text: 'SENTINEL • DeFi Position Monitor'
      }
    };

    if (alert.positionId) {
      embed.fields.push({
        name: 'Position',
        value: alert.positionId,
        inline: true
      });
      embed.fields.push({
        name: 'Protocol',
        value: alert.protocol,
        inline: true
      });
    }

    if (alert.data.healthFactor !== undefined) {
      embed.fields.push({
        name: 'Health Factor',
        value: alert.data.healthFactor.toFixed(4),
        inline: true
      });
    }

    if (alert.data.collateralRatio !== undefined) {
      embed.fields.push({
        name: 'Collateral Ratio',
        value: alert.data.collateralRatio.toFixed(4),
        inline: true
      });
    }

    if (alert.data.distanceToLiquidation !== undefined) {
      embed.fields.push({
        name: 'Distance to Liquidation',
        value: `${alert.data.distanceToLiquidation.toFixed(2)}%`,
        inline: true
      });
    }

    if (alert.data.probability !== undefined) {
      embed.fields.push({
        name: 'Liquidation Probability',
        value: `${(alert.data.probability * 100).toFixed(1)}%`,
        inline: true
      });
    }

    if (alert.data.minutesToLiquidation !== undefined) {
      embed.fields.push({
        name: 'Time to Liquidation',
        value: `${alert.data.minutesToLiquidation.toFixed(0)} minutes`,
        inline: true
      });
    }

    return { embeds: [embed] };
  }

  private formatTelegramMessage(alert: Alert): TelegramMessage {
    let message = `${this.getAlertEmoji(alert.type)} *${alert.type.toUpperCase()} ALERT*\n\n`;
    message += `${alert.message}\n\n`;

    if (alert.positionId) {
      message += `*Position:* \`${alert.positionId}\`\n`;
      message += `*Protocol:* ${alert.protocol}\n`;
    }

    if (alert.data.healthFactor !== undefined) {
      message += `*Health Factor:* ${alert.data.healthFactor.toFixed(4)}\n`;
    }

    if (alert.data.collateralRatio !== undefined) {
      message += `*Collateral Ratio:* ${alert.data.collateralRatio.toFixed(4)}\n`;
    }

    if (alert.data.distanceToLiquidation !== undefined) {
      message += `*Distance to Liquidation:* ${alert.data.distanceToLiquidation.toFixed(2)}%\n`;
    }

    if (alert.data.probability !== undefined) {
      message += `*Liquidation Probability:* ${(alert.data.probability * 100).toFixed(1)}%\n`;
    }

    if (alert.data.minutesToLiquidation !== undefined) {
      message += `*Time to Liquidation:* ${alert.data.minutesToLiquidation.toFixed(0)} minutes\n`;
    }

    message += `\n*Time:* ${new Date(alert.timestamp).toISOString()}`;
    message += `\n\n_SENTINEL • DeFi Position Monitor_`;

    return {
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    };
  }

  private getAlertColor(type: string): number {
    switch (type) {
      case 'critical':
        return 0xFF0000; // Red
      case 'warning':
        return 0xFF8C00; // Orange
      case 'prediction':
        return 0x9932CC; // Purple
      case 'info':
        return 0x00BFFF; // Blue
      default:
        return 0x808080; // Gray
    }
  }

  private getAlertEmoji(type: string): string {
    switch (type) {
      case 'critical':
        return '🚨';
      case 'warning':
        return '⚠️';
      case 'prediction':
        return '🔮';
      case 'info':
        return 'ℹ️';
      default:
        return '📢';
    }
  }

  private async sendToDiscord(webhook: WebhookConfig, alert: Alert): Promise<void> {
    const payload = this.formatDiscordMessage(alert);
    await axios.post(webhook.url, payload);
  }

  private async sendToTelegram(webhook: WebhookConfig, alert: Alert): Promise<void> {
    const payload = this.formatTelegramMessage(alert);
    await axios.post(webhook.url, payload);
  }

  private async sendToGenericWebhook(webhook: WebhookConfig, alert: Alert): Promise<void> {
    await axios.post(webhook.url, {
      alert,
      source: 'SENTINEL',
      agent: 'mrrobot',
    });
  }

  private async dispatchAlert(alert: Alert): Promise<void> {
    this.alertHistory.push(alert);
    if (this.alertHistory.length > 1000) {
      this.alertHistory.shift();
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[ALERT] ${alert.type.toUpperCase()} - ${new Date(alert.timestamp).toISOString()}`);
    console.log(`[ALERT] ${alert.message}`);
    if (alert.positionId) {
      console.log(`[ALERT] Position: ${alert.positionId} (${alert.protocol})`);
    }
    console.log(`[ALERT] Data:`, JSON.stringify(alert.data, null, 2));
    console.log(`${'='.repeat(60)}\n`);

    const sendPromises = this.webhooks
      .filter(webhook => webhook.enabled)
      .map(async webhook => {
        try {
          switch (webhook.type) {
            case 'discord':
              await this.sendToDiscord(webhook, alert);
              break;
            case 'telegram':
              await this.sendToTelegram(webhook, alert);
              break;
            case 'generic':
            default:
              await this.sendToGenericWebhook(webhook, alert);
              break;
          }
          console.log(`[ALERT] ${webhook.type} webhook notification sent (${webhook.name || webhook.url})`);
        } catch (error) {
          console.error(`[ALERT] Failed to send ${webhook.type} webhook:`, error);
        }
      });

    await Promise.allSettled(sendPromises);
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

  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks];
  }

  enableWebhook(name: string): void {
    const webhook = this.webhooks.find(w => w.name === name);
    if (webhook) {
      webhook.enabled = true;
    }
  }

  disableWebhook(name: string): void {
    const webhook = this.webhooks.find(w => w.name === name);
    if (webhook) {
      webhook.enabled = false;
    }
  }

  async testWebhook(name: string): Promise<boolean> {
    const webhook = this.webhooks.find(w => w.name === name);
    if (!webhook) {
      return false;
    }

    const testAlert: Alert = {
      id: `test-${Date.now()}`,
      type: 'info',
      positionId: 'test-position',
      protocol: 'TEST',
      message: 'Test alert from SENTINEL monitoring system',
      data: {
        test: true,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    };

    try {
      switch (webhook.type) {
        case 'discord':
          await this.sendToDiscord(webhook, testAlert);
          break;
        case 'telegram':
          await this.sendToTelegram(webhook, testAlert);
          break;
        case 'generic':
        default:
          await this.sendToGenericWebhook(webhook, testAlert);
          break;
      }
      return true;
    } catch (error) {
      console.error(`[ALERT] Test webhook failed for ${name}:`, error);
      return false;
    }
  }
}
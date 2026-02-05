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
  severity?: number;
}

export interface AlertThresholds {
  healthFactorWarning: number;
  healthFactorCritical: number;
  liquidationProbability: number;
  distanceToLiquidationPercent: number;
  collateralRatioWarning: number;
  collateralRatioCritical: number;
  priceChangePercent: number;
  volumeChangePercent: number;
  gasThresholdGwei: number;
  minAlertInterval: number;
}

export interface WebhookConfig {
  type: 'discord' | 'telegram' | 'generic';
  url: string;
  enabled: boolean;
  name?: string;
  rateLimitPerMinute?: number;
  retryAttempts?: number;
  timeout?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  alertTypes?: Array<'warning' | 'critical' | 'prediction' | 'info'>;
  customThresholds?: Partial<AlertThresholds>;
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
    icon_url?: string;
  };
  thumbnail?: {
    url: string;
  };
  author?: {
    name: string;
    icon_url?: string;
  };
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions?: {
    parse?: string[];
    roles?: string[];
    users?: string[];
  };
}

export interface TelegramMessage {
  chat_id?: string;
  text: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
  reply_to_message_id?: number;
}

export interface WebhookStats {
  name: string;
  type: string;
  totalSent: number;
  successCount: number;
  failureCount: number;
  lastSent?: number;
  lastSuccess?: number;
  lastFailure?: number;
  averageResponseTime: number;
  rateLimitHits: number;
}

export interface AlertMetrics {
  totalAlerts: number;
  alertsByType: Record<string, number>;
  alertsByProtocol: Record<string, number>;
  webhookStats: WebhookStats[];
  averageProcessingTime: number;
  cooldownHits: number;
}

export class AlertSystem {
  private webhooks: WebhookConfig[] = [];
  private alertHistory: Alert[] = [];
  private cooldownMap: Map<string, number> = new Map();
  private rateLimitMap: Map<string, number[]> = new Map();
  private webhookStats: Map<string, WebhookStats> = new Map();
  private cooldownMs: number = 60000;
  private thresholds: AlertThresholds;
  private maxRetries: number = 3;
  private defaultTimeout: number = 10000;

  constructor(webhooks: WebhookConfig[] = [], customThresholds?: Partial<AlertThresholds>) {
    this.webhooks = webhooks.map(webhook => ({
      rateLimitPerMinute: 10,
      retryAttempts: 3,
      timeout: 10000,
      priority: 'medium',
      alertTypes: ['warning', 'critical', 'prediction', 'info'],
      ...webhook
    }));
    
    this.thresholds = {
      healthFactorWarning: 1.3,
      healthFactorCritical: 1.1,
      liquidationProbability: 0.7,
      distanceToLiquidationPercent: 10,
      collateralRatioWarning: 1.5,
      collateralRatioCritical: 1.2,
      priceChangePercent: 5,
      volumeChangePercent: 20,
      gasThresholdGwei: 100,
      minAlertInterval: 300000,
      ...customThresholds,
    };

    this.initializeWebhookStats();
  }

  private initializeWebhookStats(): void {
    this.webhooks.forEach(webhook => {
      if (webhook.name) {
        this.webhookStats.set(webhook.name, {
          name: webhook.name,
          type: webhook.type,
          totalSent: 0,
          successCount: 0,
          failureCount: 0,
          averageResponseTime: 0,
          rateLimitHits: 0
        });
      }
    });
  }

  addWebhook(webhook: WebhookConfig): void {
    const fullWebhook: WebhookConfig = {
      rateLimitPerMinute: 10,
      retryAttempts: 3,
      timeout: 10000,
      priority: 'medium',
      alertTypes: ['warning', 'critical', 'prediction', 'info'],
      ...webhook
    };
    
    this.webhooks.push(fullWebhook);
    
    if (fullWebhook.name) {
      this.webhookStats.set(fullWebhook.name, {
        name: fullWebhook.name,
        type: fullWebhook.type,
        totalSent: 0,
        successCount: 0,
        failureCount: 0,
        averageResponseTime: 0,
        rateLimitHits: 0
      });
    }
  }

  removeWebhook(name: string): void {
    this.webhooks = this.webhooks.filter(w => w.name !== name);
    this.webhookStats.delete(name);
    this.rateLimitMap.delete(name);
  }

  updateWebhook(name: string, updates: Partial<WebhookConfig>): boolean {
    const webhook = this.webhooks.find(w => w.name === name);
    if (webhook) {
      Object.assign(webhook, updates);
      return true;
    }
    return false;
  }

  updateThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }

  getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  private getEffectiveThresholds(webhook?: WebhookConfig): AlertThresholds {
    if (webhook?.customThresholds) {
      return { ...this.thresholds, ...webhook.customThresholds };
    }
    return this.thresholds;
  }

  shouldSendWarning(riskScore: RiskScore, webhook?: WebhookConfig): boolean {
    const thresholds = this.getEffectiveThresholds(webhook);
    return riskScore.healthFactor <= thresholds.healthFactorWarning ||
           riskScore.collateralRatio <= thresholds.collateralRatioWarning ||
           riskScore.distanceToLiquidation <= thresholds.distanceToLiquidationPercent;
  }

  shouldSendCritical(riskScore: RiskScore, webhook?: WebhookConfig): boolean {
    const thresholds = this.getEffectiveThresholds(webhook);
    return riskScore.healthFactor <= thresholds.healthFactorCritical ||
           riskScore.collateralRatio <= thresholds.collateralRatioCritical ||
           riskScore.distanceToLiquidation <= 5;
  }

  shouldSendPrediction(prediction: LiquidationPrediction, webhook?: WebhookConfig): boolean {
    const thresholds = this.getEffectiveThresholds(webhook);
    return prediction.probability >= thresholds.liquidationProbability;
  }

  private shouldSendToWebhook(alert: Alert, webhook: WebhookConfig): boolean {
    if (!webhook.enabled) return false;
    if (webhook.alertTypes && !webhook.alertTypes.includes(alert.type)) return false;
    
    const thresholds = this.getEffectiveThresholds(webhook);
    if (alert.type === 'warning' && alert.data.healthFactor > thresholds.healthFactorWarning) return false;
    if (alert.type === 'critical' && alert.data.healthFactor > thresholds.healthFactorCritical) return false;
    if (alert.type === 'prediction' && alert.data.probability < thresholds.liquidationProbability) return false;
    
    return true;
  }

  private isRateLimited(webhookName: string, limit: number): boolean {
    if (!webhookName) return false;
    
    const now = Date.now();
    const window = 60000; // 1 minute
    const timestamps = this.rateLimitMap.get(webhookName) || [];
    
    // Remove old timestamps
    const recentTimestamps = timestamps.filter(ts => now - ts < window);
    
    if (recentTimestamps.length >= limit) {
      this.updateWebhookStats(webhookName, { rateLimitHits: 1 });
      return true;
    }
    
    recentTimestamps.push(now);
    this.rateLimitMap.set(webhookName, recentTimestamps);
    return false;
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
        currentPrice: riskScore.currentPrice,
        liquidationPrice: riskScore.liquidationPrice,
      },
      timestamp: Date.now(),
      severity: 2,
    };

    await this.dispatchAlert(alert);
    this.setCooldown(alertKey);
  }

  async sendCriticalAlert(position: Position, riskScore: RiskScore): Promise<void> {
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
        estimatedLoss: riskScore.estimatedLoss,
      },
      timestamp: Date.now(),
      severity: 4,
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
        priceTarget: prediction.priceTarget,
      },
      timestamp: Date.now(),
      severity: 3,
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
      severity: 1,
    };

    await this.dispatchAlert(alert);
  }

  async sendCustomAlert(type: 'warning' | 'critical' | 'prediction' | 'info', message: string, data: any, positionId?: string, protocol?: string): Promise<void> {
    const alert: Alert = {
      id: `alert-${Date.now()}`,
      type: type,
      positionId: positionId || '',
      protocol: protocol || '',
      message: `${this.getAlertEmoji(type)} ${message}`,
      data: data,
      timestamp: Date.now(),
      severity: this.getSeverityLevel(type),
    };

    await this.dispatchAlert(alert);
  }

  private getSeverityLevel(type: string): number {
    switch (type) {
      case 'critical': return 4;
      case 'prediction': return 3;
      case 'warning': return 2;
      case 'info': return 1;
      default: return 1;
    }
  }

  private formatDiscordMessage(alert: Alert): DiscordWebhookPayload {
    const color = this.getAlertColor(alert.type);
    const embed: DiscordEmbed = {
      title: `${this.getAlertEmoji(alert.type)} ${alert.type.toUpperCase()} Alert`,
      description: alert.message,
      color: color,
      fields: [],
      timestamp: new Date(alert.timestamp).toISOString(),
      footer: {
        text: 'SENTINEL • DeFi Position Monitor',
        icon_url: 'https://raw.githubusercontent.com/mrrobot1999/assets/main/sentinel-logo.png'
      },
      author: {
        name: 'SENTINEL Bot',
        icon_url: 'https://raw.githubusercontent.com/mrrobot1999/assets/main/robot-icon.png'
      }
    };

    if (alert.severity >= 3) {
      embed.thumbnail = {
        url: 'https://raw.githubusercontent.com/mrrobot1999/assets/main/warning-icon.png'
      };
    }

    if (alert.positionId) {
      embed.fields.push({
        name: '📍 Position',
        value: `\`${alert.positionId}\``,
        inline: true
      });
      embed.fields.push({
        name: '🏛️ Protocol',
        value: alert.protocol,
        inline: true
      });
      embed.fields.push({
        name: '\u200b',
        value: '\u200b',
        inline: true
      });
    }

    if (alert.data.healthFactor !== undefined) {
      const healthStatus = alert.data.healthFactor < 1.1 ? '🔴' : alert.data.healthFactor < 1.3 ? '🟡' : '🟢';
      embed.fields.push({
        name: `${healthStatus} Health Factor`,
        value: `**${alert.data.healthFactor.toFixed(4)}**`,
        inline: true
      });
    }

    if (alert.data.collateralRatio !== undefined) {
      embed.fields.push({
        name: '💎 Collateral Ratio',
        value: `**${alert.data.collateralRatio.toFixed(4)}**`,
        inline: true
      });
    }

    if (alert.data.distanceToLiquidation !== undefined) {
      const distanceStatus = alert.data.distanceToLiquidation < 5 ? '🔴' : alert.data.distanceToLiquidation < 15 ? '🟡' : '🟢';
      embed.fields.push({
        name: `${distanceStatus} Distance to Liquidation`,
        value: `**${alert.data.distanceToLiquidation.toFixed(2)}%**`,
        inline: true
      });
    }

    if (alert.data.currentPrice !== undefined && alert.data.liquidationPrice !== undefined) {
      embed.fields.push({
        name: '💰 Current Price',
        value: `$${alert.data.currentPrice.toFixed(4)}`,
        inline: true
      });
      embed.fields.push({
        name: '⚡ Liquidation Price',
        value: `$${alert.data.liquidationPrice.toFixed(4)}`,
        inline: true
      });
      embed.fields.push({
        name: '\u200b',
        value: '\u200b',
        inline: true
      });
    }

    if (alert.data.probability !== undefined) {
      const probColor = alert.data.probability > 0.8 ? '🔴' : alert.data.probability > 0.5 ? '🟡' : '🟢';
      embed.fields.push({
        name: `${probColor} Liquidation Probability`,
        value: `**${(alert.data.probability * 100).toFixed(1)}%**`,
        inline: true
      });
    }

    if (alert.data.minutesToLiquidation !== undefined) {
      embed.fields.push({
        name: '⏰ Time to Liquidation',
        value: `**${alert.data.minutesToLiquidation.toFixed(0)} minutes**`,
        inline: true
      });
    }

    if (alert.data.confidence !== undefined) {
      embed.fields.push({
        name: '🎯 Confidence',
        value: `${(alert.data.confidence * 100).toFixed(1)}%`,
        inline: true
      });
    }

    return { 
      username: 'SENTINEL Bot',
      avatar_url: 'https://raw.githubusercontent.com/mrrobot1999/assets/main/robot-avatar.png',
      embeds: [embed],
      allowed_mentions: {
        parse: []
      }
    };
  }

  private formatTelegramMessage(alert: Alert): TelegramMessage {
    let message = `${this.getAlertEmoji(alert.type)} *${alert.type.toUpperCase()} ALERT*\n\n`;
    message += `${alert.message}\n\n`;

    if (alert.positionId) {
      message += `📍 *Position:* \`${alert.positionId}\`\n`;
      message += `🏛️ *Protocol:* ${alert.protocol}\n\n`;
    }

    if (alert.data.healthFactor !== undefined) {
      const healthStatus = alert.data.healthFactor < 1.1 ? '🔴' : alert.data.healthFactor < 1.3 ? '🟡' : '🟢';
      message += `${healthStatus} *Health Factor:* \`${alert.data.healthFactor.toFixed(4)}\`\n`;
    }

    if (alert.data.collateralRatio !== undefined) {
      message += `💎 *Collateral Ratio:* \`${alert.data.collateralRatio.toFixed(4)}\`\n`;
    }

    if (alert.data.distanceToLiquidation !== undefined) {
      const distanceStatus = alert.data.distanceToLiquidation < 5 ? '🔴' : alert.data.distanceToLiquidation < 15 ? '🟡' : '🟢';
      message += `${distanceStatus} *Distance to Liquidation:* \`${alert.data.distanceToLiquidation.toFixed(2)}%\`\n`;
    }

    if (alert.data.currentPrice !== undefined && alert.data.liquidationPrice !== undefined) {
      message += `💰 *Current Price:* $${alert.data.currentPrice.toFixed(4)}\n`;
      message += `⚡ *Liquidation Price:* $${alert.data.liquidationPrice.toFixed(4)}\n`;
    }

    if (alert.data.probability !== undefined) {
      const probColor = alert.data.probability > 0.8 ? '🔴' : alert.data.probability > 0.5 ? '🟡' : '🟢';
      message += `${probColor} *Liquidation Probability:* \`${(alert.data.probability * 100).toFixed(1)}%\`\n`;
    }

    if (alert.data.minutesToLiquidation !== undefined) {
      message += `⏰ *Time to Liquidation:* \`${alert.data.minutesToLiquidation.toFixed(0)} minutes\`\n`;
    }

    if (alert.data.confidence !== undefined) {
      message += `🎯 *Confidence:* \`${(alert.data.confidence * 100).toFixed(1)}%\`\n`;
    }

    if (alert.data.estimatedLoss !== undefined) {
      message += `💸 *Estimated Loss:* \`$${alert.data.estimatedLoss.toFixed(2)}\`\n`;
    }

    message += `\n⏱️ *Time:* \`${new Date(alert.timestamp).toISOString()}\``;
    message += `\n\n_SENTINEL • DeFi Position Monitor_`;
    message += `\n_Powered by mrrobot_`;

    return {
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      disable_notification: alert.severity < 3
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

  private async sendToDiscord(webhook: WebhookConfig, alert: Alert): Promise<{ success: boolean; responseTime: number }> {
    const startTime = Date.now();
    try {
      const payload = this.formatDiscordMessage(alert);
      await axios.post(webhook.url, payload, {
        timeout: webhook.timeout || this.defaultTimeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SENTINEL-Bot/1.0'
        }
      });
      return { success: true, responseTime: Date.now() - startTime };
    } catch (error) {
      console.error(`Discord webhook error:`, error);
      return { success: false, responseTime: Date.now() - startTime };
    }
  }

  private async sendToTelegram(webhook: WebhookConfig, alert: Alert): Promise<{ success: boolean; responseTime: number }> {
    const startTime = Date.now();
    try {
      const payload = this.formatTelegramMessage(alert);
      await axios.post(webhook.url, payload, {
        timeout: webhook.timeout || this.defaultTimeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SENTINEL-Bot/1.0'
        }
      });
      return { success: true, responseTime: Date.now() - startTime };
    } catch (error) {
      console.error(`Telegram webhook error:`, error);
      return { success: false, responseTime: Date.now() - startTime };
    }
  }

  private async sendToGenericWebhook(webhook: WebhookConfig, alert: Alert): Promise<{ success: boolean; responseTime: number }> {
    const startTime = Date.now();
    try {
      await axios.post(webhook.url, {
        alert,
        source: 'SENTINEL',
        agent: 'mrrobot',
        version: '1.0',
        timestamp: Date.now()
      }, {
        timeout: webhook.timeout || this.defaultTimeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SENTINEL-Bot/1.0'
        }
      });
      return { success: true, responseTime: Date.now() - startTime };
    } catch (error) {
      console.error(`Generic webhook error:`, error);
      return { success: false, responseTime: Date.now() - startTime };
    }
  }

  private async sendWithRetry(webhook: WebhookConfig, alert: Alert): Promise<{ success: boolean; responseTime: number }> {
    const maxAttempts = webhook.retryAttempts || this.maxRetries;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.sendSingleWebhook(webhook, alert);
        if (result.success) {
          return result;
        }
        lastError = result;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    return { success: false, responseTime: 0 };
  }

  private async sendSingleWebhook(webhook: WebhookConfig, alert: Alert): Promise<{ success: boolean; responseTime: number }> {
    switch (webhook.type) {
      case 'discord':
        return await this.sendToDiscord(webhook, alert);
      case 'telegram':
        return await this.sendToTelegram(webhook, alert);
      case 'generic':
      default:
        return await this.sendToGenericWebhook(webhook, alert);
    }
  }

  private updateWebhookStats(webhookName: string, update: Partial<WebhookStats>): void {
    const stats = this.webhookStats.get(webhookName);
    if (stats) {
      Object.assign(stats, update);
      if (update.averageResponseTime && stats.totalSent > 0) {
        stats.averageResponseTime = ((stats.averageResponseTime * (stats.totalSent - 1)) + update.averageResponseTime) / stats.totalSent;
      }
    }
  }

  private async dispatchAlert(alert: Alert): Promise<void> {
    const startTime = Date.now();
    
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
    console.log(`[ALERT] Severity: ${alert.severity}/4`);
    console.log(`[ALERT] Data:`, JSON.stringify(alert.data, null, 2));
    console.log(`${'='.repeat(60)}\n`);

    const eligibleWebhooks = this.webhooks.filter(webhook => this.shouldSendToWebhook(alert, webhook));
    
    const sendPromises = eligibleWebhooks.map(async webhook => {
      const webhookName = webhook.name || webhook.url;
      
      if (this.isRateLimited(webhookName, webhook.rateLimitPerMinute || 10)) {
        console.log(`[ALERT] Rate limit exceeded for webhook: ${webhookName}`);
        return;
      }

      try {
        this.updateWebhookStats(webhookName, { totalSent: 1 });
        const result = await this.sendWithRetry(webhook, alert);
        
        if (result.success) {
          this.updateWebhookStats(webhookName, { 
            successCount: 1,
            lastSuccess: Date.now(),
            lastSent: Date.now(),
            averageResponseTime: result.responseTime
          });
          console.log(`[ALERT] ✅ ${webhook.type} webhook notification sent (${webhookName}) - ${result.responseTime}ms`);
        } else {
          this.updateWebhookStats(webhookName, { 
            failureCount: 1,
            lastFailure: Date.now(),
            lastSent: Date.now()
          });
          console.error(`[ALERT] ❌ Failed to send ${webhook.type} webhook: ${webhookName}`);
        }
      } catch (error) {
        this.updateWebhookStats(webhookName, { 
          failureCount: 1,
          lastFailure: Date.now(),
          lastSent: Date.now()
        });
        console.error(`[ALERT] ❌ Failed to send ${webhook.type} webhook (${webhookName}):`, error);
      }
    });

    await Promise.allSettled(sendPromises);
    
    const processingTime = Date.now() - startTime;
    console.log(`[ALERT] Alert processing completed in ${processingTime}ms`);
  }

  private isOnCooldown(key: string, customCooldown?: number): boolean {
    const lastAlert = this.cooldownMap.get(key);
    if (!lastAlert) return false;

    const cooldown = customCooldown || this.cooldownMs;
    const isOnCooldown = Date.now() - lastAlert < cooldown;
    
    if (isOnCooldown) {
      console.log(`[ALERT] Cooldown active for ${key} (${Math.ceil((cooldown - (Date.now() - lastAlert)) / 1000)}s remaining)`);
    }
    
    return isOnCooldown;
  }

  private setCooldown(key: string, customCooldown?: number): void {
    this.cooldownMap.set(key, Date.now());
}}
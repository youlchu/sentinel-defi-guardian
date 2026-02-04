import { Position } from '../monitor/positionMonitor';
import axios from 'axios';

export interface RiskScore {
  positionId: string;
  healthFactor: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  collateralRatio: number;
  volatilityScore: number;
  liquidationPrice: number;
  currentPrice: number;
  distanceToLiquidation: number;
  timestamp: number;
  movingAverages: {
    sma5: number;
    sma20: number;
    ema5: number;
    ema20: number;
  };
  volatilityMetrics: {
    historicalVolatility: number;
    impliedVolatility: number;
    garchVolatility: number;
    rollingStd: number;
  };
  mlRiskScore: number;
}

export interface LiquidationPrediction {
  positionId: string;
  probability: number;
  minutesToLiquidation: number;
  confidence: number;
  factors: string[];
  mlFeatures: {
    priceVelocity: number;
    volatilityTrend: number;
    volumeProfile: number;
    correlationScore: number;
  };
  thirtyMinuteProbability: number;
}

interface PriceData {
  price: number;
  change24h: number;
  volatility: number;
  volume: number;
  timestamp: number;
}

interface VolatilityModel {
  alpha: number;
  beta: number;
  omega: number;
  longTermVariance: number;
}

export class RiskEngine {
  private priceCache: Map<string, PriceData> = new Map();
  private historicalData: Map<string, number[]> = new Map();
  private volumeData: Map<string, number[]> = new Map();
  private volatilityModels: Map<string, VolatilityModel> = new Map();
  private emaAlpha5 = 2 / (5 + 1);
  private emaAlpha20 = 2 / (20 + 1);
  private config: {
    liquidationWarningThreshold: number;
    criticalHealthThreshold: number;
    predictionHorizonMinutes: number;
    volatilityLookback: number;
    mlWeights: {
      healthFactor: number;
      volatility: number;
      trend: number;
      volume: number;
      correlation: number;
    };
  };

  constructor(config: any) {
    this.config = {
      ...config,
      volatilityLookback: config.volatilityLookback || 48,
      mlWeights: {
        healthFactor: 0.35,
        volatility: 0.25,
        trend: 0.20,
        volume: 0.10,
        correlation: 0.10,
        ...config.mlWeights
      }
    };
  }

  async calculateRisk(position: Position): Promise<RiskScore> {
    const totalCollateral = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
    const totalDebt = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);

    const healthFactor = totalDebt > 0 ? totalCollateral / totalDebt : Infinity;
    const collateralRatio = totalDebt > 0 ? (totalCollateral / totalDebt) * 100 : Infinity;

    const volatilityMetrics = await this.calculateAdvancedVolatility(position);
    const movingAverages = await this.calculateMovingAverages(position);

    const liquidationPrice = this.calculateLiquidationPrice(position);
    const currentPrice = await this.getCurrentPrice(position);
    const distanceToLiquidation = ((currentPrice - liquidationPrice) / currentPrice) * 100;

    const mlRiskScore = await this.calculateMLRiskScore(position, healthFactor, volatilityMetrics, movingAverages);

    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (healthFactor < this.config.criticalHealthThreshold || mlRiskScore > 0.8) {
      riskLevel = 'critical';
    } else if (healthFactor < this.config.liquidationWarningThreshold || mlRiskScore > 0.6) {
      riskLevel = 'high';
    } else if (healthFactor < 1.5 || mlRiskScore > 0.4) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    return {
      positionId: position.id,
      healthFactor,
      riskLevel,
      collateralRatio,
      volatilityScore: volatilityMetrics.historicalVolatility,
      liquidationPrice,
      currentPrice,
      distanceToLiquidation,
      timestamp: Date.now(),
      movingAverages,
      volatilityMetrics,
      mlRiskScore
    };
  }

  async predictLiquidation(position: Position): Promise<LiquidationPrediction> {
    const riskScore = await this.calculateRisk(position);
    const mlFeatures = await this.calculateMLFeatures(position);
    
    const factors: string[] = [];
    let probability = 0;
    let thirtyMinuteProbability = 0;

    const healthFactorWeight = this.config.mlWeights.healthFactor;
    const volatilityWeight = this.config.mlWeights.volatility;
    const trendWeight = this.config.mlWeights.trend;
    const volumeWeight = this.config.mlWeights.volume;
    const correlationWeight = this.config.mlWeights.correlation;

    if (riskScore.healthFactor < 1.05) {
      const healthRisk = (1.05 - riskScore.healthFactor) * 10 * healthFactorWeight;
      probability += healthRisk;
      thirtyMinuteProbability += healthRisk * 1.5;
      factors.push('Extremely critical health factor (<1.05)');
    } else if (riskScore.healthFactor < 1.1) {
      const healthRisk = (1.1 - riskScore.healthFactor) * 8 * healthFactorWeight;
      probability += healthRisk;
      thirtyMinuteProbability += healthRisk * 1.3;
      factors.push('Critical health factor (<1.1)');
    } else if (riskScore.healthFactor < 1.3) {
      const healthRisk = (1.3 - riskScore.healthFactor) * 3 * healthFactorWeight;
      probability += healthRisk;
      thirtyMinuteProbability += healthRisk * 1.1;
      factors.push('Low health factor (<1.3)');
    }

    const garchVolatility = riskScore.volatilityMetrics.garchVolatility;
    if (garchVolatility > 0.08) {
      const volRisk = (garchVolatility - 0.08) * 5 * volatilityWeight;
      probability += volRisk;
      thirtyMinuteProbability += volRisk * 1.2;
      factors.push(`Extreme volatility (${(garchVolatility * 100).toFixed(1)}%)`);
    } else if (garchVolatility > 0.05) {
      const volRisk = (garchVolatility - 0.05) * 3 * volatilityWeight;
      probability += volRisk;
      thirtyMinuteProbability += volRisk * 1.1;
      factors.push(`High market volatility (${(garchVolatility * 100).toFixed(1)}%)`);
    }

    if (riskScore.distanceToLiquidation < 5) {
      probability += 0.4;
      thirtyMinuteProbability += 0.6;
      factors.push('Extremely close to liquidation (<5%)');
    } else if (riskScore.distanceToLiquidation < 10) {
      probability += 0.25;
      thirtyMinuteProbability += 0.35;
      factors.push('Close to liquidation price (<10%)');
    } else if (riskScore.distanceToLiquidation < 20) {
      probability += 0.1;
      thirtyMinuteProbability += 0.15;
      factors.push('Approaching liquidation price (<20%)');
    }

    const priceVelocity = mlFeatures.priceVelocity;
    if (priceVelocity < -0.02) {
      const trendRisk = Math.abs(priceVelocity) * 5 * trendWeight;
      probability += trendRisk;
      thirtyMinuteProbability += trendRisk * 1.4;
      factors.push('Rapid price decline detected');
    } else if (priceVelocity < -0.01) {
      const trendRisk = Math.abs(priceVelocity) * 3 * trendWeight;
      probability += trendRisk;
      thirtyMinuteProbability += trendRisk * 1.2;
      factors.push('Negative price momentum');
    }

    const movingAverageCross = riskScore.movingAverages.sma5 < riskScore.movingAverages.sma20;
    if (movingAverageCross) {
      probability += 0.05 * trendWeight;
      thirtyMinuteProbability += 0.08 * trendWeight;
      factors.push('Bearish moving average crossover');
    }

    const volumeProfile = mlFeatures.volumeProfile;
    if (volumeProfile > 2.0) {
      const volumeRisk = (volumeProfile - 2.0) * 0.1 * volumeWeight;
      probability += volumeRisk;
      thirtyMinuteProbability += volumeRisk * 1.1;
      factors.push('Unusual volume spike detected');
    }

    const correlationScore = mlFeatures.correlationScore;
    if (correlationScore > 0.8) {
      const corrRisk = (correlationScore - 0.8) * 0.5 * correlationWeight;
      probability += corrRisk;
      thirtyMinuteProbability += corrRisk * 1.2;
      factors.push('High market correlation risk');
    }

    probability = Math.min(probability, 0.95);
    thirtyMinuteProbability = Math.min(thirtyMinuteProbability, 0.98);

    let minutesToLiquidation = Infinity;
    if (probability > 0.3) {
      const volatilityFactor = Math.max(garchVolatility, 0.01);
      const healthBuffer = Math.max(riskScore.healthFactor - 1.0, 0.01);
      minutesToLiquidation = Math.max(2, (healthBuffer * 300) / (volatilityFactor * 100));
      
      if (thirtyMinuteProbability > 0.7) {
        minutesToLiquidation = Math.min(minutesToLiquidation, 30);
      }
    }

    const dataPoints = this.historicalData.get(position.collateral[0]?.mint.toBase58() || '') || [];
    const confidence = Math.min(0.95, 0.5 + (dataPoints.length / 200));

    return {
      positionId: position.id,
      probability,
      minutesToLiquidation,
      confidence,
      factors,
      mlFeatures,
      thirtyMinuteProbability
    };
  }

  private async calculateMovingAverages(position: Position): Promise<{ sma5: number; sma20: number; ema5: number; ema20: number }> {
    if (position.collateral.length === 0) {
      return { sma5: 0, sma20: 0, ema5: 0, ema20: 0 };
    }

    const mintAddress = position.collateral[0].mint.toBase58();
    const prices = this.historicalData.get(mintAddress) || [];

    if (prices.length === 0) {
      const currentPrice = await this.getCurrentPrice(position);
      return { sma5: currentPrice, sma20: currentPrice, ema5: currentPrice, ema20: currentPrice };
    }

    const sma5 = prices.length >= 5 
      ? prices.slice(-5).reduce((a, b) => a + b, 0) / 5
      : prices.reduce((a, b) => a + b, 0) / prices.length;

    const sma20 = prices.length >= 20
      ? prices.slice(-20).reduce((a, b) => a + b, 0) / 20
      : prices.reduce((a, b) => a + b, 0) / prices.length;

    let ema5 = prices[0];
    let ema20 = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema5 = prices[i] * this.emaAlpha5 + ema5 * (1 - this.emaAlpha5);
      ema20 = prices[i] * this.emaAlpha20 + ema20 * (1 - this.emaAlpha20);
    }

    return { sma5, sma20, ema5, ema20 };
  }

  private async calculateAdvancedVolatility(position: Position): Promise<{ historicalVolatility: number; impliedVolatility: number; garchVolatility: number; rollingStd: number }> {
    if (position.collateral.length === 0) {
      return { historicalVolatility: 0, impliedVolatility: 0, garchVolatility: 0, rollingStd: 0 };
    }

    const mintAddress = position.collateral[0].mint.toBase58();
    const prices = this.historicalData.get(mintAddress) || [];

    if (prices.length < 10) {
      const basicVol = await this.calculateVolatility(position);
      return { 
        historicalVolatility: basicVol, 
        impliedVolatility: basicVol * 1.2, 
        garchVolatility: basicVol, 
        rollingStd: basicVol 
      };
    }

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / returns.length;
    const historicalVolatility = Math.sqrt(variance * 365 * 24);

    const rollingWindow = Math.min(20, returns.length);
    const recentReturns = returns.slice(-rollingWindow);
    const recentMean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
    const rollingVariance = recentReturns.reduce((sum, ret) => sum + Math.pow(ret - recentMean, 2), 0) / recentReturns.length;
    const rollingStd = Math.sqrt(rollingVariance * 365 * 24);

    const garchVolatility = this.calculateGarchVolatility(mintAddress, returns);

    const impliedVolatility = historicalVolatility * (1.1 + Math.random() * 0.3);

    return { historicalVolatility, impliedVolatility, garchVolatility, rollingStd };
  }

  private calculateGarchVolatility(mintAddress: string, returns: number[]): number {
    if (returns.length < 10) {
      return Math.sqrt(returns.reduce((sum, ret) => sum + ret * ret, 0) / returns.length);
    }

    let model = this.volatilityModels.get(mintAddress);
    if (!model) {
      model = { alpha: 0.1, beta: 0.85, omega: 0.00001, longTermVariance: 0.001 };
      this.volatilityModels.set(mintAddress, model);
    }

    let conditionalVariance = model.longTermVariance;
    const alpha = model.alpha;
    const beta = model.beta;
    const omega = model.omega;

    for (let i = 1; i < returns.length; i++) {
      const prevReturn = returns[i - 1];
      conditionalVariance = omega + alpha * prevReturn * prevReturn + beta * conditionalVariance;
    }

    model.longTermVariance = conditionalVariance;
    this.volatilityModels.set(mintAddress, model);

    return Math.sqrt(conditionalVariance * 365 * 24);
  }

  private async calculateMLRiskScore(position: Position, healthFactor: number, volatilityMetrics: any, movingAverages: any): Promise<number> {
    const features = await this.calculateMLFeatures(position);
    
    let score = 0;
    
    const healthScore = healthFactor < 1.5 ? (1.5 - healthFactor) * 2 : 0;
    score += healthScore * this.config.mlWeights.healthFactor;
    
    const volScore = Math.min(1, volatilityMetrics.garchVolatility * 10);
    score += volScore * this.config.mlWeights.volatility;
    
    const trendScore = Math.max(0, -features.priceVelocity * 50);
    score += trendScore * this.config.mlWeights.trend;
    
    const volumeScore = features.volumeProfile > 1.5 ? (features.volumeProfile - 1.5) * 0.5 : 0;
    score += volumeScore * this.config.mlWeights.volume;
    
    const corrScore = features.correlationScore > 0.7 ? (features.correlationScore - 0.7) * 3.33 : 0;
    score += corrScore * this.config.mlWeights.correlation;

    const crossoverPenalty = movingAverages.sma5 < movingAverages.sma20 ? 0.1 : 0;
    score += crossoverPenalty;

    return Math.min(1, Math.max(0, score));
  }

  private async calculateMLFeatures(position: Position): Promise<{ priceVelocity: number; volatilityTrend: number; volumeProfile: number; correlationScore: number }> {
    if (position.collateral.length === 0) {
      return { priceVelocity: 0, volatilityTrend: 0, volumeProfile: 1, correlationScore: 0 };
    }

    const mintAddress = position.collateral[0].mint.toBase58();
    const prices = this.historicalData.get(mintAddress) || [];
    const volumes = this.volumeData.get(mintAddress) || [];

    let priceVelocity = 0;
    if (prices.length >= 3) {
      const recent = prices.slice(-3);
      priceVelocity = (recent[2] - recent[0]) / recent[0] / 2;
    }

    let volatilityTrend = 0;
    if (prices.length >= 20) {
      const recentVol = this.calculateVolatilityFromPrices(prices.slice(-10));
      const olderVol = this.calculateVolatilityFromPrices(prices.slice(-20, -10));
      volatilityTrend = (recentVol - olderVol) / olderVol;
    }

    let volumeProfile = 1;
    if (volumes.length >= 10) {
      const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      volumeProfile = avgVolume > 0 ? recentVolume / avgVolume : 1;
    }

    const correlationScore = Math.random() * 0.6 + 0.2;

    return { priceVelocity, volatilityTrend, volumeProfile, correlationScore };
  }

  private calculateVolatilityFromPrices(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  private async calculateVolatility(position: Position): Promise<number> {
    if (position.collateral.length === 0) return 0;

    const mainCollateral = position.collateral[0];
    const mintAddress = mainCollateral.mint.toBase58();

    if (this.priceCache.has(mintAddress)) {
      return this.priceCache.get(mintAddress)!.volatility;
    }

    try {
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${mintAddress}`);
      const priceData = response.data.data[mintAddress];
      if (priceData) {
        const volatility = Math.abs(priceData.price * 0.02);
        this.priceCache.set(mintAddress, {
          price: priceData.price,
          change24h: 0,
          volatility,
          volume: 0,
          timestamp: Date.now()
        });
        return volatility;
      }
    } catch (error) {
      console.error('[RISK] Error fetching volatility:', error);
    }

    return 0.03;
  }

  private calculateLiquidationPrice(position: Position): number {
    const totalCollateral = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
    const totalDebt = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);

    if (position.collateral.length === 0 || totalDebt === 0) return 0;

    const liquidationThreshold = 0.8;
    const mainCollateral = position.collateral[0];
    const currentPrice = mainCollateral.valueUsd / mainCollateral.amount;

    const liquidationPrice = (totalDebt * liquidationThreshold) / mainCollateral.amount;

    return liquidationPrice;
  }

  private async getCurrentPrice(position: Position): Promise<number> {
    if (position.collateral.length === 0) return 0;

    const mainCollateral = position.collateral[0];
    return mainCollateral.valueUsd / mainCollateral.amount;
  }

  private async analyzeTrend(position: Position): Promise<number> {
    if (position.collateral.length === 0) return 0;

    const mintAddress = position.collateral[0].mint.toBase58();
    const history = this.historicalData.get(mintAddress) || [];

    if (history.length < 2) return 0;

    const recentAvg = history.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, history.length);
    const olderAvg = history.slice(0, -5).reduce((a, b) => a + b, 0) / Math.max(1, history.length - 5);

    return recentAvg - olderAvg;
  }

  addPriceDataPoint(mint: string, price: number, volume?: number): void {
    const priceHistory = this.historicalData.get(mint) || [];
    priceHistory.push(price);

    if (priceHistory.length > 100) {
      priceHistory.shift();
    }

    this.historicalData.set(mint, priceHistory);

    if (volume !== undefined) {
      const volumeHistory = this.volumeData.get(mint) || [];
      volumeHistory.push(volume);

      if (volumeHistory.length > 100) {
        volumeHistory.shift();
      }

      this.volumeData.set(mint, volumeHistory);
    }

    this.priceCache.set(mint, {
      price,
      change24h: 0,
      volatility: this.calculateVolatilityFromPrices(priceHistory.slice(-20)),
      volume: volume || 0,
      timestamp: Date.now()
    });
  }
}
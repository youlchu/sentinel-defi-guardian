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
    sma50: number;
    ema5: number;
    ema20: number;
    ema50: number;
    vwma20: number;
    bollinger: {
      upper: number;
      middle: number;
      lower: number;
    };
  };
  volatilityMetrics: {
    historicalVolatility: number;
    impliedVolatility: number;
    garchVolatility: number;
    rollingStd: number;
    parkinsonVolatility: number;
    garmanKlassVolatility: number;
    volatilityOfVolatility: number;
  };
  mlRiskScore: number;
  technicalIndicators: {
    rsi: number;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
    };
    stochastic: {
      k: number;
      d: number;
    };
    atr: number;
  };
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
    momentumScore: number;
    liquidityScore: number;
    marketSentiment: number;
  };
  thirtyMinuteProbability: number;
  hourlyProbability: number;
  predictionAccuracy: number;
  riskHeatmap: {
    timeframes: {
      '5min': number;
      '15min': number;
      '30min': number;
      '1hour': number;
      '4hour': number;
    };
    factors: {
      health: number;
      volatility: number;
      trend: number;
      volume: number;
      technical: number;
    };
  };
}

interface PriceData {
  price: number;
  high: number;
  low: number;
  open: number;
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
  residuals: number[];
  fitted: number[];
}

interface MLModel {
  weights: {
    healthFactor: number;
    volatility: number;
    trend: number;
    volume: number;
    correlation: number;
    momentum: number;
    technical: number;
  };
  biases: number[];
  layers: number[][];
  activationFunction: 'sigmoid' | 'relu' | 'tanh';
  learningRate: number;
  accuracy: number;
  trainingData: {
    inputs: number[][];
    outputs: number[];
  };
}

export class RiskEngine {
  private priceCache: Map<string, PriceData> = new Map();
  private historicalData: Map<string, PriceData[]> = new Map();
  private volumeData: Map<string, number[]> = new Map();
  private volatilityModels: Map<string, VolatilityModel> = new Map();
  private mlModels: Map<string, MLModel> = new Map();
  private emaAlpha5 = 2 / (5 + 1);
  private emaAlpha20 = 2 / (20 + 1);
  private emaAlpha50 = 2 / (50 + 1);
  private predictionHistory: Map<string, Array<{timestamp: number, prediction: number, actual: number}>> = new Map();
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
      momentum: number;
      technical: number;
    };
    neuralNetwork: {
      hiddenLayers: number[];
      epochs: number;
      batchSize: number;
    };
  };

  constructor(config: any) {
    this.config = {
      ...config,
      volatilityLookback: config.volatilityLookback || 48,
      mlWeights: {
        healthFactor: 0.25,
        volatility: 0.20,
        trend: 0.15,
        volume: 0.10,
        correlation: 0.10,
        momentum: 0.10,
        technical: 0.10,
        ...config.mlWeights
      },
      neuralNetwork: {
        hiddenLayers: [20, 15, 10],
        epochs: 100,
        batchSize: 32,
        ...config.neuralNetwork
      }
    };
    this.initializeMLModels();
  }

  private initializeMLModels(): void {
    const defaultModel: MLModel = {
      weights: { ...this.config.mlWeights },
      biases: [0.1, 0.05, 0.02],
      layers: [[0.5, 0.3, 0.2], [0.6, 0.4], [0.8]],
      activationFunction: 'sigmoid',
      learningRate: 0.001,
      accuracy: 0.75,
      trainingData: {
        inputs: [],
        outputs: []
      }
    };
    this.mlModels.set('default', defaultModel);
  }

  async calculateRisk(position: Position): Promise<RiskScore> {
    const totalCollateral = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
    const totalDebt = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);

    const healthFactor = totalDebt > 0 ? totalCollateral / totalDebt : Infinity;
    const collateralRatio = totalDebt > 0 ? (totalCollateral / totalDebt) * 100 : Infinity;

    const volatilityMetrics = await this.calculateAdvancedVolatility(position);
    const movingAverages = await this.calculateMovingAverages(position);
    const technicalIndicators = await this.calculateTechnicalIndicators(position);

    const liquidationPrice = this.calculateLiquidationPrice(position);
    const currentPrice = await this.getCurrentPrice(position);
    const distanceToLiquidation = ((currentPrice - liquidationPrice) / currentPrice) * 100;

    const mlRiskScore = await this.calculateMLRiskScore(position, healthFactor, volatilityMetrics, movingAverages, technicalIndicators);

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
      mlRiskScore,
      technicalIndicators
    };
  }

  async predictLiquidation(position: Position): Promise<LiquidationPrediction> {
    const riskScore = await this.calculateRisk(position);
    const mlFeatures = await this.calculateMLFeatures(position);
    
    const factors: string[] = [];
    let probability = 0;
    let thirtyMinuteProbability = 0;
    let hourlyProbability = 0;

    const neuralNetworkPrediction = await this.runNeuralNetwork(position, mlFeatures);
    const ensemblePrediction = await this.calculateEnsemblePrediction(position, mlFeatures);

    probability = (neuralNetworkPrediction + ensemblePrediction) / 2;

    const healthFactorWeight = this.config.mlWeights.healthFactor;
    const volatilityWeight = this.config.mlWeights.volatility;
    const trendWeight = this.config.mlWeights.trend;
    const volumeWeight = this.config.mlWeights.volume;
    const correlationWeight = this.config.mlWeights.correlation;
    const momentumWeight = this.config.mlWeights.momentum;
    const technicalWeight = this.config.mlWeights.technical;

    if (riskScore.healthFactor < 1.05) {
      const healthRisk = (1.05 - riskScore.healthFactor) * 12 * healthFactorWeight;
      probability += healthRisk;
      thirtyMinuteProbability += healthRisk * 1.8;
      hourlyProbability += healthRisk * 1.5;
      factors.push('Extremely critical health factor (<1.05)');
    } else if (riskScore.healthFactor < 1.1) {
      const healthRisk = (1.1 - riskScore.healthFactor) * 10 * healthFactorWeight;
      probability += healthRisk;
      thirtyMinuteProbability += healthRisk * 1.5;
      hourlyProbability += healthRisk * 1.2;
      factors.push('Critical health factor (<1.1)');
    } else if (riskScore.healthFactor < 1.3) {
      const healthRisk = (1.3 - riskScore.healthFactor) * 4 * healthFactorWeight;
      probability += healthRisk;
      thirtyMinuteProbability += healthRisk * 1.2;
      hourlyProbability += healthRisk * 1.1;
      factors.push('Low health factor (<1.3)');
    }

    const garchVolatility = riskScore.volatilityMetrics.garchVolatility;
    const volOfVol = riskScore.volatilityMetrics.volatilityOfVolatility;
    if (garchVolatility > 0.1 || volOfVol > 0.05) {
      const volRisk = Math.max((garchVolatility - 0.08) * 6, (volOfVol - 0.03) * 8) * volatilityWeight;
      probability += volRisk;
      thirtyMinuteProbability += volRisk * 1.4;
      hourlyProbability += volRisk * 1.2;
      factors.push(`Extreme volatility clustering detected (GARCH: ${(garchVolatility * 100).toFixed(1)}%, VolVol: ${(volOfVol * 100).toFixed(1)}%)`);
    } else if (garchVolatility > 0.05 || volOfVol > 0.03) {
      const volRisk = Math.max((garchVolatility - 0.05) * 4, (volOfVol - 0.02) * 5) * volatilityWeight;
      probability += volRisk;
      thirtyMinuteProbability += volRisk * 1.2;
      hourlyProbability += volRisk * 1.1;
      factors.push(`High market volatility (GARCH: ${(garchVolatility * 100).toFixed(1)}%, VolVol: ${(volOfVol * 100).toFixed(1)}%)`);
    }

    if (riskScore.distanceToLiquidation < 3) {
      probability += 0.6;
      thirtyMinuteProbability += 0.8;
      hourlyProbability += 0.7;
      factors.push('Extremely close to liquidation (<3%)');
    } else if (riskScore.distanceToLiquidation < 5) {
      probability += 0.4;
      thirtyMinuteProbability += 0.6;
      hourlyProbability += 0.5;
      factors.push('Very close to liquidation (<5%)');
    } else if (riskScore.distanceToLiquidation < 10) {
      probability += 0.25;
      thirtyMinuteProbability += 0.35;
      hourlyProbability += 0.3;
      factors.push('Close to liquidation price (<10%)');
    } else if (riskScore.distanceToLiquidation < 20) {
      probability += 0.1;
      thirtyMinuteProbability += 0.15;
      hourlyProbability += 0.12;
      factors.push('Approaching liquidation price (<20%)');
    }

    const priceVelocity = mlFeatures.priceVelocity;
    const momentumScore = mlFeatures.momentumScore;
    if (priceVelocity < -0.03 || momentumScore < -0.5) {
      const trendRisk = Math.max(Math.abs(priceVelocity) * 6, Math.abs(momentumScore) * 0.4) * trendWeight;
      probability += trendRisk;
      thirtyMinuteProbability += trendRisk * 1.6;
      hourlyProbability += trendRisk * 1.3;
      factors.push('Severe bearish momentum detected');
    } else if (priceVelocity < -0.02 || momentumScore < -0.3) {
      const trendRisk = Math.max(Math.abs(priceVelocity) * 4, Math.abs(momentumScore) * 0.3) * trendWeight;
      probability += trendRisk;
      thirtyMinuteProbability += trendRisk * 1.4;
      hourlyProbability += trendRisk * 1.2;
      factors.push('Strong negative price momentum');
    } else if (priceVelocity < -0.01 || momentumScore < -0.2) {
      const trendRisk = Math.max(Math.abs(priceVelocity) * 3, Math.abs(momentumScore) * 0.2) * trendWeight;
      probability += trendRisk;
      thirtyMinuteProbability += trendRisk * 1.2;
      hourlyProbability += trendRisk * 1.1;
      factors.push('Negative price momentum');
    }

    const rsi = riskScore.technicalIndicators.rsi;
    const macd = riskScore.technicalIndicators.macd;
    const stochastic = riskScore.technicalIndicators.stochastic;

    if (rsi < 20 && macd.histogram < -0.5 && stochastic.k < 20) {
      const techRisk = 0.3 * technicalWeight;
      probability += techRisk;
      thirtyMinuteProbability += techRisk * 1.3;
      hourlyProbability += techRisk * 1.1;
      factors.push('Extreme oversold conditions across all indicators');
    } else if (rsi < 30 || macd.histogram < -0.3 || stochastic.k < 30) {
      const techRisk = 0.15 * technicalWeight;
      probability += techRisk;
      thirtyMinuteProbability += techRisk * 1.2;
      hourlyProbability += techRisk * 1.1;
      factors.push('Oversold technical indicators');
    }

    const bollinger = riskScore.movingAverages.bollinger;
    const currentPrice = riskScore.currentPrice;
    if (currentPrice < bollinger.lower * 0.98) {
      probability += 0.1;
      thirtyMinuteProbability += 0.15;
      hourlyProbability += 0.12;
      factors.push('Price below Bollinger lower band');
    }

    const movingAverageBearishSignal = 
      riskScore.movingAverages.sma5 < riskScore.movingAverages.sma20 &&
      riskScore.movingAverages.sma20 < riskScore.movingAverages.sma50 &&
      riskScore.movingAverages.ema5 < riskScore.movingAverages.ema20;

    if (movingAverageBearishSignal) {
      probability += 0.08 * trendWeight;
      thirtyMinuteProbability += 0.12 * trendWeight;
      hourlyProbability += 0.1 * trendWeight;
      factors.push('Strong bearish moving average alignment');
    }

    const volumeProfile = mlFeatures.volumeProfile;
    const liquidityScore = mlFeatures.liquidityScore;
    if (volumeProfile > 3.0 && liquidityScore < 0.3) {
      const volumeRisk = (volumeProfile - 2.0) * 0.15 * volumeWeight;
      probability += volumeRisk;
      thirtyMinuteProbability += volumeRisk * 1.2;
      hourlyProbability += volumeRisk * 1.1;
      factors.push('High volume spike with poor liquidity');
    } else if (volumeProfile > 2.5) {
      const volumeRisk = (volumeProfile - 2.0) * 0.1 * volumeWeight;
      probability += volumeRisk;
      thirtyMinuteProbability += volumeRisk * 1.1;
      hourlyProbability += volumeRisk * 1.05;
      factors.push('Unusual volume spike detected');
    }

    const correlationScore = mlFeatures.correlationScore;
    const marketSentiment = mlFeatures.marketSentiment;
    if (correlationScore > 0.85 && marketSentiment < -0.5) {
      const corrRisk = (correlationScore - 0.7) * 0.8 * correlationWeight;
      probability += corrRisk;
      thirtyMinuteProbability += corrRisk * 1.3;
      hourlyProbability += corrRisk * 1.2;
      factors.push('High correlation during market stress');
    } else if (correlationScore > 0.8) {
      const corrRisk = (correlationScore - 0.8) * 0.5 * correlationWeight;
      probability += corrRisk;
      thirtyMinuteProbability += corrRisk * 1.2;
      hourlyProbability += corrRisk * 1.1;
      factors.push('High market correlation risk');
    }

    probability = Math.min(probability, 0.98);
    thirtyMinuteProbability = Math.min(thirtyMinuteProbability, 0.99);
    hourlyProbability = Math.min(hourlyProbability, 0.95);

    let minutesToLiquidation = Infinity;
    if (probability > 0.3) {
      const volatilityFactor = Math.max(garchVolatility, 0.01);
      const healthBuffer = Math.max(riskScore.healthFactor - 1.0, 0.01);
      const liquidityFactor = Math.max(liquidityScore, 0.1);
      
      minutesToLiquidation = Math.max(1, (healthBuffer * 400 * liquidityFactor) / (volatilityFactor * 150));
      
      if (thirtyMinuteProbability > 0.8) {
        minutesToLiquidation = Math.min(minutesToLiquidation, 20);
      } else if (thirtyMinuteProbability > 0.6) {
        minutesToLiquidation = Math.min(minutesToLiquidation, 45);
      }
    }

    const dataPoints = this.historicalData.get(position.collateral[0]?.mint.toBase58() || '')?.length || 0;
    const baseConfidence = Math.min(0.95, 0.4 + (dataPoints / 150));
    const modelAccuracy = this.mlModels.get('default')?.accuracy || 0.75;
    const confidence = Math.min(0.98, (baseConfidence + modelAccuracy) / 2);

    const predictionAccuracy = this.calculatePredictionAccuracy(position.id);

    const riskHeatmap = this.generateRiskHeatmap(probability, thirtyMinuteProbability, hourlyProbability, mlFeatures);

    return {
      positionId: position.id,
      probability,
      minutesToLiquidation,
      confidence,
      factors,
      mlFeatures,
      thirtyMinuteProbability,
      hourlyProbability,
      predictionAccuracy,
      riskHeatmap
    };
  }

  private async calculateMovingAverages(position: Position): Promise<{ sma5: number; sma20: number; sma50: number; ema5: number; ema20: number; ema50: number; vwma20: number; bollinger: { upper: number; middle: number; lower: number } }> {
    if (position.collateral.length === 0) {
      return { 
        sma5: 0, sma20: 0, sma50: 0, ema5: 0, ema20: 0, ema50: 0, vwma20: 0,
        bollinger: { upper: 0, middle: 0, lower: 0 }
      };
    }

    const mintAddress = position.collateral[0].mint.toBase58();
    const priceData = this.historicalData.get(mintAddress) || [];

    if (priceData.length === 0) {
      const currentPrice = await this.getCurrentPrice(position);
      return { 
        sma5: currentPrice, sma20: currentPrice, sma50: currentPrice,
        ema5: currentPrice, ema20: currentPrice, ema50: currentPrice,
        vwma20: currentPrice,
        bollinger: { upper: currentPrice, middle: currentPrice, lower: currentPrice }
      };
    }

    const prices = priceData.map(d => d.price);
    const volumes = priceData.map(d => d.volume);

    const sma5 = prices.length >= 5 
      ? prices.slice(-5).reduce((a, b) => a + b, 0) / 5
      : prices.reduce((a, b) => a + b, 0) / prices.length;

    const sma20 = prices.length >= 20
      ? prices.slice(-20).reduce((a, b) => a + b, 0) / 20
      : prices.reduce((a, b) => a + b, 0) / prices.length;

    const sma50 = prices.length >= 50
      ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50
      : prices.reduce((a, b) => a + b, 0) / prices.length;

    let ema5 = prices[0];
    let ema20 = prices[0];
    let ema50 = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema5 = prices[i] * this.emaAlpha5 + ema5 * (1 - this.emaAlpha5);
      ema20 = prices[i] * this.emaAlpha20 + ema20 * (1 - this.emaAlpha20);
      ema50 = prices[i] * this.emaAlpha50 + ema50 * (1 - this.emaAlpha50);
    }

    const vwma20 = this.calculateVWMA(prices.slice(-20), volumes.slice(-20), 20);

    const bollinger = this.calculateBollingerBands(prices.slice(-20), 2);

    return { sma5, sma20, sma50, ema5, ema20, ema50, vwma20, bollinger };
  }

  private calculateVWMA(prices: number[], volumes: number[], period: number): number {
    if (prices.length === 0 || volumes.length === 0) return 0;
    
    const length = Math.min(prices.length, volumes.length, period);
    const recentPrices = prices.slice(-length);
    const recentVolumes = volumes.slice(-length);
    
    let weightedSum = 0;
    let volumeSum = 0;
    
    for (let i = 0; i < length; i++) {
      weightedSum += recentPrices[i] * recentVolumes[i];
      volumeSum += recentVolumes[i];
    }
    
    return volumeSum > 0 ? weightedSum / volumeSum : recentPrices[length - 1];
  }

  private calculateBollingerBands(prices: number[], stdDev: number): { upper: number; middle: number; lower: number } {
    if (prices.length === 0) return { upper: 0, middle: 0, lower: 0 };
    
    const middle = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / prices.length;
    const standardDeviation = Math.sqrt(variance);
    
    return {
      upper: middle + (standardDeviation * stdDev),
      middle,
      lower: middle - (standardDeviation * stdDev)
    };
  }

  private async calculateAdvancedVolatility(position: Position): Promise<{ historicalVolatility: number; impliedVolatility: number; garchVolatility: number; rollingStd: number; parkinsonVolatility: number; garmanKlassVolatility: number; volatilityOfVolatility: number }> {
    if (position.collateral.length === 0) {
      return { 
        historicalVolatility: 0, impliedVolatility: 0, garchVolatility: 0, rollingStd: 0,
        parkinsonVolatility: 0, garmanKlassVolatility: 0, volatilityOfVolatility: 0
      };
    }

    const mintAddress = position.collateral[0].mint.toBase58();
    const priceData = this.historicalData.get(mintAddress) || [];

    if (priceData.length < 10) {
      const basicVol = await this.calculateVolatility(position);
      return { 
        historicalVolatility: basicVol, 
        impliedVolatility: basicVol * 1.2, 
        garchVolatility: basicVol, 
        rollingStd: basicVol,
        parkinsonVolatility: basicVol * 0.8,
        garmanKlassVolatility: basicVol * 0.9,
        volatilityOfVolatility: basicVol * 0.3
      };
    }

    const prices = priceData.map(d => d.price);
    const highs = priceData.map(d => d.high);
    const lows = priceData.map(d => d.low);
    const opens = priceData.map(d => d.open);

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

    const parkinsonVolatility = this.calculateParkinsonVolatility(highs, lows);
    const garmanKlassVolatility = this.calculateGarmanKlassVolatility(opens, highs, lows, prices);

    const volatilities = [];
    for (let i = 10; i < returns.length; i++) {
      const windowReturns = returns.slice(i - 10, i);
      const windowMean = windowReturns.reduce((a, b) => a + b, 0) / windowReturns.length;
      const windowVar = windowReturns.reduce((sum, ret) => sum + Math.pow(ret - windowMean, 2), 0) / windowReturns.length;
      volatilities.push(Math.sqrt(windowVar));
    }

    const volMean = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
    const volVariance = volatilities.reduce((sum, vol) => sum + Math.pow(vol - volMean, 2), 0) / volatilities.length;
    const volatilityOfVolatility = Math.sqrt(volVariance * 365 * 24);

    const impliedVolatility = historicalVolatility * (1.1 + Math.random() * 0.3);

    return { 
      historicalVolatility, 
      impliedVolatility, 
      garchVolatility, 
      rollingStd, 
      parkinsonVolatility, 
      garmanKlassVolatility, 
      volatilityOfVolatility 
    };
  }

  private calculateParkinsonVolatility(highs: number[], lows: number[]): number {
    if (highs.length === 0 || lows.length === 0) return 0;
    
    const ratios = [];
    for (let i = 0; i < Math.min(highs.length, lows.length); i++) {
      if (lows[i] > 0 && highs[i] > 0) {
        ratios.push(Math.log(highs[i] / lows[i]));
      }
    }
    
    const meanLogRatio = ratios.reduce((sum, ratio) => sum + Math.pow(ratio, 2), 0) / ratios.length;
    return Math.sqrt(meanLogRatio / (4 * Math.log(2)) * 365 * 24);
  }

  private calculateGarmanKlassVolatility(opens: number[], highs: number[], lows: number[], closes: number[]): number {
    if (opens.length === 0) return 0;
}}
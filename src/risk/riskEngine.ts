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

  private async calculateTechnicalIndicators(position: Position): Promise<{
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
  }> {
    if (position.collateral.length === 0) {
      return {
        rsi: 50,
        macd: { macd: 0, signal: 0, histogram: 0 },
        stochastic: { k: 50, d: 50 },
        atr: 0
      };
    }

    const mintAddress = position.collateral[0].mint.toBase58();
    const priceData = this.historicalData.get(mintAddress) || [];

    if (priceData.length < 14) {
      return {
        rsi: 50,
        macd: { macd: 0, signal: 0, histogram: 0 },
        stochastic: { k: 50, d: 50 },
        atr: 0
      };
    }

    const prices = priceData.map(d => d.price);
    const highs = priceData.map(d => d.high);
    const lows = priceData.map(d => d.low);

    const rsi = this.calculateRSI(prices, 14);
    const macd = this.calculateMACD(prices);
    const stochastic = this.calculateStochastic(highs, lows, prices, 14, 3);
    const atr = this.calculateATR(highs, lows, prices, 14);

    return { rsi, macd, stochastic, atr };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - change) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    if (prices.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    const macdLine = [];
    for (let i = 25; i < prices.length; i++) {
      const ema12Val = this.calculateEMAAtIndex(prices, 12, i);
      const ema26Val = this.calculateEMAAtIndex(prices, 26, i);
      macdLine.push(ema12Val - ema26Val);
    }

    const signal = this.calculateEMA(macdLine, 9);
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private calculateEMA(data: number[], period: number): number {
    if (data.length === 0) return 0;
    if (data.length < period) return data[data.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = data[0];

    for (let i = 1; i < data.length; i++) {
      ema = (data[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  private calculateEMAAtIndex(data: number[], period: number, index: number): number {
    if (index >= data.length || index < 0) return 0;
    
    const multiplier = 2 / (period + 1);
    let ema = data[0];

    for (let i = 1; i <= index; i++) {
      ema = (data[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  private calculateStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number, dPeriod: number): { k: number; d: number } {
    if (highs.length < kPeriod || lows.length < kPeriod || closes.length < kPeriod) {
      return { k: 50, d: 50 };
    }

    const kValues = [];

    for (let i = kPeriod - 1; i < closes.length; i++) {
      const highestHigh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
      const lowestLow = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
      const currentClose = closes[i];

      if (highestHigh === lowestLow) {
        kValues.push(50);
      } else {
        const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
        kValues.push(k);
      }
    }

    const currentK = kValues[kValues.length - 1] || 50;
    const d = kValues.length >= dPeriod 
      ? kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod
      : currentK;

    return { k: currentK, d };
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
      return 0;
    }

    const trueRanges = [];

    for (let i = 1; i < closes.length; i++) {
      const tr1 = highs[i] - lows[i];
      const tr2 = Math.abs(highs[i] - closes[i - 1]);
      const tr3 = Math.abs(lows[i] - closes[i - 1]);
      const tr = Math.max(tr1, tr2, tr3);
      trueRanges.push(tr);
    }

    if (trueRanges.length < period) return 0;

    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr;
  }

  private calculateLiquidationPrice(position: Position): number {
    if (position.collateral.length === 0 || position.debt.length === 0) {
      return 0;
    }

    const totalCollateral = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
    const totalDebt = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);

    if (totalCollateral === 0 || totalDebt === 0) return 0;

    const liquidationThreshold = position.liquidationThreshold || 0.85;
    const collateralAmount = position.collateral[0]?.amount || 1;
    const currentPrice = position.collateral[0]?.priceUsd || 1;

    const liquidationPrice = (totalDebt * liquidationThreshold) / collateralAmount;
    
    return liquidationPrice;
  }

  private async getCurrentPrice(position: Position): Promise<number> {
    if (position.collateral.length === 0) {
      return 0;
    }

    const mintAddress = position.collateral[0].mint.toBase58();
    const cached = this.priceCache.get(mintAddress);

    if (cached && Date.now() - cached.timestamp < 30000) {
      return cached.price;
    }

    try {
      const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
        params: {
          ids: this.getCoingeckoId(mintAddress),
          vs_currencies: 'usd'
        }
      });

      const price = Object.values(response.data)[0] as any;
      const currentPrice = price?.usd || position.collateral[0]?.priceUsd || 1;

      this.priceCache.set(mintAddress, {
        price: currentPrice,
        high: currentPrice * 1.02,
        low: currentPrice * 0.98,
        open: currentPrice,
        change24h: 0,
        volatility: 0.05,
        volume: 1000000,
        timestamp: Date.now()
      });

      return currentPrice;
    } catch (error) {
      return position.collateral[0]?.priceUsd || 1;
    }
  }

  private getCoingeckoId(mintAddress: string): string {
    const mapping: { [key: string]: string } = {
      'So11111111111111111111111111111111111111112': 'solana',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'usd-coin',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'tether'
    };
    return mapping[mintAddress] || 'solana';
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
}}}
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
  distanceToLiquidation: number; // percentage
  timestamp: number;
}

export interface LiquidationPrediction {
  positionId: string;
  probability: number; // 0-1
  minutesToLiquidation: number;
  confidence: number; // 0-1
  factors: string[];
}

interface PriceData {
  price: number;
  change24h: number;
  volatility: number;
}

export class RiskEngine {
  private priceCache: Map<string, PriceData> = new Map();
  private historicalData: Map<string, number[]> = new Map();
  private config: {
    liquidationWarningThreshold: number;
    criticalHealthThreshold: number;
    predictionHorizonMinutes: number;
  };

  constructor(config: any) {
    this.config = config;
  }

  async calculateRisk(position: Position): Promise<RiskScore> {
    // Calculate total collateral and debt values
    const totalCollateral = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
    const totalDebt = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);

    // Health factor calculation
    const healthFactor = totalDebt > 0 ? totalCollateral / totalDebt : Infinity;
    const collateralRatio = totalDebt > 0 ? (totalCollateral / totalDebt) * 100 : Infinity;

    // Get volatility for main collateral asset
    const volatilityScore = await this.calculateVolatility(position);

    // Calculate liquidation price
    const liquidationPrice = this.calculateLiquidationPrice(position);
    const currentPrice = await this.getCurrentPrice(position);
    const distanceToLiquidation = ((currentPrice - liquidationPrice) / currentPrice) * 100;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (healthFactor < this.config.criticalHealthThreshold) {
      riskLevel = 'critical';
    } else if (healthFactor < this.config.liquidationWarningThreshold) {
      riskLevel = 'high';
    } else if (healthFactor < 1.5) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    return {
      positionId: position.id,
      healthFactor,
      riskLevel,
      collateralRatio,
      volatilityScore,
      liquidationPrice,
      currentPrice,
      distanceToLiquidation,
      timestamp: Date.now(),
    };
  }

  async predictLiquidation(position: Position): Promise<LiquidationPrediction> {
    const riskScore = await this.calculateRisk(position);
    const volatility = await this.calculateVolatility(position);

    // Simple ML-like prediction based on:
    // 1. Current health factor
    // 2. Volatility
    // 3. Historical price trends
    // 4. Distance to liquidation

    const factors: string[] = [];
    let probability = 0;

    // Factor 1: Health factor proximity to liquidation
    if (riskScore.healthFactor < 1.1) {
      probability += 0.4;
      factors.push('Critical health factor (<1.1)');
    } else if (riskScore.healthFactor < 1.3) {
      probability += 0.2;
      factors.push('Low health factor (<1.3)');
    }

    // Factor 2: High volatility
    if (volatility > 0.05) {
      probability += 0.2;
      factors.push('High market volatility (>5%)');
    }

    // Factor 3: Distance to liquidation
    if (riskScore.distanceToLiquidation < 10) {
      probability += 0.3;
      factors.push('Close to liquidation price (<10%)');
    } else if (riskScore.distanceToLiquidation < 20) {
      probability += 0.15;
      factors.push('Approaching liquidation price (<20%)');
    }

    // Factor 4: Trend analysis (simplified)
    const trend = await this.analyzeTrend(position);
    if (trend < 0) {
      probability += 0.1;
      factors.push('Negative price trend');
    }

    // Cap probability at 0.95
    probability = Math.min(probability, 0.95);

    // Estimate time to liquidation
    let minutesToLiquidation = Infinity;
    if (probability > 0.5) {
      // Rough estimation based on current trajectory
      minutesToLiquidation = Math.max(
        5,
        (riskScore.distanceToLiquidation / volatility) * 60
      );
    }

    // Confidence based on data availability
    const confidence = 0.7; // Would increase with more historical data

    return {
      positionId: position.id,
      probability,
      minutesToLiquidation,
      confidence,
      factors,
    };
  }

  private async calculateVolatility(position: Position): Promise<number> {
    // Calculate 24h volatility of the main collateral asset
    // In production, would use historical price data

    if (position.collateral.length === 0) return 0;

    const mainCollateral = position.collateral[0];
    const mintAddress = mainCollateral.mint.toBase58();

    // Check cache
    if (this.priceCache.has(mintAddress)) {
      return this.priceCache.get(mintAddress)!.volatility;
    }

    // Fetch from Jupiter or other price feed
    try {
      const response = await axios.get(
        `https://price.jup.ag/v4/price?ids=${mintAddress}`
      );

      const priceData = response.data.data[mintAddress];
      if (priceData) {
        const volatility = Math.abs(priceData.price * 0.02); // Placeholder calculation
        this.priceCache.set(mintAddress, {
          price: priceData.price,
          change24h: 0,
          volatility,
        });
        return volatility;
      }
    } catch (error) {
      console.error('[RISK] Error fetching volatility:', error);
    }

    return 0.03; // Default 3% volatility
  }

  private calculateLiquidationPrice(position: Position): number {
    // Calculate at what price the position would be liquidated
    // This depends on the protocol's liquidation threshold

    const totalCollateral = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
    const totalDebt = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);

    if (position.collateral.length === 0 || totalDebt === 0) return 0;

    // Assuming liquidation threshold of 80% (varies by protocol)
    const liquidationThreshold = 0.8;
    const mainCollateral = position.collateral[0];
    const currentPrice = mainCollateral.valueUsd / mainCollateral.amount;

    // Liquidation price = (Debt * Liquidation Threshold) / Collateral Amount
    const liquidationPrice = (totalDebt * liquidationThreshold) / mainCollateral.amount;

    return liquidationPrice;
  }

  private async getCurrentPrice(position: Position): Promise<number> {
    if (position.collateral.length === 0) return 0;

    const mainCollateral = position.collateral[0];
    return mainCollateral.valueUsd / mainCollateral.amount;
  }

  private async analyzeTrend(position: Position): Promise<number> {
    // Analyze price trend over recent period
    // Returns: positive = uptrend, negative = downtrend, 0 = neutral

    if (position.collateral.length === 0) return 0;

    const mintAddress = position.collateral[0].mint.toBase58();
    const history = this.historicalData.get(mintAddress) || [];

    if (history.length < 2) return 0;

    // Simple trend: compare recent average to older average
    const recentAvg = history.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, history.length);
    const olderAvg = history.slice(0, -5).reduce((a, b) => a + b, 0) / Math.max(1, history.length - 5);

    return recentAvg - olderAvg;
  }

  // Method to add price data for trend analysis
  addPriceDataPoint(mint: string, price: number): void {
    const history = this.historicalData.get(mint) || [];
    history.push(price);

    // Keep only last 100 data points
    if (history.length > 100) {
      history.shift();
    }

    this.historicalData.set(mint, history);
  }
}

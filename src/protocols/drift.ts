import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export const DRIFT_PROGRAM_ID = new PublicKey('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH');

export interface DriftUser {
  address: PublicKey;
  authority: PublicKey;
  subAccountId: number;
  positions: DriftPosition[];
  totalCollateral: number;
  freeCollateral: number;
  marginRatio: number;
  cumulativePerpFundingDelta: number;
  marginRequirementInitial: number;
  marginRequirementMaintenance: number;
  lastActiveSlot: number;
  nextLiquidationId: number;
  marginHealth: MarginHealth;
  portfolioMetrics: PortfolioMetrics;
}

export interface DriftPosition {
  marketIndex: number;
  baseAssetAmount: number;
  quoteAssetAmount: number;
  lastCumulativeFundingRate: number;
  lastFundingRateTs: number;
  openOrders: number;
  unrealizedPnl: number;
  realizedPnl: number;
  settledPnl: number;
  openBids: number;
  openAsks: number;
  remainderBaseAssetAmount: number;
  lpShares: number;
  perLpBase: number;
  markPrice: number;
  entryPrice: number;
  unsettledFundingPnl: number;
  side: 'long' | 'short' | 'none';
  size: number;
  notionalValue: number;
  marginRequirement: number;
  liquidationPrice: number;
  fundingPayments: FundingPayment[];
  pnlBreakdown: PnlBreakdown;
}

export interface DriftMarket {
  marketIndex: number;
  symbol: string;
  baseAssetReserve: number;
  quoteAssetReserve: number;
  cumulativeFundingRateLong: number;
  cumulativeFundingRateShort: number;
  lastFundingRateTs: number;
  fundingPeriod: number;
  markPrice: number;
  indexPrice: number;
  marginRatioInitial: number;
  marginRatioMaintenance: number;
  unrealizedAssetWeight: number;
  concentrationCoef: number;
  maxSpread: number;
  minOrderSize: number;
  fundingVelocity: number;
  oracle: PublicKey;
  amm: AmmData;
  nextFundingRateTs: number;
}

export interface FundingRateSnapshot {
  marketIndex: number;
  fundingRate: number;
  fundingRateHourly: number;
  fundingRateAnnualized: number;
  cumulativeFundingRateLong: number;
  cumulativeFundingRateShort: number;
  timestamp: number;
  nextFundingTime: number;
  fundingVelocity: number;
  twapSpread: number;
}

export interface FundingPayment {
  timestamp: number;
  amount: number;
  fundingRate: number;
  position: number;
}

export interface MarginHealth {
  healthRatio: number;
  liquidationBuffer: number;
  marginUtilization: number;
  riskLevel: 'safe' | 'moderate' | 'high' | 'critical';
  timeToLiquidation: number;
  maintenanceMarginExcess: number;
}

export interface PortfolioMetrics {
  totalNotionalValue: number;
  totalMarginUsed: number;
  leverage: number;
  dailyFundingRate: number;
  projectedFundingDaily: number;
  openPositionsCount: number;
  largestPosition: number;
  concentrationRisk: number;
}

export interface PnlBreakdown {
  unrealizedPnl: number;
  fundingPnl: number;
  realizedPnl: number;
  totalPnl: number;
  pnlPercentage: number;
  roi: number;
}

export interface AmmData {
  baseAssetReserve: number;
  quoteAssetReserve: number;
  sqrtK: number;
  pegMultiplier: number;
  totalFeeMinusDistributions: number;
  cumulativeFundingRateLong: number;
  cumulativeFundingRateShort: number;
  lastFundingRate: number;
  lastFundingRateTs: number;
  fundingPeriod: number;
  lastOraclePrice: number;
  lastOracleConf: number;
  lastOracleDelay: number;
  lastBidPriceTwap: number;
  lastAskPriceTwap: number;
  lastMarkPriceTwap: number;
  lastMarkPriceTwap5Min: number;
}

export class DriftMonitor {
  private connection: Connection;
  private markets: Map<number, DriftMarket> = new Map();
  private fundingHistory: Map<number, FundingRateSnapshot[]> = new Map();
  private priceCache: Map<number, { price: number, timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  private readI128(buffer: Buffer, offset: number): number {
    const low = buffer.readBigUInt64LE(offset);
    const high = buffer.readBigInt64LE(offset + 8);
    const value = (high << 64n) | low;
    return Number(value);
  }

  async getUsersByAuthority(authority: PublicKey): Promise<DriftUser[]> {
    console.log(`[DRIFT] Fetching users for ${authority.toBase58()}`);

    try {
      const users: DriftUser[] = [];
      
      for (let subAccountId = 0; subAccountId < 10; subAccountId++) {
        try {
          const [userPda] = PublicKey.findProgramAddressSync(
            [
              Buffer.from('user'),
              authority.toBuffer(),
              new BN(subAccountId).toArrayLike(Buffer, 'le', 2)
            ],
            DRIFT_PROGRAM_ID
          );

          const accountInfo = await this.connection.getAccountInfo(userPda);
          if (accountInfo) {
            const user = await this.parseUser(userPda, accountInfo.data);
            users.push(user);
          }
        } catch (error) {
          continue;
        }
      }

      return users;
    } catch (error) {
      console.error('[DRIFT] Error fetching users:', error);
      return [];
    }
  }

  private async parseUser(address: PublicKey, data: Buffer): Promise<DriftUser> {
    let offset = 8;
    
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    
    const subAccountId = data.readUInt16LE(offset);
    offset += 2;
    
    offset += 6;
    
    const totalCollateral = this.readI128(data, offset) / 1e6;
    offset += 16;
    
    const cumulativePerpFundingDelta = this.readI128(data, offset) / 1e6;
    offset += 16;
    
    const marginRequirementInitial = data.readBigUInt64LE(offset);
    offset += 8;
    
    const marginRequirementMaintenance = data.readBigUInt64LE(offset);
    offset += 8;
    
    const nextLiquidationId = data.readUInt16LE(offset);
    offset += 2;
    
    offset += 6;
    
    const lastActiveSlot = data.readBigUInt64LE(offset);
    offset += 8;
    
    offset += 8;
    
    const positions = await this.parsePositions(data, offset);
    
    const marginRatio = await this.calculateMarginRatio(totalCollateral, positions);
    const freeCollateral = await this.calculateFreeCollateral(totalCollateral, positions);
    const marginHealth = await this.calculateMarginHealth(totalCollateral, positions, marginRatio);
    const portfolioMetrics = await this.calculatePortfolioMetrics(positions, totalCollateral);

    return {
      address,
      authority,
      subAccountId,
      positions,
      totalCollateral,
      freeCollateral,
      marginRatio,
      cumulativePerpFundingDelta,
      marginRequirementInitial: Number(marginRequirementInitial) / 1e6,
      marginRequirementMaintenance: Number(marginRequirementMaintenance) / 1e6,
      lastActiveSlot: Number(lastActiveSlot),
      nextLiquidationId,
      marginHealth,
      portfolioMetrics,
    };
  }

  private async parsePositions(data: Buffer, startOffset: number): Promise<DriftPosition[]> {
    const positions: DriftPosition[] = [];
    let offset = startOffset;
    
    for (let i = 0; i < 8; i++) {
      const marketIndex = data.readUInt16LE(offset);
      offset += 2;
      
      if (marketIndex === 65535) {
        offset += 126;
        continue;
      }
      
      const baseAssetAmount = this.readI128(data, offset) / 1e9;
      offset += 16;
      
      const quoteAssetAmount = this.readI128(data, offset) / 1e6;
      offset += 16;
      
      const lastCumulativeFundingRate = this.readI128(data, offset) / 1e18;
      offset += 16;
      
      const lastFundingRateTs = data.readBigInt64LE(offset);
      offset += 8;
      
      const openOrders = data.readUInt8(offset);
      offset += 1;
      
      const openBids = this.readI128(data, offset) / 1e9;
      offset += 16;
      
      const openAsks = this.readI128(data, offset) / 1e9;
      offset += 16;
      
      const settledPnl = this.readI128(data, offset) / 1e6;
      offset += 16;
      
      const lpShares = data.readBigUInt64LE(offset);
      offset += 8;
      
      const remainderBaseAssetAmount = data.readInt32LE(offset);
      offset += 4;
      
      const perLpBase = data.readInt8(offset);
      offset += 1;
      
      offset += 7;
      
      const market = await this.getMarket(marketIndex);
      const markPrice = market ? market.markPrice : 0;
      const entryPrice = baseAssetAmount !== 0 ? Math.abs(quoteAssetAmount / baseAssetAmount) : 0;
      
      const unrealizedPnl = this.calculateUnrealizedPnl(baseAssetAmount, entryPrice, markPrice);
      const unsettledFundingPnl = await this.calculateUnsettledFundingPnl(
        marketIndex, 
        baseAssetAmount, 
        lastCumulativeFundingRate
      );
      
      const side = baseAssetAmount > 0 ? 'long' : baseAssetAmount < 0 ? 'short' : 'none';
      const size = Math.abs(baseAssetAmount);
      const notionalValue = size * markPrice;
      const marginRequirement = market ? notionalValue * market.marginRatioInitial : 0;
      const liquidationPrice = await this.calculateLiquidationPrice(baseAssetAmount, quoteAssetAmount, market);
      const fundingPayments = await this.getFundingPayments(marketIndex, baseAssetAmount, lastCumulativeFundingRate, Number(lastFundingRateTs));
      const pnlBreakdown = this.calculatePnlBreakdown(unrealizedPnl, unsettledFundingPnl, settledPnl, quoteAssetAmount);
      
      positions.push({
        marketIndex,
        baseAssetAmount,
        quoteAssetAmount,
        lastCumulativeFundingRate,
        lastFundingRateTs: Number(lastFundingRateTs),
        openOrders,
        unrealizedPnl,
        realizedPnl: 0,
        settledPnl,
        openBids,
        openAsks,
        remainderBaseAssetAmount,
        lpShares: Number(lpShares),
        perLpBase,
        markPrice,
        entryPrice,
        unsettledFundingPnl,
        side,
        size,
        notionalValue,
        marginRequirement,
        liquidationPrice,
        fundingPayments,
        pnlBreakdown,
      });
    }
    
    return positions.filter(pos => pos.baseAssetAmount !== 0 || pos.quoteAssetAmount !== 0);
  }

  private async getMarket(marketIndex: number): Promise<DriftMarket | null> {
    if (this.markets.has(marketIndex)) {
      return this.markets.get(marketIndex)!;
    }

    try {
      const [marketPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('perp_market'),
          new BN(marketIndex).toArrayLike(Buffer, 'le', 2)
        ],
        DRIFT_PROGRAM_ID
      );

      const accountInfo = await this.connection.getAccountInfo(marketPda);
      if (!accountInfo) return null;

      const market = this.parseMarket(marketIndex, accountInfo.data);
      this.markets.set(marketIndex, market);
      return market;
    } catch (error) {
      console.error(`[DRIFT] Error fetching market ${marketIndex}:`, error);
      return null;
    }
  }

  private parseMarket(marketIndex: number, data: Buffer): DriftMarket {
    let offset = 8;
    
    const symbol = data.slice(offset, offset + 32).toString('utf8').replace(/\0/g, '');
    offset += 32;
    
    const ammOffset = offset;
    const amm = this.parseAmm(data, ammOffset);
    offset += 1000;
    
    const baseAssetReserve = Number(amm.baseAssetReserve);
    const quoteAssetReserve = Number(amm.quoteAssetReserve);
    
    const cumulativeFundingRateLong = amm.cumulativeFundingRateLong;
    const cumulativeFundingRateShort = amm.cumulativeFundingRateShort;
    const lastFundingRateTs = amm.lastFundingRateTs;
    const fundingPeriod = amm.fundingPeriod;
    
    const markPrice = this.calculateMarkPrice(amm);
    const indexPrice = amm.lastOraclePrice;
    
    offset += 100;
    
    const marginRatioInitial = data.readUInt32LE(offset) / 10000;
    offset += 4;
    
    const marginRatioMaintenance = data.readUInt32LE(offset) / 10000;
    offset += 4;
    
    const unrealizedAssetWeight = data.readUInt32LE(offset) / 10000;
    offset += 4;
    
    offset += 20;
    
    const concentrationCoef = data.readBigUInt64LE(offset);
    offset += 8;
    
    offset += 30;
    
    const maxSpread = data.readUInt32LE(offset);
    offset += 4;
    
    const minOrderSize = data.readBigUInt64LE(offset);
    offset += 8;
    
    const oracle = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    
    const fundingVelocity = this.calculateFundingVelocity(amm);
    const nextFundingRateTs = lastFundingRateTs + fundingPeriod;

    return {
      marketIndex,
      symbol,
      baseAssetReserve,
      quoteAssetReserve,
      cumulativeFundingRateLong,
      cumulativeFundingRateShort,
      lastFundingRateTs,
      fundingPeriod,
      markPrice,
      indexPrice,
      marginRatioInitial,
      marginRatioMaintenance,
      unrealizedAssetWeight,
      concentrationCoef: Number(concentrationCoef),
      maxSpread,
      minOrderSize: Number(minOrderSize) / 1e9,
      fundingVelocity,
      oracle,
      amm,
      nextFundingRateTs,
    };
  }

  private parseAmm(data: Buffer, startOffset: number): AmmData {
    let offset = startOffset;
    
    const baseAssetReserve = Number(data.readBigUInt64LE(offset)) / 1e9;
    offset += 8;
    
    const quoteAssetReserve = Number(data.readBigUInt64LE(offset)) / 1e6;
    offset += 8;
    
    const sqrtK = data.readBigUInt64LE(offset);
    offset += 8;
    
    const pegMultiplier = Number(data.readBigUInt64LE(offset)) / 1e6;
    offset += 8;
    
    const totalFeeMinusDistributions = this.readI128(data, offset) / 1e6;
    offset += 16;
    
    offset += 100;
    
    const cumulativeFundingRateLong = this.readI128(data, offset) / 1e18;
    offset += 16;
    
    const cumulativeFundingRateShort = this.readI128(data, offset) / 1e18;
    offset += 16;
    
    const lastFundingRate = this.readI128(data, offset) / 1e18;
    offset += 16;
    
    const lastFundingRateTs = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    const fundingPeriod = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    const lastOraclePrice = Number(data.readBigInt64LE(offset)) / 1e6;
    offset += 8;
    
    const lastOracleConf = Number(data.readBigUInt64LE(offset)) / 1e6;
    offset += 8;
    
    const lastOracleDelay = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    const lastBidPriceTwap = Number(data.readBigUInt64LE(offset)) / 1e6;
    offset += 8;
    
    const lastAskPriceTwap = Number(data.readBigUInt64LE(offset)) / 1e6;
    offset += 8;
    
    const lastMarkPriceTwap = Number(data.readBigUInt64LE(offset)) / 1e6;
    offset += 8;
    
    const lastMarkPriceTwap5Min = Number(data.readBigUInt64LE(offset)) / 1e6;

    return {
      baseAssetReserve,
      quoteAssetReserve,
      sqrtK: Number(sqrtK),
      pegMultiplier,
      totalFeeMinusDistributions,
      cumulativeFundingRateLong,
      cumulativeFundingRateShort,
      lastFundingRate,
      lastFundingRateTs,
      fundingPeriod,
      lastOraclePrice,
      lastOracleConf,
      lastOracleDelay,
      lastBidPriceTwap,
      lastAskPriceTwap,
      lastMarkPriceTwap,
      lastMarkPriceTwap5Min,
    };
  }

  private calculateMarkPrice(amm: AmmData): number {
    if (amm.baseAssetReserve === 0) return amm.lastOraclePrice;
    
    const invariant = amm.sqrtK * amm.sqrtK;
    const newQuoteAssetReserve = Math.sqrt(invariant * amm.pegMultiplier);
    const newBaseAssetReserve = invariant / newQuoteAssetReserve;
    
    return (newQuoteAssetReserve / newBaseAssetReserve) * amm.pegMultiplier;
  }

  private calculateFundingVelocity(amm: AmmData): number {
    const markPremium = amm.lastMarkPriceTwap - amm.lastOraclePrice;
    const premiumRatio = markPremium / amm.lastOraclePrice;
    
    return premiumRatio * 24 * 365;
  }

  private calculateUnrealizedPnl(baseAssetAmount: number, entryPrice: number, markPrice: number): number {
    if (baseAssetAmount === 0) return 0;
    return baseAssetAmount * (markPrice - entryPrice);
  }

  private async calculateUnsettledFundingPnl(
    marketIndex: number,
    baseAssetAmount: number,
    lastCumulativeFundingRate: number
  ): Promise<number> {
    if (baseAssetAmount === 0) return 0;
    
    const market = await this.getMarket(marketIndex);
    if (!market) return 0;
    
    const currentCumulativeFundingRate = baseAssetAmount > 0 
      ? market.cumulativeFundingRateLong 
      : market.cumulativeFundingRateShort;
    
    const fundingRateDelta = currentCumulativeFundingRate - lastCumulativeFundingRate;
    return -baseAssetAmount * fundingRateDelta;
  }

  private async calculateLiquidationPrice(
    baseAssetAmount: number,
    quoteAssetAmount: number,
    market: DriftMarket | null
  ): Promise<number> {
    if (!market || baseAssetAmount === 0) return 0;
    
    const entryPrice = Math.abs(quoteAssetAmount / baseAssetAmount);
    const maintenanceMargin = market.marginRatioMaintenance;
    
    if (baseAssetAmount > 0) {
      return entryPrice * (1 - maintenanceMargin);
    } else {
      return entryPrice * (1 + maintenanceMargin);
    }
  }

  private async getFundingPayments(
    marketIndex: number,
    baseAssetAmount: number,
    lastCumulativeFundingRate: number,
    lastFundingRateTs: number
  ): Promise<FundingPayment[]> {
    const payments: FundingPayment[] = [];
    
    const market = await this.getMarket(marketIndex);
    if (!market || baseAssetAmount === 0) return payments;
    
    const currentCumulativeFundingRate = baseAssetAmount > 0 
      ? market.cumulativeFundingRateLong 
      : market.cumulativeFundingRateShort;
    
    const fundingRateDelta = currentCumulativeFundingRate - lastCumulativeFundingRate;
    const fundingAmount = -baseAssetAmount * fundingRateDelta;
    
    if (Math.abs(fundingAmount) > 0.01) {
      payments.push({
        timestamp: market.lastFundingRateTs,
        amount: fundingAmount,
        fundingRate: fundingRateDelta,
        position: baseAssetAmount,
      });
    }
    
    return payments;
  }

  private calculatePnlBreakdown(
    unrealizedPnl: number,
    fundingPnl: number,
    realizedPnl: number,
    initialQuote: number
  ): PnlBreakdown {
    const totalPnl = unrealizedPnl + fundingPnl + realizedPnl;
    const initialValue = Math.abs(initialQuote);
    const pnlPercentage = initialValue > 0 ? (totalPnl / initialValue) * 100 : 0;
    const roi = pnlPercentage;
    
    return {
      unrealizedPnl,
      fundingPnl,
      realizedPnl,
      totalPnl,
      pnlPercentage,
      roi,
    };
  }

  private async calculateMarginHealth(
    totalCollateral: number,
    positions: DriftPosition[],
    marginRatio: number
  ): Promise<MarginHealth> {
    let totalMarginUsed = 0;
    let totalMaintenanceMargin = 0;
    
    for (const position of positions) {
      totalMarginUsed += position.marginRequirement;
      const market = await this.getMarket(position.marketIndex);
      if (market) {
        totalMaintenanceMargin += position.notionalValue * market.marginRatioMaintenance;
      }
    }
    
    const healthRatio = totalMaintenanceMargin > 0 ? totalCollateral / totalMaintenanceMargin : Infinity;
    const liquidationBuffer = Math.max(0, (healthRatio - 1.0) * 100);
    const marginUtilization = totalCollateral > 0 ? (totalMarginUsed / totalCollateral) * 100 : 0;
    const maintenanceMarginExcess = totalCollateral - totalMaintenanceMargin;
    
    let riskLevel: 'safe' | 'moderate' | 'high' | 'critical' = 'safe';
    if (healthRatio < 1.05) riskLevel = 'critical';
    else if (healthRatio < 1.25) riskLevel = 'high';
    else if (healthRatio < 2.0) riskLevel = 'moderate';
    
    const timeToLiquidation = this.estimateTimeToLiquidation(positions, maintenanceMarginExcess);
    
    return {
      healthRatio,
      liquidationBuffer,
      marginUtilization,
      riskLevel,
      timeToLiquidation,
      maintenanceMarginExcess,
    };
  }

  private estimateTimeToLiquidation(positions: DriftPosition[], marginExcess: number): number {
    let totalFundingRate = 0;
    let totalNotional = 0;
    
    for (const position of positions) {
      if (position.baseAssetAmount !== 0) {
        totalFundingRate += Math.abs(position.baseAssetAmount) * 0.0001;
        totalNotional += position.notionalValue;
      }
    }
    
    if (totalFundingRate === 0 || marginExcess <= 0) return Infinity;
    
    const dailyFundingCost = totalFundingRate * 24;
    return marginExcess / dailyFundingCost;
  }

  private async calculatePortfolioMetrics(
    positions: DriftPosition[],
    totalCollateral: number
  ): Promise<PortfolioMetrics> {
    let totalNotionalValue = 0;
    let totalMarginUsed = 0;
    let dailyFundingRate = 0;
    let largestPosition = 0;
    let openPositionsCount = 0;
    
    for (const position of positions) {
      if (position.baseAssetAmount !== 0) {
        totalNotionalValue += position.notionalValue;
        totalMarginUsed += position.marginRequirement;
        openPositionsCount++;
        
        if (position.notionalValue > largestPosition) {
          largestPosition = position.notionalValue;
        }
        
        const market = await this.getMarket(position.marketIndex);
        if (market) {
          const positionFunding = Math.abs(position.baseAssetAmount) * market.fundingVelocity / 365;
          dailyFundingRate += positionFunding;
        }
      }
    }
    
    const leverage = totalCollateral > 0 ? totalNotionalValue / totalCollateral : 0;
    const projectedFundingDaily = dailyFundingRate;
    const concentrationRisk = totalNotionalValue > 0 ? (largestPosition / totalNotionalValue) * 100 : 0;
    
    return {
      totalNotionalValue,
      totalMarginUsed,
      leverage,
      dailyFundingRate,
      projectedFundingDaily,
      openPositionsCount,
      largestPosition,
      concentrationRisk,
    };
  }

  private async calculateMarginRatio(totalCollateral: number, positions: DriftPosition[]): Promise<number> {
    let totalMarginRequirement = 0;
    
    for (const position of positions) {
      const market = await this.getMarket(position.marketIndex);
      if (!market) continue;
      
      const notionalValue = Math.abs(position.baseAssetAmount) * market.markPrice;
      totalMarginRequirement += notionalValue * market.marginRatioMaintenance;
    }
    
    if (totalMarginRequirement === 0) return Infinity;
    return totalCollateral / totalMarginRequirement;
  }

  private async calculateFreeCollateral(totalCollateral: number, positions: DriftPosition[]): Promise<number> {
    let totalMarginRequirement = 0;
    let totalUnrealizedPnl = 0;
    
    for (const position of positions) {
      const market = await this.getMarket(position.marketIndex);
      if (!market) continue;
      
      const notionalValue = Math.abs(position.baseAssetAmount) * market.markPrice;
      totalMarginRequirement += notionalValue * market.marginRatioInitial;
      totalUnrealizedPnl += position.unrealizedPnl + position.unsettledFundingPnl;
    }
    
    return totalCollateral + totalUnrealizedPnl - totalMarginRequirement;
  }

  async getMarginRatio(user: DriftUser): Promise<number> {
    return user.marginRatio;
  }

  async getLiquidationBuffer(user: DriftUser): Promise<number> {
    return user.marginHealth.liquidationBuffer;
  }

  async getFundingRates(marketIndex: number): Promise<FundingRateSnapshot | null> {
    const market = await this.getMarket(marketIndex);
    if (!market) return null;
    
    const hourlyFundingRate = Number(market.cumulativeFundingRateLong - market.cumulativeFundingRateShort) / (2 * market.fundingPeriod / 3600);
    const annualizedFundingRate = hourlyFundingRate * 24 * 365;
    const twapSpread = market.amm.lastMarkPriceTwap - market.amm.lastOraclePrice;
    
    return {
      marketIndex,
      fundingRate: (market.cumulativeFundingRateLong + market.cumulativeFundingRateShort) / 2,
      fundingRateHourly: hourlyFundingRate,
      fundingRateAnnualized: annualizedF
}}}
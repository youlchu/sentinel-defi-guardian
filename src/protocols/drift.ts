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
}

export interface FundingRateSnapshot {
  marketIndex: number;
  fundingRate: number;
  fundingRateHourly: number;
  cumulativeFundingRateLong: number;
  cumulativeFundingRateShort: number;
  timestamp: number;
}

export class DriftMonitor {
  private connection: Connection;
  private markets: Map<number, DriftMarket> = new Map();
  private fundingHistory: Map<number, FundingRateSnapshot[]> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
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
    
    const baseAssetReserve = data.readBigUInt64LE(offset);
    offset += 8;
    
    const quoteAssetReserve = data.readBigUInt64LE(offset);
    offset += 8;
    
    offset += 200;
    
    const cumulativeFundingRateLong = this.readI128(data, offset) / 1e18;
    offset += 16;
    
    const cumulativeFundingRateShort = this.readI128(data, offset) / 1e18;
    offset += 16;
    
    const lastFundingRateTs = data.readBigInt64LE(offset);
    offset += 8;
    
    const fundingPeriod = data.readBigInt64LE(offset);
    offset += 8;
    
    offset += 100;
    
    const markPrice = data.readBigUInt64LE(offset);
    offset += 8;
    
    const indexPrice = data.readBigUInt64LE(offset);
    offset += 8;
    
    offset += 50;
    
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

    return {
      marketIndex,
      symbol,
      baseAssetReserve: Number(baseAssetReserve) / 1e9,
      quoteAssetReserve: Number(quoteAssetReserve) / 1e6,
      cumulativeFundingRateLong,
      cumulativeFundingRateShort,
      lastFundingRateTs: Number(lastFundingRateTs),
      fundingPeriod: Number(fundingPeriod),
      markPrice: Number(markPrice) / 1e6,
      indexPrice: Number(indexPrice) / 1e6,
      marginRatioInitial,
      marginRatioMaintenance,
      unrealizedAssetWeight,
      concentrationCoef: Number(concentrationCoef),
      maxSpread,
      minOrderSize: Number(minOrderSize) / 1e9,
    };
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
    const marginRatio = user.marginRatio;
    const maintenanceMarginRatio = 1.0;
    
    if (marginRatio === Infinity) return Infinity;
    return Math.max(0, (marginRatio - maintenanceMarginRatio) / marginRatio * 100);
  }

  async getFundingRates(marketIndex: number): Promise<FundingRateSnapshot | null> {
    const market = await this.getMarket(marketIndex);
    if (!market) return null;
    
    const hourlyFundingRate = this.calculateHourlyFundingRate(
      market.cumulativeFundingRateLong,
      market.cumulativeFundingRateShort,
      market.fundingPeriod
    );
    
    return {
      marketIndex,
      fundingRate: (market.cumulativeFundingRateLong + market.cumulativeFundingRateShort) / 2,
      fundingRateHourly: hourlyFundingRate,
      cumulativeFundingRateLong: market.cumulativeFundingRateLong,
      cumulativeFundingRateShort: market.cumulativeFundingRateShort,
      timestamp: market.lastFundingRateTs,
    };
  }

  private calculateHourlyFundingRate(
    cumulativeLong: number,
    cumulativeShort: number,
    fundingPeriod: number
  ): number {
    const avgCumulative = (cumulativeLong + cumulativeShort) / 2;
    const periodsPerHour = 3600 / fundingPeriod;
    return avgCumulative * periodsPerHour;
  }

  async trackFundingHistory(marketIndex: number): Promise<void> {
    const currentSnapshot = await this.getFundingRates(marketIndex);
    if (!currentSnapshot) return;
    
    if (!this.fundingHistory.has(marketIndex)) {
      this.fundingHistory.set(marketIndex, []);
    }
    
    const history = this.fundingHistory.get(marketIndex)!;
    history.push(currentSnapshot);
    
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }
  }

  getFundingHistory(marketIndex: number): FundingRateSnapshot[] {
    return this.fundingHistory.get(marketIndex) || [];
  }

  private readI128(buffer: Buffer, offset: number): number {
    const low = buffer.readBigUInt64LE(offset);
    const high = buffer.readBigUInt64LE(offset + 8);
    const value = high << 64n | low;
    
    if (high >> 63n) {
      return Number(value - (1n << 128n));
    }
    return Number(value);
  }

  async getAllMarkets(): Promise<DriftMarket[]> {
    const markets: DriftMarket[] = [];
    
    for (let i = 0; i < 50; i++) {
      const market = await this.getMarket(i);
      if (market) {
        markets.push(market);
      }
    }
    
    return markets;
  }

  async getPositionValue(position: DriftPosition): Promise<number> {
    const market = await this.getMarket(position.marketIndex);
    if (!market) return 0;
    
    return Math.abs(position.baseAssetAmount) * market.markPrice;
  }

  async getTotalPortfolioValue(user: DriftUser): Promise<number> {
    let totalValue = user.totalCollateral;
    
    for (const position of user.positions) {
      totalValue += position.unrealizedPnl + position.unsettledFundingPnl;
    }
    
    return totalValue;
  }
}
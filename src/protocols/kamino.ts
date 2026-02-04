import { Connection, PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder, BN } from '@coral-xyz/anchor';

export const KAMINO_PROGRAM_ID = new PublicKey('KLend2g3cP87ber41aPn9Q5kkdCZNxMWTKZLGvBKgvV');
export const KAMINO_LENDING_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');

const WAD = new BN('1000000000000000000'); // 18 decimals
const PERCENT_SCALE = 10000;
const PRECISION_FACTOR = new BN('1000000000000000000'); // 18 decimals for precise calculations

export interface KaminoReserve {
  address: PublicKey;
  mintAddress: PublicKey;
  liquiditySupply: BN;
  borrowedLiquidity: BN;
  liquidityFeeReceiver: PublicKey;
  config: {
    loanToValueRatio: number;
    liquidationThreshold: number;
    liquidationBonus: number;
    borrowFeeWad: BN;
    flashLoanFeeWad: BN;
    hostFeePercentage: number;
    depositLimit: BN;
    borrowLimit: BN;
  };
  liquidity: {
    mintPubkey: PublicKey;
    mintDecimals: number;
    supplyPubkey: PublicKey;
    pythOracle: PublicKey;
    switchboardOracle: PublicKey;
    availableAmount: BN;
    borrowedAmountWads: BN;
    cumulativeBorrowRateWads: BN;
    marketPrice: BN;
  };
  lastUpdatedSlot: BN;
  isActive: boolean;
}

export interface KaminoObligation {
  address: PublicKey;
  owner: PublicKey;
  lendingMarket: PublicKey;
  deposits: KaminoDeposit[];
  borrows: KaminoBorrow[];
  depositedValue: BN;
  borrowedValue: BN;
  allowedBorrowValue: BN;
  unhealthyBorrowValue: BN;
  depositsLen: number;
  borrowsLen: number;
  lastUpdate: {
    slot: BN;
    stale: boolean;
  };
  calculatedLtv: number;
  calculatedHealthFactor: number;
  liquidationRisk: 'safe' | 'warning' | 'danger' | 'liquidatable';
  preciseLtv: BN;
  preciseHealthFactor: BN;
  liquidationThreshold: number;
  effectiveLiquidationThreshold: BN;
  borrowUtilization: number;
}

export interface KaminoDeposit {
  depositReserve: PublicKey;
  depositedAmount: BN;
  marketValue: BN;
  attributedBorrowValue: BN;
  cumulativeDepositRateWads: BN;
  actualDepositAmount: BN;
  reserveLtv: number;
  reserveLiquidationThreshold: number;
}

export interface KaminoBorrow {
  borrowReserve: PublicKey;
  borrowedAmountWads: BN;
  cumulativeBorrowRateWads: BN;
  marketValue: BN;
  borrowedAmount: BN;
  interestAccrued: BN;
  borrowWeight: number;
}

export interface ObligationCalculations {
  totalDepositedValue: BN;
  totalBorrowedValue: BN;
  weightedLtv: number;
  healthFactor: number;
  liquidationThreshold: number;
  maxBorrowValue: BN;
  liquidationPrice: number;
  isLiquidatable: boolean;
  utilizationRatio: number;
  preciseLtv: BN;
  preciseHealthFactor: BN;
  effectiveLiquidationThreshold: BN;
  borrowCapacityRemaining: BN;
  liquidationBuffer: BN;
  riskWeightedValue: BN;
}

export interface LiquidationThresholdBreakdown {
  perAsset: Array<{
    mint: PublicKey;
    depositValue: BN;
    liquidationThreshold: number;
    contribution: number;
  }>;
  weighted: number;
  effective: BN;
  buffer: BN;
}

export class KaminoMonitor {
  private connection: Connection;
  private reserves: Map<string, KaminoReserve> = new Map();
  private priceCache: Map<string, { price: BN; timestamp: number }> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async loadReserves(): Promise<void> {
    try {
      const accounts = await this.connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        filters: [
          { dataSize: 1304 },
          { memcmp: { offset: 8, bytes: KAMINO_LENDING_MARKET.toBase58() } }
        ]
      });

      for (const account of accounts) {
        try {
          const reserve = this.parseReserve(account.pubkey, account.account.data);
          this.reserves.set(account.pubkey.toBase58(), reserve);
        } catch (error) {
          console.warn(`[KAMINO] Failed to parse reserve ${account.pubkey.toBase58()}:`, error);
        }
      }

      console.log(`[KAMINO] Loaded ${this.reserves.size} reserves`);
    } catch (error) {
      console.error('[KAMINO] Error loading reserves:', error);
    }
  }

  private parseReserve(address: PublicKey, data: Buffer): KaminoReserve {
    try {
      const lendingMarket = new PublicKey(data.subarray(8, 40));
      const mintAddress = new PublicKey(data.subarray(40, 72));
      
      const liquiditySupply = new BN(data.subarray(72, 80), 'le');
      const borrowedLiquidity = new BN(data.subarray(80, 88), 'le');
      const liquidityFeeReceiver = new PublicKey(data.subarray(88, 120));
      
      const borrowFeeWad = new BN(data.subarray(120, 136), 'le');
      const flashLoanFeeWad = new BN(data.subarray(136, 152), 'le');
      const hostFeePercentage = data.readUInt8(152);
      const depositLimit = new BN(data.subarray(153, 161), 'le');
      const borrowLimit = new BN(data.subarray(161, 169), 'le');
      
      const loanToValueRatio = data.readUInt16LE(264) / PERCENT_SCALE;
      const liquidationThreshold = data.readUInt16LE(266) / PERCENT_SCALE;
      const liquidationBonus = data.readUInt16LE(268) / PERCENT_SCALE;
      
      const liquidityMintPubkey = new PublicKey(data.subarray(296, 328));
      const liquidityMintDecimals = data.readUInt8(328);
      const liquiditySupplyPubkey = new PublicKey(data.subarray(329, 361));
      const pythOracle = new PublicKey(data.subarray(361, 393));
      const switchboardOracle = new PublicKey(data.subarray(393, 425));
      
      const availableAmount = new BN(data.subarray(425, 433), 'le');
      const borrowedAmountWads = new BN(data.subarray(433, 449), 'le');
      const cumulativeBorrowRateWads = new BN(data.subarray(449, 465), 'le');
      const marketPrice = new BN(data.subarray(465, 481), 'le');
      
      const lastUpdatedSlot = new BN(data.subarray(481, 489), 'le');
      const isActive = data.readUInt8(489) === 1;

      return {
        address,
        mintAddress,
        liquiditySupply,
        borrowedLiquidity,
        liquidityFeeReceiver,
        config: {
          loanToValueRatio,
          liquidationThreshold,
          liquidationBonus,
          borrowFeeWad,
          flashLoanFeeWad,
          hostFeePercentage,
          depositLimit,
          borrowLimit,
        },
        liquidity: {
          mintPubkey: liquidityMintPubkey,
          mintDecimals: liquidityMintDecimals,
          supplyPubkey: liquiditySupplyPubkey,
          pythOracle,
          switchboardOracle,
          availableAmount,
          borrowedAmountWads,
          cumulativeBorrowRateWads,
          marketPrice,
        },
        lastUpdatedSlot,
        isActive
      };
    } catch (error) {
      throw new Error(`Failed to parse reserve data: ${error}`);
    }
  }

  async getObligationsByOwner(owner: PublicKey): Promise<KaminoObligation[]> {
    console.log(`[KAMINO] Fetching obligations for ${owner.toBase58()}`);

    try {
      const accounts = await this.connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        filters: [
          { dataSize: 1300 },
          { memcmp: { offset: 40, bytes: owner.toBase58() } }
        ]
      });

      const obligations: KaminoObligation[] = [];
      for (const acc of accounts) {
        try {
          const obligation = await this.parseObligation(acc.pubkey, acc.account.data);
          if (obligation.depositsLen > 0 || obligation.borrowsLen > 0) {
            obligations.push(obligation);
          }
        } catch (error) {
          console.warn(`[KAMINO] Failed to parse obligation ${acc.pubkey.toBase58()}:`, error);
        }
      }

      return obligations;
    } catch (error) {
      console.error('[KAMINO] Error fetching obligations:', error);
      return [];
    }
  }

  private async parseObligation(address: PublicKey, data: Buffer): Promise<KaminoObligation> {
    try {
      const lendingMarket = new PublicKey(data.subarray(8, 40));
      const owner = new PublicKey(data.subarray(40, 72));
      
      const depositedValue = new BN(data.subarray(72, 88), 'le');
      const borrowedValue = new BN(data.subarray(88, 104), 'le');
      const allowedBorrowValue = new BN(data.subarray(104, 120), 'le');
      const unhealthyBorrowValue = new BN(data.subarray(120, 136), 'le');
      
      const depositsLen = data.readUInt8(136);
      const borrowsLen = data.readUInt8(137);
      
      const lastUpdateSlot = new BN(data.subarray(138, 146), 'le');
      const lastUpdateStale = data.readUInt8(146) === 1;

      const deposits: KaminoDeposit[] = [];
      for (let i = 0; i < Math.min(depositsLen, 8); i++) {
        const offset = 200 + i * 72;
        const depositReserve = new PublicKey(data.subarray(offset, offset + 32));
        const depositedAmount = new BN(data.subarray(offset + 32, offset + 40), 'le');
        const marketValue = new BN(data.subarray(offset + 40, offset + 48), 'le');
        const attributedBorrowValue = new BN(data.subarray(offset + 48, offset + 56), 'le');
        const cumulativeDepositRateWads = new BN(data.subarray(offset + 56, offset + 72), 'le');
        
        const reserve = this.reserves.get(depositReserve.toBase58());
        const actualDepositAmount = reserve && !cumulativeDepositRateWads.isZero() ? 
          depositedAmount.mul(cumulativeDepositRateWads).div(PRECISION_FACTOR) : 
          depositedAmount;

        deposits.push({
          depositReserve,
          depositedAmount,
          marketValue,
          attributedBorrowValue,
          cumulativeDepositRateWads,
          actualDepositAmount,
          reserveLtv: reserve?.config.loanToValueRatio || 0,
          reserveLiquidationThreshold: reserve?.config.liquidationThreshold || 0,
        });
      }

      const borrows: KaminoBorrow[] = [];
      for (let i = 0; i < Math.min(borrowsLen, 8); i++) {
        const offset = 776 + i * 88;
        const borrowReserve = new PublicKey(data.subarray(offset, offset + 32));
        const borrowedAmountWads = new BN(data.subarray(offset + 32, offset + 48), 'le');
        const cumulativeBorrowRateWads = new BN(data.subarray(offset + 48, offset + 64), 'le');
        const marketValue = new BN(data.subarray(offset + 64, offset + 72), 'le');
        
        const reserve = this.reserves.get(borrowReserve.toBase58());
        const borrowedAmount = reserve && !reserve.liquidity.cumulativeBorrowRateWads.isZero() ? 
          borrowedAmountWads.div(reserve.liquidity.cumulativeBorrowRateWads) : 
          new BN(0);

        const interestAccrued = borrowedAmountWads.sub(borrowedAmount);

        borrows.push({
          borrowReserve,
          borrowedAmountWads,
          cumulativeBorrowRateWads,
          marketValue,
          borrowedAmount,
          interestAccrued,
          borrowWeight: 1.0,
        });
      }

      const calculations = await this.calculatePreciseObligationMetrics(deposits, borrows);

      return {
        address,
        owner,
        lendingMarket,
        deposits,
        borrows,
        depositedValue,
        borrowedValue,
        allowedBorrowValue,
        unhealthyBorrowValue,
        depositsLen,
        borrowsLen,
        lastUpdate: {
          slot: lastUpdateSlot,
          stale: lastUpdateStale,
        },
        calculatedLtv: calculations.weightedLtv,
        calculatedHealthFactor: calculations.healthFactor,
        liquidationRisk: this.assessLiquidationRisk(calculations.healthFactor),
        preciseLtv: calculations.preciseLtv,
        preciseHealthFactor: calculations.preciseHealthFactor,
        liquidationThreshold: calculations.liquidationThreshold,
        effectiveLiquidationThreshold: calculations.effectiveLiquidationThreshold,
        borrowUtilization: calculations.utilizationRatio,
      };
    } catch (error) {
      throw new Error(`Failed to parse obligation data: ${error}`);
    }
  }

  private async calculatePreciseObligationMetrics(
    deposits: KaminoDeposit[],
    borrows: KaminoBorrow[]
  ): Promise<ObligationCalculations> {
    let totalDepositedValue = new BN(0);
    let totalBorrowedValue = new BN(0);
    let weightedLtvNumerator = new BN(0);
    let maxBorrowValue = new BN(0);
    let liquidationThresholdNumerator = new BN(0);
    let riskWeightedValue = new BN(0);

    for (const deposit of deposits) {
      const reserve = this.reserves.get(deposit.depositReserve.toBase58());
      if (!reserve) continue;

      const depositValue = deposit.marketValue;
      totalDepositedValue = totalDepositedValue.add(depositValue);

      const ltvBN = new BN(Math.floor(reserve.config.loanToValueRatio * PERCENT_SCALE));
      const liquidationThresholdBN = new BN(Math.floor(reserve.config.liquidationThreshold * PERCENT_SCALE));
      
      const ltvContribution = depositValue.mul(ltvBN);
      const liquidationContribution = depositValue.mul(liquidationThresholdBN);
      
      weightedLtvNumerator = weightedLtvNumerator.add(ltvContribution);
      liquidationThresholdNumerator = liquidationThresholdNumerator.add(liquidationContribution);
      
      const borrowPower = depositValue.mul(ltvBN).div(new BN(PERCENT_SCALE));
      maxBorrowValue = maxBorrowValue.add(borrowPower);

      const riskWeight = Math.max(0.5, reserve.config.liquidationThreshold - 0.1);
      const riskWeightedContribution = depositValue.muln(Math.floor(riskWeight * PERCENT_SCALE)).divn(PERCENT_SCALE);
      riskWeightedValue = riskWeightedValue.add(riskWeightedContribution);
    }

    for (const borrow of borrows) {
      const reserve = this.reserves.get(borrow.borrowReserve.toBase58());
      const borrowValue = borrow.marketValue;
      
      let adjustedBorrowValue = borrowValue;
      if (reserve) {
        const borrowWeight = 1.0 + (reserve.liquidity.borrowedAmountWads.toNumber() / Math.pow(10, 18)) * 0.05;
        adjustedBorrowValue = borrowValue.muln(Math.floor(borrowWeight * 100)).divn(100);
      }
      
      totalBorrowedValue = totalBorrowedValue.add(adjustedBorrowValue);
    }

    const preciseLtv = totalDepositedValue.isZero() ? 
      new BN(0) : 
      weightedLtvNumerator.div(totalDepositedValue);

    const effectiveLiquidationThreshold = totalDepositedValue.isZero() ? 
      new BN(0) : 
      liquidationThresholdNumerator.div(totalDepositedValue);

    const preciseHealthFactor = totalBorrowedValue.isZero() ? 
      PRECISION_FACTOR.muln(1000) : 
      effectiveLiquidationThreshold.mul(totalDepositedValue).div(totalBorrowedValue).div(new BN(PERCENT_SCALE));

    const weightedLtv = totalDepositedValue.isZero() ? 
      0 : 
      preciseLtv.toNumber() / PERCENT_SCALE;

    const liquidationThreshold = totalDepositedValue.isZero() ? 
      0 : 
      effectiveLiquidationThreshold.toNumber() / PERCENT_SCALE;

    const healthFactor = totalBorrowedValue.isZero() ? 
      Infinity : 
      (liquidationThreshold * totalDepositedValue.toNumber()) / totalBorrowedValue.toNumber();

    const utilizationRatio = totalDepositedValue.isZero() ? 
      0 : 
      totalBorrowedValue.toNumber() / totalDepositedValue.toNumber();

    const borrowCapacityRemaining = maxBorrowValue.sub(totalBorrowedValue);
    const liquidationBuffer = effectiveLiquidationThreshold.mul(totalDepositedValue)
      .div(new BN(PERCENT_SCALE))
      .sub(totalBorrowedValue);

    return {
      totalDepositedValue,
      totalBorrowedValue,
      weightedLtv,
      healthFactor,
      liquidationThreshold,
      maxBorrowValue,
      liquidationPrice: this.calculatePreciseLiquidationPrice(deposits, borrows),
      isLiquidatable: preciseHealthFactor.lt(PRECISION_FACTOR),
      utilizationRatio,
      preciseLtv,
      preciseHealthFactor,
      effectiveLiquidationThreshold,
      borrowCapacityRemaining,
      liquidationBuffer,
      riskWeightedValue,
    };
  }

  private calculatePreciseLiquidationPrice(deposits: KaminoDeposit[], borrows: KaminoBorrow[]): number {
    if (deposits.length === 0 || borrows.length === 0) return 0;

    const largestDeposit = deposits.reduce((max, deposit) => 
      deposit.marketValue.gt(max.marketValue) ? deposit : max
    );

    const reserve = this.reserves.get(largestDeposit.depositReserve.toBase58());
    if (!reserve) return 0;

    const totalBorrowValue = borrows.reduce((sum, borrow) => 
      sum.add(borrow.marketValue), new BN(0)
    );

    const liquidationThreshold = reserve.config.liquidationThreshold;
    const collateralAmount = largestDeposit.actualDepositAmount.toNumber() / 
      Math.pow(10, reserve.liquidity.mintDecimals);

    if (collateralAmount === 0) return 0;

    const liquidationBonus = reserve.config.liquidationBonus;
    const effectiveThreshold = liquidationThreshold * (1 - liquidationBonus);

    return totalBorrowValue.toNumber() / (collateralAmount * effectiveThreshold * Math.pow(10, 8));
  }

  private assessLiquidationRisk(healthFactor: number): 'safe' | 'warning' | 'danger' | 'liquidatable' {
    if (healthFactor < 1.0) return 'liquidatable';
    if (healthFactor < 1.05) return 'danger';
    if (healthFactor < 1.15) return 'warning';
    return 'safe';
  }

  async getLiquidationThresholdBreakdown(obligation: KaminoObligation): Promise<LiquidationThresholdBreakdown> {
    const perAsset: Array<{
      mint: PublicKey;
      depositValue: BN;
      liquidationThreshold: number;
      contribution: number;
    }> = [];

    let totalValue = new BN(0);
    let weightedThreshold = 0;

    for (const deposit of obligation.deposits) {
      const reserve = this.reserves.get(deposit.depositReserve.toBase58());
      if (!reserve) continue;

      const value = deposit.marketValue;
      totalValue = totalValue.add(value);

      const threshold = reserve.config.liquidationThreshold;
      const contribution = value.toNumber() / obligation.depositedValue.toNumber();

      perAsset.push({
        mint: reserve.mintAddress,
        depositValue: value,
        liquidationThreshold: threshold,
        contribution,
      });

      weightedThreshold += threshold * contribution;
    }

    const effective = obligation.effectiveLiquidationThreshold;
    const buffer = effective.mul(obligation.depositedValue).div(new BN(PERCENT_SCALE)).sub(obligation.borrowedValue);

    return {
      perAsset,
      weighted: weightedThreshold,
      effective,
      buffer,
    };
  }

  async getHealthFactor(obligation: KaminoObligation): Promise<number> {
    return obligation.calculatedHealthFactor;
  }

  async getLTV(obligation: KaminoObligation): Promise<number> {
    return obligation.calculatedLtv;
  }

  async getPreciseLTV(obligation: KaminoObligation): Promise<BN> {
    return obligation.preciseLtv;
  }

  async getPreciseHealthFactor(obligation: KaminoObligation): Promise<BN> {
    return obligation.preciseHealthFactor;
  }

  async getLiquidationPrice(obligation: KaminoObligation, collateralMint: PublicKey): Promise<number> {
    const collateralDeposit = obligation.deposits.find(d => {
      const reserve = this.reserves.get(d.depositReserve.toBase58());
      return reserve?.mintAddress.equals(collateralMint);
    });

    if (!collateralDeposit || obligation.borrows.length === 0) return 0;

    const reserve = this.reserves.get(collateralDeposit.depositReserve.toBase58());
    if (!reserve) return 0;

    const totalBorrowValue = obligation.borrows.reduce((sum, borrow) => 
      sum.add(borrow.marketValue), new BN(0)
    );

    const liquidationThreshold = reserve.config.liquidationThreshold;
    const liquidationBonus = reserve.config.liquidationBonus;
    const collateralAmount = collateralDeposit.actualDepositAmount.toNumber() / 
      Math.pow(10, reserve.liquidity.mintDecimals);

    if (collateralAmount === 0) return 0;

    const effectiveThreshold = liquidationThreshold * (1 - liquidationBonus);
    return totalBorrowValue.toNumber() / (collateralAmount * effectiveThreshold * Math.pow(10, 8));
  }

  async isObligationLiquidatable(obligation: KaminoObligation): Promise<boolean> {
    return obligation.preciseHealthFactor.lt(PRECISION_FACTOR);
  }

  async calculateMaxBorrowAmount(obligation: KaminoObligation): Promise<BN> {
    let maxBorrowValue = new BN(0);

    for (const deposit of obligation.deposits) {
      const reserve = this.reserves.get(deposit.depositReserve.toBase58());
      if (!reserve) continue;

      const ltv = reserve.config.loanToValueRatio;
      const borrowPower = deposit.marketValue.muln(Math.floor(ltv * PERCENT_SCALE)).divn(PERCENT_SCALE);
      maxBorrowValue = maxBorrowValue.add(borrowPower);
    }

    const remaining = maxBorrowValue.sub(obligation.borrowedValue);
    return remaining.isNeg() ? new BN(0) : remaining;
  }

  async getUtilizationRatio(obligation: KaminoObligation): Promise<number> {
    return obligation.borrowUtilization;
  }

  async getBorrowCapacityRemaining(obligation: KaminoObligation): Promise<BN> {
    return await this.calculateMaxBorrowAmount(obligation);
  }

  async getLiquidationBuffer(obligation: KaminoObligation): Promise<BN> {
    const liquidationValue = obligation.effectiveLiquidationThreshold
      .mul(obligation.depositedValue)
      .div(new BN(PERCENT_SCALE));
    
    const buffer = liquidationValue.sub(obligation.borrowedValue);
    return buffer.isNeg() ? new BN(0) : buffer;
  }

  async calculateLiquidationImpact(obligation: KaminoObligation, assetMint: PublicKey): Promise<{
    liquidationValue: BN;
    bonusReceived: BN;
    collateralSeized: BN;
    remainingCollateral: BN;
  }> {
    const deposit = obligation.deposits.find(d => {
      const reserve = this.reserves.get(d.depositReserve.toBase58());
      return reserve?.mintAddress.equals(assetMint);
    });

    if (!deposit) {
      return {
        liquidationValue: new BN(0),
        bonusReceived: new BN(0),
        collateralSeized: new BN(0),
        remainingCollateral: new BN(0),
      };
    }

    const reserve = this.reserves.get(deposit.depositReserve.toBase58());
    if (!reserve) {
      return {
        liquidationValue: new BN(0),
        bonusReceived: new BN(0),
        collateralSeized: new BN(0),
        remainingCollateral: new BN(0),
      };
    }

    const maxLiquidationValue = obligation.borrowedValue.muln(50).divn(100);
    const liquidationValue = BN.min(deposit.marketValue, maxLiquidationValue);
    
    const liquidationBonus = reserve.config.liquidationBonus;
    const bonusReceived = liquidationValue.muln(Math.floor(liquidationBonus * PERCENT_SCALE)).divn(PERCENT_SCALE);
    
    const collateralSeized = liquidationValue.add(bonusReceived);
    const remainingCollateral = deposit.marketValue.sub(collateralSeized);

    return {
      liquidationValue,
      bonusReceived,
      collateralSeized,
      remainingCollateral,
    };
  }

  getReserve(address: PublicKey): KaminoReserve | undefined {
    return this.reserves.get(address.toBase58());
  }

  async refreshObligation(obligation: KaminoObligation): Promise<void> {
    try {
      const accountInfo = await this.connection.getAccountInfo(obligation.address);
      if (!accountInfo?.data) return;

      const updatedObligation = await this.parseObligation(obligation.address, accountInfo.data);
      Object.assign(obligation, updatedObligation);
    } catch (error) {
      console.error(`[KAMINO] Error refreshing obligation ${obligation.address.toBase58()}:`, error);
    }
  }

  async refreshReserve(reserveAddress: PublicKey): Promise<void> {
    try {
      const accountInfo = await this.connection.getAccountInfo(reserveAddress);
      if (!accountInfo?.data) return;

      const updatedReserve = this.parseReserve(reserveAddress, accountInfo.data);
      this.reserves.set(reserveAddress.toBase58(), updatedReserve);
    } catch (error) {
      console.error(`[KAMINO] Error refreshing reserve ${reserveAddress.toBase58()}:`, error);
    }
  }

  getAllReserves(): KaminoReserve[] {
    return Array.from(this.reserves.values());
  }

  getActiveReserves(): KaminoReserve[] {
    return this.getAllReserves().filter(reserve => reserve.isActive);
  }

  async getObligationsAtRisk(healthFactorThreshold: number = 1.2): Promise<KaminoObligation[]> {
    const allObligations: KaminoObligation[] = [];
    
    try {
      const accounts = await this.connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        filters: [{ dataSize: 1300 }]
      });

      for (const acc of accounts) {
        try {
          const obligation = await this.parseObligation(acc.pubkey, acc.account.data);
          if ((obligation.depositsLen > 0 || obligation.borrowsLen > 0) && 
              obligation.calculatedHealthFactor < healthFactorThreshold) {
            allObligations.push(obligation);
          }
        } catch (error) {
          console.warn(`[KAMINO] Failed to parse obligation ${acc.pubkey.toBase58()}:`, error);
        }
      }
    } catch (error) {
      console.error('[KAMINO] Error fetching at-risk obligations:', error);
    }

    return allObligations.sort((a, b) => a.calculatedHealthFactor - b.calculatedHealthFactor);
  }
}
import { Connection, PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder, BN } from '@coral-xyz/anchor';

export const KAMINO_PROGRAM_ID = new PublicKey('KLend2g3cP87ber41aPn9Q5kkdCZNxMWTKZLGvBKgvV');
export const KAMINO_LENDING_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');

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
}

export interface KaminoDeposit {
  depositReserve: PublicKey;
  depositedAmount: BN;
  marketValue: BN;
  attributedBorrowValue: BN;
}

export interface KaminoBorrow {
  borrowReserve: PublicKey;
  borrowedAmountWads: BN;
  cumulativeBorrowRateWads: BN;
  marketValue: BN;
}

export class KaminoMonitor {
  private connection: Connection;
  private reserves: Map<string, KaminoReserve> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async loadReserves(): Promise<void> {
    try {
      const accounts = await this.connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        filters: [
          { dataSize: 619 }, // Reserve account size
          { memcmp: { offset: 8, bytes: KAMINO_LENDING_MARKET.toBase58() } }
        ]
      });

      for (const account of accounts) {
        const reserve = this.parseReserve(account.pubkey, account.account.data);
        this.reserves.set(account.pubkey.toBase58(), reserve);
      }

      console.log(`[KAMINO] Loaded ${this.reserves.size} reserves`);
    } catch (error) {
      console.error('[KAMINO] Error loading reserves:', error);
    }
  }

  private parseReserve(address: PublicKey, data: Buffer): KaminoReserve {
    const lendingMarket = new PublicKey(data.slice(8, 40));
    const mintAddress = new PublicKey(data.slice(40, 72));
    const liquiditySupply = new BN(data.slice(72, 80), 'le');
    const borrowedLiquidity = new BN(data.slice(80, 88), 'le');
    
    const loanToValueRatio = data.readUInt8(264);
    const liquidationThreshold = data.readUInt8(265);
    const liquidationBonus = data.readUInt8(266);
    
    const liquidityMintPubkey = new PublicKey(data.slice(296, 328));
    const liquidityMintDecimals = data.readUInt8(328);
    const liquiditySupplyPubkey = new PublicKey(data.slice(329, 361));
    const pythOracle = new PublicKey(data.slice(361, 393));
    const switchboardOracle = new PublicKey(data.slice(393, 425));
    
    const availableAmount = new BN(data.slice(425, 433), 'le');
    const borrowedAmountWads = new BN(data.slice(433, 449), 'le');
    const cumulativeBorrowRateWads = new BN(data.slice(449, 465), 'le');
    const marketPrice = new BN(data.slice(465, 481), 'le');

    return {
      address,
      mintAddress,
      liquiditySupply,
      borrowedLiquidity,
      liquidityFeeReceiver: new PublicKey(data.slice(88, 120)),
      config: {
        loanToValueRatio: loanToValueRatio / 100,
        liquidationThreshold: liquidationThreshold / 100,
        liquidationBonus: liquidationBonus / 100,
        borrowFeeWad: new BN(data.slice(120, 136), 'le'),
        flashLoanFeeWad: new BN(data.slice(136, 152), 'le'),
        hostFeePercentage: data.readUInt8(152),
        depositLimit: new BN(data.slice(153, 161), 'le'),
        borrowLimit: new BN(data.slice(161, 169), 'le'),
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
      }
    };
  }

  async getObligationsByOwner(owner: PublicKey): Promise<KaminoObligation[]> {
    console.log(`[KAMINO] Fetching obligations for ${owner.toBase58()}`);

    try {
      const accounts = await this.connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        filters: [
          { dataSize: 1300 }, // Obligation account size
          { memcmp: { offset: 40, bytes: owner.toBase58() } }
        ]
      });

      const obligations = accounts.map(acc => this.parseObligation(acc.pubkey, acc.account.data));
      return obligations.filter(o => o.depositsLen > 0 || o.borrowsLen > 0);
    } catch (error) {
      console.error('[KAMINO] Error fetching obligations:', error);
      return [];
    }
  }

  private parseObligation(address: PublicKey, data: Buffer): KaminoObligation {
    const lendingMarket = new PublicKey(data.slice(8, 40));
    const owner = new PublicKey(data.slice(40, 72));
    
    const depositedValue = new BN(data.slice(72, 88), 'le');
    const borrowedValue = new BN(data.slice(88, 104), 'le');
    const allowedBorrowValue = new BN(data.slice(104, 120), 'le');
    const unhealthyBorrowValue = new BN(data.slice(120, 136), 'le');
    
    const depositsLen = data.readUInt8(136);
    const borrowsLen = data.readUInt8(137);
    
    const lastUpdateSlot = new BN(data.slice(138, 146), 'le');
    const lastUpdateStale = data.readUInt8(146) === 1;

    const deposits: KaminoDeposit[] = [];
    for (let i = 0; i < depositsLen && i < 8; i++) {
      const offset = 200 + i * 48;
      deposits.push({
        depositReserve: new PublicKey(data.slice(offset, offset + 32)),
        depositedAmount: new BN(data.slice(offset + 32, offset + 40), 'le'),
        marketValue: new BN(data.slice(offset + 40, offset + 48), 'le'),
        attributedBorrowValue: new BN(0),
      });
    }

    const borrows: KaminoBorrow[] = [];
    for (let i = 0; i < borrowsLen && i < 8; i++) {
      const offset = 584 + i * 56;
      borrows.push({
        borrowReserve: new PublicKey(data.slice(offset, offset + 32)),
        borrowedAmountWads: new BN(data.slice(offset + 32, offset + 48), 'le'),
        cumulativeBorrowRateWads: new BN(data.slice(offset + 48, offset + 56), 'le'),
        marketValue: new BN(0),
      });
    }

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
      }
    };
  }

  async getHealthFactor(obligation: KaminoObligation): Promise<number> {
    if (obligation.borrowedValue.isZero()) return Infinity;
    
    return obligation.unhealthyBorrowValue.toNumber() / obligation.borrowedValue.toNumber();
  }

  async getLTV(obligation: KaminoObligation): Promise<number> {
    if (obligation.depositedValue.isZero()) return 0;
    
    return obligation.borrowedValue.toNumber() / obligation.depositedValue.toNumber();
  }

  async getLiquidationPrice(obligation: KaminoObligation, collateralMint: PublicKey): Promise<number> {
    if (obligation.deposits.length === 0 || obligation.borrows.length === 0) {
      return 0;
    }

    const collateralDeposit = obligation.deposits.find(d => {
      const reserve = this.reserves.get(d.depositReserve.toBase58());
      return reserve?.mintAddress.equals(collateralMint);
    });

    if (!collateralDeposit) return 0;

    const reserve = this.reserves.get(collateralDeposit.depositReserve.toBase58());
    if (!reserve) return 0;

    const liquidationThreshold = reserve.config.liquidationThreshold;
    const borrowValue = obligation.borrowedValue.toNumber() / Math.pow(10, 8);
    const collateralAmount = collateralDeposit.depositedAmount.toNumber() / Math.pow(10, reserve.liquidity.mintDecimals);
    
    return borrowValue / (collateralAmount * liquidationThreshold);
  }

  getReserve(address: PublicKey): KaminoReserve | undefined {
    return this.reserves.get(address.toBase58());
  }

  async refreshObligation(obligation: KaminoObligation): Promise<void> {
    try {
      const accountInfo = await this.connection.getAccountInfo(obligation.address);
      if (!accountInfo?.data) return;

      const updatedObligation = this.parseObligation(obligation.address, accountInfo.data);
      Object.assign(obligation, updatedObligation);
    } catch (error) {
      console.error(`[KAMINO] Error refreshing obligation ${obligation.address.toBase58()}:`, error);
    }
  }
}
import { Connection, PublicKey } from '@solana/web3.js';

export const KAMINO_PROGRAM_ID = new PublicKey('KLend2g3cP87ber41aPn9Q5kkdCZNxMWTKZLGvBKgvV');

export interface KaminoObligation {
  address: PublicKey;
  owner: PublicKey;
  deposits: KaminoDeposit[];
  borrows: KaminoBorrow[];
  loanToValue: number;
  liquidationThreshold: number;
}

export interface KaminoDeposit {
  reserve: PublicKey;
  amount: number;
  marketValue: number;
}

export interface KaminoBorrow {
  reserve: PublicKey;
  amount: number;
  marketValue: number;
}

export class KaminoMonitor {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getObligationsByOwner(owner: PublicKey): Promise<KaminoObligation[]> {
    console.log(`[KAMINO] Fetching obligations for ${owner.toBase58()}`);

    try {
      const accounts = await this.connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 8, bytes: owner.toBase58() } }
        ]
      });

      return accounts.map(acc => this.parseObligation(acc.pubkey, acc.account.data));
    } catch (error) {
      console.error('[KAMINO] Error fetching obligations:', error);
      return [];
    }
  }

  private parseObligation(address: PublicKey, data: Buffer): KaminoObligation {
    const owner = new PublicKey(data.slice(8, 40));

    return {
      address,
      owner,
      deposits: [],
      borrows: [],
      loanToValue: 0.8,
      liquidationThreshold: 0.85,
    };
  }

  async getHealthFactor(obligation: KaminoObligation): Promise<number> {
    const totalDeposits = obligation.deposits.reduce((sum, d) => sum + d.marketValue, 0);
    const totalBorrows = obligation.borrows.reduce((sum, b) => sum + b.marketValue, 0);

    if (totalBorrows === 0) return Infinity;

    // Health = (Deposits * Liquidation Threshold) / Borrows
    return (totalDeposits * obligation.liquidationThreshold) / totalBorrows;
  }

  async getLiquidationPrice(obligation: KaminoObligation): Promise<number> {
    if (obligation.deposits.length === 0 || obligation.borrows.length === 0) {
      return 0;
    }

    const totalBorrows = obligation.borrows.reduce((sum, b) => sum + b.marketValue, 0);
    const mainDeposit = obligation.deposits[0];

    // Liquidation price = Total Borrows / (Deposit Amount * Liquidation Threshold)
    return totalBorrows / (mainDeposit.amount * obligation.liquidationThreshold);
  }
}

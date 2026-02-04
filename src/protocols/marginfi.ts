import { Connection, PublicKey } from '@solana/web3.js';

export const MARGINFI_PROGRAM_ID = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');

export interface MarginfiAccount {
  address: PublicKey;
  owner: PublicKey;
  balances: MarginfiBalance[];
  healthFactor: number;
}

export interface MarginfiBalance {
  bankAddress: PublicKey;
  assetShares: number;
  liabilityShares: number;
  lastUpdate: number;
}

export class MarginfiMonitor {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getAccountsByOwner(owner: PublicKey): Promise<MarginfiAccount[]> {
    console.log(`[MARGINFI] Fetching accounts for ${owner.toBase58()}`);

    try {
      const accounts = await this.connection.getProgramAccounts(MARGINFI_PROGRAM_ID, {
        filters: [
          { dataSize: 2272 }, // Marginfi account size
          { memcmp: { offset: 8, bytes: owner.toBase58() } }
        ]
      });

      return accounts.map(acc => this.parseAccount(acc.pubkey, acc.account.data));
    } catch (error) {
      console.error('[MARGINFI] Error fetching accounts:', error);
      return [];
    }
  }

  private parseAccount(address: PublicKey, data: Buffer): MarginfiAccount {
    // Simplified parsing - real implementation would decode full struct
    // Using @marginfi/marginfi-client-v2 for production

    const owner = new PublicKey(data.slice(8, 40));

    return {
      address,
      owner,
      balances: [],
      healthFactor: 1.5, // Would calculate from actual data
    };
  }

  async getHealthFactor(account: MarginfiAccount): Promise<number> {
    // Calculate health factor from balances
    // Health = Total Weighted Collateral / Total Liabilities

    let totalCollateral = 0;
    let totalLiabilities = 0;

    for (const balance of account.balances) {
      // Would fetch bank data for weights and prices
      totalCollateral += balance.assetShares;
      totalLiabilities += balance.liabilityShares;
    }

    if (totalLiabilities === 0) return Infinity;
    return totalCollateral / totalLiabilities;
  }

  async subscribeToAccount(address: PublicKey, callback: (account: MarginfiAccount) => void): Promise<number> {
    return this.connection.onAccountChange(address, (accountInfo) => {
      const parsed = this.parseAccount(address, accountInfo.data);
      callback(parsed);
    });
  }
}

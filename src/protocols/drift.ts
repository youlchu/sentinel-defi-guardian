import { Connection, PublicKey } from '@solana/web3.js';

export const DRIFT_PROGRAM_ID = new PublicKey('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH');

export interface DriftUser {
  address: PublicKey;
  authority: PublicKey;
  subAccountId: number;
  positions: DriftPosition[];
  totalCollateral: number;
  freeCollateral: number;
  marginRatio: number;
}

export interface DriftPosition {
  marketIndex: number;
  baseAssetAmount: number;
  quoteAssetAmount: number;
  lastCumulativeFundingRate: number;
  openOrders: number;
  unrealizedPnl: number;
}

export class DriftMonitor {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getUsersByAuthority(authority: PublicKey): Promise<DriftUser[]> {
    console.log(`[DRIFT] Fetching users for ${authority.toBase58()}`);

    try {
      // Find user account PDA
      const [userPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('user'),
          authority.toBuffer(),
          Buffer.from([0, 0]) // subAccountId = 0
        ],
        DRIFT_PROGRAM_ID
      );

      const accountInfo = await this.connection.getAccountInfo(userPda);
      if (!accountInfo) return [];

      return [this.parseUser(userPda, accountInfo.data)];
    } catch (error) {
      console.error('[DRIFT] Error fetching users:', error);
      return [];
    }
  }

  private parseUser(address: PublicKey, data: Buffer): DriftUser {
    const authority = new PublicKey(data.slice(8, 40));

    return {
      address,
      authority,
      subAccountId: 0,
      positions: [],
      totalCollateral: 0,
      freeCollateral: 0,
      marginRatio: 1.0,
    };
  }

  async getMarginRatio(user: DriftUser): Promise<number> {
    // Margin ratio = Total Collateral / Margin Requirement
    // In production, would calculate from positions and maintenance margin

    if (user.positions.length === 0) return Infinity;

    let totalMarginReq = 0;
    for (const pos of user.positions) {
      // Calculate margin requirement per position
      totalMarginReq += Math.abs(pos.baseAssetAmount) * 0.05; // 5% maintenance margin
    }

    if (totalMarginReq === 0) return Infinity;
    return user.totalCollateral / totalMarginReq;
  }

  async getLiquidationBuffer(user: DriftUser): Promise<number> {
    // How much the user can lose before liquidation
    const marginRatio = await this.getMarginRatio(user);
    const maintenanceMarginRatio = 0.05; // 5%

    return (marginRatio - maintenanceMarginRatio) / marginRatio * 100;
  }
}

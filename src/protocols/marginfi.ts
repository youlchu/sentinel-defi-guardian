import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { BorshCoder, utils } from '@coral-xyz/anchor';

export const MARGINFI_PROGRAM_ID = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');

export interface MarginfiAccount {
  address: PublicKey;
  owner: PublicKey;
  group: PublicKey;
  balances: MarginfiBalance[];
  healthFactor: number;
  totalAssetValue: number;
  totalLiabilityValue: number;
  accountType: number;
  padding: Buffer;
}

export interface MarginfiBalance {
  active: boolean;
  bankPk: PublicKey;
  assetShares: bigint;
  liabilityShares: bigint;
  emissionsOutstanding: bigint;
  lastUpdate: bigint;
  padding: Buffer;
}

export interface BankData {
  mint: PublicKey;
  mintDecimals: number;
  groupKey: PublicKey;
  assetShareValue: number;
  liabilityShareValue: number;
  liquidityVault: PublicKey;
  liquidityVaultBump: number;
  liquidityVaultAuthorityBump: number;
  insuranceVault: PublicKey;
  insuranceVaultBump: number;
  insuranceVaultAuthorityBump: number;
  collectedInsuranceFeesOutstanding: number;
  feeVault: PublicKey;
  feeVaultBump: number;
  feeVaultAuthorityBump: number;
  collectedGroupFeesOutstanding: number;
  totalLiabilityShares: number;
  totalAssetShares: number;
  lastUpdate: bigint;
  config: BankConfig;
  emissionsFlags: number;
  emissionsRate: number;
  emissionsRemaining: number;
  emissionsMint: PublicKey;
}

export interface BankConfig {
  assetWeightInit: number;
  assetWeightMaint: number;
  liabilityWeightInit: number;
  liabilityWeightMaint: number;
  depositLimit: number;
  interestRateConfig: InterestRateConfig;
  operationalState: number;
  oracleSetup: number;
  oracleKey: PublicKey;
  borrowLimit: number;
  riskTier: number;
  totalAssetValueInitLimit: number;
  oracleMaxAge: number;
  permissionlessFeatures: number;
}

export interface InterestRateConfig {
  optimalUtilizationRate: number;
  plateauInterestRate: number;
  maxInterestRate: number;
  insuranceFeeFixedApr: number;
  insuranceIrFee: number;
  protocolFixedFeeApr: number;
  protocolIrFee: number;
}

export interface OraclePrice {
  price: number;
  confidence: number;
  lastUpdatedSlot: number;
}

export class MarginfiMonitor {
  private connection: Connection;
  private bankCache: Map<string, BankData> = new Map();
  private priceCache: Map<string, OraclePrice> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getAccountsByOwner(owner: PublicKey): Promise<MarginfiAccount[]> {
    console.log(`[MARGINFI] Fetching accounts for ${owner.toBase58()}`);

    try {
      const accounts = await this.connection.getProgramAccounts(MARGINFI_PROGRAM_ID, {
        filters: [
          { dataSize: 2272 },
          { memcmp: { offset: 8, bytes: owner.toBase58() } }
        ]
      });

      const parsedAccounts: MarginfiAccount[] = [];
      
      for (const acc of accounts) {
        const parsed = await this.parseAccount(acc.pubkey, acc.account.data);
        parsedAccounts.push(parsed);
      }

      return parsedAccounts;
    } catch (error) {
      console.error('[MARGINFI] Error fetching accounts:', error);
      return [];
    }
  }

  async getAccountByAddress(address: PublicKey): Promise<MarginfiAccount | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(address);
      if (!accountInfo || accountInfo.owner.toBase58() !== MARGINFI_PROGRAM_ID.toBase58()) {
        return null;
      }

      return await this.parseAccount(address, accountInfo.data);
    } catch (error) {
      console.error(`[MARGINFI] Error fetching account ${address.toBase58()}:`, error);
      return null;
    }
  }

  private async parseAccount(address: PublicKey, data: Buffer): Promise<MarginfiAccount> {
    const discriminator = data.slice(0, 8);
    const owner = new PublicKey(data.slice(8, 40));
    const group = new PublicKey(data.slice(40, 72));
    
    let offset = 72;
    const balances: MarginfiBalance[] = [];
    
    for (let i = 0; i < 16; i++) {
      const active = data.readUInt8(offset) === 1;
      offset += 1;
      
      const bankPk = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const assetShares = this.readBigUInt64LE(data, offset);
      offset += 8;
      
      const liabilityShares = this.readBigUInt64LE(data, offset);
      offset += 8;
      
      const emissionsOutstanding = this.readBigUInt64LE(data, offset);
      offset += 8;
      
      const lastUpdate = this.readBigUInt64LE(data, offset);
      offset += 8;
      
      const padding = data.slice(offset, offset + 8);
      offset += 8;

      if (active && (assetShares > 0n || liabilityShares > 0n)) {
        balances.push({
          active,
          bankPk,
          assetShares,
          liabilityShares,
          emissionsOutstanding,
          lastUpdate,
          padding
        });
      }
    }

    const accountType = data.readUInt8(offset);
    offset += 1;
    
    const padding = data.slice(offset);

    const account: MarginfiAccount = {
      address,
      owner,
      group,
      balances,
      healthFactor: 0,
      totalAssetValue: 0,
      totalLiabilityValue: 0,
      accountType,
      padding
    };

    const healthData = await this.calculateHealthFactor(account);
    account.healthFactor = healthData.healthFactor;
    account.totalAssetValue = healthData.totalAssetValue;
    account.totalLiabilityValue = healthData.totalLiabilityValue;

    return account;
  }

  private readBigUInt64LE(buffer: Buffer, offset: number): bigint {
    const low = buffer.readUInt32LE(offset);
    const high = buffer.readUInt32LE(offset + 4);
    return BigInt(low) + (BigInt(high) << 32n);
  }

  async calculateHealthFactor(account: MarginfiAccount): Promise<{
    healthFactor: number;
    totalAssetValue: number;
    totalLiabilityValue: number;
  }> {
    let totalWeightedAssets = 0;
    let totalWeightedLiabilities = 0;
    let totalAssetValue = 0;
    let totalLiabilityValue = 0;

    for (const balance of account.balances) {
      if (!balance.active) continue;

      const bank = await this.getBankData(balance.bankPk);
      if (!bank) continue;

      const price = await this.getOraclePrice(bank.config.oracleKey);
      if (!price || price.price <= 0) continue;

      const assetAmount = Number(balance.assetShares) * bank.assetShareValue;
      const liabilityAmount = Number(balance.liabilityShares) * bank.liabilityShareValue;

      const assetValue = (assetAmount * price.price) / Math.pow(10, bank.mintDecimals);
      const liabilityValue = (liabilityAmount * price.price) / Math.pow(10, bank.mintDecimals);

      totalAssetValue += assetValue;
      totalLiabilityValue += liabilityValue;

      const weightedAssetValue = assetValue * bank.config.assetWeightMaint;
      const weightedLiabilityValue = liabilityValue * bank.config.liabilityWeightMaint;

      totalWeightedAssets += weightedAssetValue;
      totalWeightedLiabilities += weightedLiabilityValue;
    }

    const healthFactor = totalWeightedLiabilities > 0 
      ? totalWeightedAssets / totalWeightedLiabilities 
      : Infinity;

    return {
      healthFactor,
      totalAssetValue,
      totalLiabilityValue
    };
  }

  private async getBankData(bankAddress: PublicKey): Promise<BankData | null> {
    const key = bankAddress.toBase58();
    
    if (this.bankCache.has(key)) {
      return this.bankCache.get(key)!;
    }

    try {
      const accountInfo = await this.connection.getAccountInfo(bankAddress);
      if (!accountInfo) return null;

      const bankData = this.parseBankData(accountInfo.data);
      if (bankData) {
        this.bankCache.set(key, bankData);
      }
      
      return bankData;
    } catch (error) {
      console.error(`[MARGINFI] Error fetching bank data for ${key}:`, error);
      return null;
    }
  }

  private parseBankData(data: Buffer): BankData | null {
    try {
      let offset = 8;
      
      const mint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const mintDecimals = data.readUInt8(offset);
      offset += 1;
      
      const groupKey = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const assetShareValue = data.readDoubleLE(offset);
      offset += 8;
      
      const liabilityShareValue = data.readDoubleLE(offset);
      offset += 8;
      
      const liquidityVault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const liquidityVaultBump = data.readUInt8(offset);
      offset += 1;
      
      const liquidityVaultAuthorityBump = data.readUInt8(offset);
      offset += 1;
      
      const insuranceVault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const insuranceVaultBump = data.readUInt8(offset);
      offset += 1;
      
      const insuranceVaultAuthorityBump = data.readUInt8(offset);
      offset += 1;
      
      const collectedInsuranceFeesOutstanding = data.readDoubleLE(offset);
      offset += 8;
      
      const feeVault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const feeVaultBump = data.readUInt8(offset);
      offset += 1;
      
      const feeVaultAuthorityBump = data.readUInt8(offset);
      offset += 1;
      
      const collectedGroupFeesOutstanding = data.readDoubleLE(offset);
      offset += 8;
      
      const totalLiabilityShares = data.readDoubleLE(offset);
      offset += 8;
      
      const totalAssetShares = data.readDoubleLE(offset);
      offset += 8;
      
      const lastUpdate = this.readBigUInt64LE(data, offset);
      offset += 8;

      const assetWeightInit = data.readDoubleLE(offset);
      offset += 8;
      
      const assetWeightMaint = data.readDoubleLE(offset);
      offset += 8;
      
      const liabilityWeightInit = data.readDoubleLE(offset);
      offset += 8;
      
      const liabilityWeightMaint = data.readDoubleLE(offset);
      offset += 8;
      
      const depositLimit = data.readDoubleLE(offset);
      offset += 8;

      const optimalUtilizationRate = data.readDoubleLE(offset);
      offset += 8;
      
      const plateauInterestRate = data.readDoubleLE(offset);
      offset += 8;
      
      const maxInterestRate = data.readDoubleLE(offset);
      offset += 8;
      
      const insuranceFeeFixedApr = data.readDoubleLE(offset);
      offset += 8;
      
      const insuranceIrFee = data.readDoubleLE(offset);
      offset += 8;
      
      const protocolFixedFeeApr = data.readDoubleLE(offset);
      offset += 8;
      
      const protocolIrFee = data.readDoubleLE(offset);
      offset += 8;

      const operationalState = data.readUInt8(offset);
      offset += 1;
      
      const oracleSetup = data.readUInt8(offset);
      offset += 1;
      
      const oracleKey = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const borrowLimit = data.readDoubleLE(offset);
      offset += 8;
      
      const riskTier = data.readUInt8(offset);
      offset += 1;
      
      const totalAssetValueInitLimit = data.readDoubleLE(offset);
      offset += 8;
      
      const oracleMaxAge = data.readUInt16LE(offset);
      offset += 2;
      
      const permissionlessFeatures = data.readUInt8(offset);
      offset += 1;

      const emissionsFlags = data.readUInt64LE(offset);
      offset += 8;
      
      const emissionsRate = data.readDoubleLE(offset);
      offset += 8;
      
      const emissionsRemaining = data.readDoubleLE(offset);
      offset += 8;
      
      const emissionsMint = new PublicKey(data.slice(offset, offset + 32));

      return {
        mint,
        mintDecimals,
        groupKey,
        assetShareValue,
        liabilityShareValue,
        liquidityVault,
        liquidityVaultBump,
        liquidityVaultAuthorityBump,
        insuranceVault,
        insuranceVaultBump,
        insuranceVaultAuthorityBump,
        collectedInsuranceFeesOutstanding,
        feeVault,
        feeVaultBump,
        feeVaultAuthorityBump,
        collectedGroupFeesOutstanding,
        totalLiabilityShares,
        totalAssetShares,
        lastUpdate,
        config: {
          assetWeightInit,
          assetWeightMaint,
          liabilityWeightInit,
          liabilityWeightMaint,
          depositLimit,
          interestRateConfig: {
            optimalUtilizationRate,
            plateauInterestRate,
            maxInterestRate,
            insuranceFeeFixedApr,
            insuranceIrFee,
            protocolFixedFeeApr,
            protocolIrFee
          },
          operationalState,
          oracleSetup,
          oracleKey,
          borrowLimit,
          riskTier,
          totalAssetValueInitLimit,
          oracleMaxAge,
          permissionlessFeatures
        },
        emissionsFlags: Number(emissionsFlags),
        emissionsRate,
        emissionsRemaining,
        emissionsMint
      };
    } catch (error) {
      console.error('[MARGINFI] Error parsing bank data:', error);
      return null;
    }
  }

  private async getOraclePrice(oracleKey: PublicKey): Promise<OraclePrice | null> {
    const key = oracleKey.toBase58();
    
    if (this.priceCache.has(key)) {
      const cached = this.priceCache.get(key)!;
      if (Date.now() - cached.lastUpdatedSlot * 400 < 30000) {
        return cached;
      }
    }

    try {
      const accountInfo = await this.connection.getAccountInfo(oracleKey);
      if (!accountInfo) return null;

      let price: OraclePrice | null = null;

      if (this.isPythOracle(accountInfo.data)) {
        price = this.parsePythPrice(accountInfo.data);
      } else if (this.isSwitchboardOracle(accountInfo.data)) {
        price = this.parseSwitchboardPrice(accountInfo.data);
      }

      if (price) {
        this.priceCache.set(key, price);
      }
      
      return price;
    } catch (error) {
      console.error(`[MARGINFI] Error fetching oracle price for ${key}:`, error);
      return null;
    }
  }

  private isPythOracle(data: Buffer): boolean {
    if (data.length < 16) return false;
    const magic = data.readUInt32LE(0);
    const version = data.readUInt32LE(4);
    const type = data.readUInt32LE(8);
    return magic === 0xa1b2c3d4 && version === 2 && type === 3;
  }

  private isSwitchboardOracle(data: Buffer): boolean {
    if (data.length < 8) return false;
    const discriminator = data.slice(0, 8);
    const sbDiscriminator = Buffer.from([41, 53, 204, 47, 119, 23, 151, 162]);
    return discriminator.equals(sbDiscriminator);
  }

  private parsePythPrice(data: Buffer): OraclePrice | null {
    try {
      const magic = data.readUInt32LE(0);
      if (magic !== 0xa1b2c3d4) return null;

      const version = data.readUInt32LE(4);
      if (version !== 2) return null;

      const type = data.readUInt32LE(8);
      if (type !== 3) return null;

      const size = data.readUInt32LE(12);
      const priceAccountKey = new PublicKey(data.slice(16, 48));
      
      let offset = 208;
      const aggregatePrice = data.readBigInt64LE(offset);
      offset += 8;
      
      const aggregateConf = data.readBigUInt64LE(offset);
      offset += 8;
      
      const aggregateStatus = data.readUInt32LE(offset);
      offset += 4;
      
      const aggregateCorpAct = data.readUInt32LE(offset);
      offset += 4;
      
      const aggregatePubSlot = data.readBigUInt64LE(offset);
      offset += 8;

      const exponent = data.readInt32LE(176);
      const price = Number(aggregatePrice) * Math.pow(10, exponent);
      const confidence = Number(aggregateConf) * Math.pow(10, exponent);

      if (aggregateStatus !== 1) {
        return null;
      }

      return {
        price,
        confidence,
        lastUpdatedSlot: Number(aggregatePubSlot)
      };
    } catch (error) {
      console.error('[MARGINFI] Error parsing Pyth price:', error);
      return null;
    }
  }

  private parseSwitchboardPrice(data: Buffer): OraclePrice | null {
    try {
      let offset = 8;
      
      const result = data.readDoubleLE(offset);
      offset += 8;
      
      const lastUpdateTimestamp = data.readBigInt64LE(offset);
      offset += 8;
      
      const minResponse = data.readDoubleLE(offset);
      offset += 8;
      
      const maxResponse = data.readDoubleLE(offset);
      offset += 8;

      const confidence = Math.abs(maxResponse - minResponse) / 2;

      return {
        price: result,
        confidence,
        lastUpdatedSlot: Number(lastUpdateTimestamp) / 1000
      };
    } catch (error) {
      console.error('[MARGINFI] Error parsing Switchboard price:', error);
      return null;
    }
  }

  async getHealthFactor(account: MarginfiAccount): Promise<number> {
    const healthData = await this.calculateHealthFactor(account);
    return healthData.healthFactor;
  }

  async subscribeToAccount(address: PublicKey, callback: (account: MarginfiAccount) => void): Promise<number> {
    return this.connection.onAccountChange(address, async (accountInfo) => {
      const parsed = await this.parseAccount(address, accountInfo.data);
      callback(parsed);
    });
  }

  async subscribeToBank(bankAddress: PublicKey, callback: (bank: BankData) => void): Promise<number> {
    return this.connection.onAccountChange(bankAddress, (accountInfo) => {
      const bank = this.parseBankData(accountInfo.data);
      if (bank) {
        this.bankCache.set(bankAddress.toBase58(), bank);
        callback(bank);
      }
    });
  }

  unsubscribe(subscriptionId: number): void {
    this.connection.removeAccountChangeListener(subscriptionId);
  }

  clearCache(): void {
    this.bankCache.clear();
    this.priceCache.clear();
  }

  getBankCache(): Map<string, BankData> {
    return new Map(this.bankCache);
  }

  getPriceCache(): Map<string, OraclePrice> {
    return new Map(this.priceCache);
  }

  async refreshBankData(bankAddress: PublicKey): Promise<BankData | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(bankAddress);
      if (!accountInfo) return null;

      const bankData = this.parseBankData(accountInfo.data);
      if (bankData) {
        this.bankCache.set(bankAddress.toBase58(), bankData);
      }
      
      return bankData;
    } catch (error) {
      console.error(`[MARGINFI] Error refreshing bank data for ${bankAddress.toBase58()}:`, error);
      return null;
    }
  }

  async refreshOraclePrice(oracleKey: PublicKey): Promise<OraclePrice | null> {
    const key = oracleKey.toBase58();
    this.priceCache.delete(key);
    return await this.getOraclePrice(oracleKey);
  }
}
import { Connection, PublicKey } from '@solana/web3.js';
import WebSocket from 'ws';

export interface Position {
  id: string;
  protocol: 'marginfi' | 'kamino' | 'drift';
  owner: PublicKey;
  collateral: {
    mint: PublicKey;
    amount: number;
    valueUsd: number;
  }[];
  debt: {
    mint: PublicKey;
    amount: number;
    valueUsd: number;
  }[];
  healthFactor: number;
  timestamp: number;
}

export interface PositionChange {
  position: Position;
  changeType: 'created' | 'updated' | 'deleted';
  previousPosition?: Position;
  timestamp: number;
}

export class PositionMonitor {
  private connection: Connection;
  private watchedAddresses: Set<string> = new Set();
  private heliusWs: WebSocket | null = null;
  private heliusApiKey: string;
  private previousPositions: Map<string, Position> = new Map();
  private changeCallbacks: ((change: PositionChange) => void)[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(connection: Connection, heliusApiKey: string) {
    this.connection = connection;
    this.heliusApiKey = heliusApiKey;
  }

  addWatchAddress(address: string): void {
    this.watchedAddresses.add(address);
    console.log(`[MONITOR] Now watching: ${address}`);
    
    if (this.heliusWs && this.heliusWs.readyState === WebSocket.OPEN) {
      this.subscribeToAddress(address);
    }
  }

  removeWatchAddress(address: string): void {
    this.watchedAddresses.delete(address);
    
    if (this.heliusWs && this.heliusWs.readyState === WebSocket.OPEN) {
      this.unsubscribeFromAddress(address);
    }
  }

  onPositionChange(callback: (change: PositionChange) => void): void {
    this.changeCallbacks.push(callback);
  }

  async startWebSocketMonitoring(): Promise<void> {
    const wsUrl = `wss://atlas-mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
    
    this.heliusWs = new WebSocket(wsUrl);

    this.heliusWs.on('open', () => {
      console.log('[WEBSOCKET] Connected to Helius');
      this.reconnectAttempts = 0;
      
      for (const address of this.watchedAddresses) {
        this.subscribeToAddress(address);
      }
    });

    this.heliusWs.on('message', async (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleWebSocketMessage(message);
      } catch (error) {
        console.error('[WEBSOCKET] Error parsing message:', error);
      }
    });

    this.heliusWs.on('close', () => {
      console.log('[WEBSOCKET] Connection closed');
      this.attemptReconnect();
    });

    this.heliusWs.on('error', (error) => {
      console.error('[WEBSOCKET] Error:', error);
      this.attemptReconnect();
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WEBSOCKET] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[WEBSOCKET] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.startWebSocketMonitoring();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  private subscribeToAddress(address: string): void {
    if (!this.heliusWs || this.heliusWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscription = {
      jsonrpc: '2.0',
      id: `account-${address}`,
      method: 'accountSubscribe',
      params: [
        address,
        {
          encoding: 'base64',
          commitment: 'confirmed'
        }
      ]
    };

    this.heliusWs.send(JSON.stringify(subscription));
    console.log(`[WEBSOCKET] Subscribed to account: ${address}`);
  }

  private unsubscribeFromAddress(address: string): void {
    if (!this.heliusWs || this.heliusWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscribe = {
      jsonrpc: '2.0',
      id: `unsubscribe-${address}`,
      method: 'accountUnsubscribe',
      params: [`account-${address}`]
    };

    this.heliusWs.send(JSON.stringify(unsubscribe));
    console.log(`[WEBSOCKET] Unsubscribed from account: ${address}`);
  }

  private async handleWebSocketMessage(message: any): Promise<void> {
    if (message.method === 'accountNotification') {
      const { pubkey, account } = message.params.result.value;
      console.log(`[WEBSOCKET] Account update for: ${pubkey}`);
      
      await this.processAccountUpdate(pubkey);
    }
  }

  private async processAccountUpdate(address: string): Promise<void> {
    try {
      const pubkey = new PublicKey(address);
      const currentPositions = await this.fetchPositionsForAddress(pubkey);
      
      for (const position of currentPositions) {
        const previousPosition = this.previousPositions.get(position.id);
        
        if (!previousPosition) {
          const change: PositionChange = {
            position,
            changeType: 'created',
            timestamp: Date.now()
          };
          
          this.notifyPositionChange(change);
          this.previousPositions.set(position.id, position);
        } else if (this.hasPositionChanged(previousPosition, position)) {
          const change: PositionChange = {
            position,
            changeType: 'updated',
            previousPosition,
            timestamp: Date.now()
          };
          
          this.notifyPositionChange(change);
          this.previousPositions.set(position.id, position);
        }
      }
      
      for (const [positionId, previousPosition] of this.previousPositions.entries()) {
        if (previousPosition.owner.equals(pubkey) && 
            !currentPositions.find(p => p.id === positionId)) {
          const change: PositionChange = {
            position: previousPosition,
            changeType: 'deleted',
            timestamp: Date.now()
          };
          
          this.notifyPositionChange(change);
          this.previousPositions.delete(positionId);
        }
      }
    } catch (error) {
      console.error(`[WEBSOCKET] Error processing account update for ${address}:`, error);
    }
  }

  private hasPositionChanged(previous: Position, current: Position): boolean {
    if (previous.healthFactor !== current.healthFactor) return true;
    if (previous.collateral.length !== current.collateral.length) return true;
    if (previous.debt.length !== current.debt.length) return true;
    
    for (let i = 0; i < previous.collateral.length; i++) {
      if (previous.collateral[i].amount !== current.collateral[i].amount ||
          previous.collateral[i].valueUsd !== current.collateral[i].valueUsd) {
        return true;
      }
    }
    
    for (let i = 0; i < previous.debt.length; i++) {
      if (previous.debt[i].amount !== current.debt[i].amount ||
          previous.debt[i].valueUsd !== current.debt[i].valueUsd) {
        return true;
      }
    }
    
    return false;
  }

  private notifyPositionChange(change: PositionChange): void {
    console.log(`[MONITOR] Position ${change.changeType}: ${change.position.id}`);
    
    for (const callback of this.changeCallbacks) {
      try {
        callback(change);
      } catch (error) {
        console.error('[MONITOR] Error in position change callback:', error);
      }
    }
  }

  async fetchPositionsForAddress(owner: PublicKey): Promise<Position[]> {
    const positions: Position[] = [];

    try {
      const marginfiPositions = await this.fetchMarginfiPositions(owner);
      const kaminoPositions = await this.fetchKaminoPositions(owner);
      const driftPositions = await this.fetchDriftPositions(owner);

      positions.push(...marginfiPositions, ...kaminoPositions, ...driftPositions);
    } catch (error) {
      console.error(`[MONITOR] Error fetching positions for ${owner.toBase58()}:`, error);
    }

    return positions;
  }

  async fetchAllPositions(): Promise<Position[]> {
    const positions: Position[] = [];

    for (const address of this.watchedAddresses) {
      try {
        const pubkey = new PublicKey(address);
        const addressPositions = await this.fetchPositionsForAddress(pubkey);
        positions.push(...addressPositions);
        
        for (const position of addressPositions) {
          this.previousPositions.set(position.id, position);
        }
      } catch (error) {
        console.error(`[MONITOR] Error fetching positions for ${address}:`, error);
      }
    }

    return positions;
  }

  private async fetchMarginfiPositions(owner: PublicKey): Promise<Position[]> {
    console.log(`[MARGINFI] Fetching positions for ${owner.toBase58()}`);

    const positions: Position[] = [];

    try {
      const MARGINFI_PROGRAM_ID = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');

      const accounts = await this.connection.getProgramAccounts(MARGINFI_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 8, bytes: owner.toBase58() } }
        ]
      });

      for (const account of accounts) {
        positions.push({
          id: account.pubkey.toBase58(),
          protocol: 'marginfi',
          owner,
          collateral: [],
          debt: [],
          healthFactor: 1.5,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('[MARGINFI] Error:', error);
    }

    return positions;
  }

  private async fetchKaminoPositions(owner: PublicKey): Promise<Position[]> {
    console.log(`[KAMINO] Fetching positions for ${owner.toBase58()}`);

    const positions: Position[] = [];

    try {
      const KAMINO_PROGRAM_ID = new PublicKey('KLend2g3cP87ber41aPn9Q5kkdCZNxMWTKZLGvBKgvV');

      const accounts = await this.connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 8, bytes: owner.toBase58() } }
        ]
      });

      for (const account of accounts) {
        positions.push({
          id: account.pubkey.toBase58(),
          protocol: 'kamino',
          owner,
          collateral: [],
          debt: [],
          healthFactor: 1.5,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('[KAMINO] Error:', error);
    }

    return positions;
  }

  private async fetchDriftPositions(owner: PublicKey): Promise<Position[]> {
    console.log(`[DRIFT] Fetching positions for ${owner.toBase58()}`);

    const positions: Position[] = [];

    try {
      const DRIFT_PROGRAM_ID = new PublicKey('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH');

      const accounts = await this.connection.getProgramAccounts(DRIFT_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 8, bytes: owner.toBase58() } }
        ]
      });

      for (const account of accounts) {
        positions.push({
          id: account.pubkey.toBase58(),
          protocol: 'drift',
          owner,
          collateral: [],
          debt: [],
          healthFactor: 1.5,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('[DRIFT] Error:', error);
    }

    return positions;
  }

  async stopWebSocketMonitoring(): Promise<void> {
    if (this.heliusWs) {
      this.heliusWs.close();
      this.heliusWs = null;
      console.log('[WEBSOCKET] Stopped monitoring');
    }
  }
}
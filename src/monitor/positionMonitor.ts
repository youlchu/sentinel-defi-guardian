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
  private subscriptionIds: Map<string, number> = new Map();
  private subscriptionCounter = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;

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
    
    this.heliusWs = new WebSocket(wsUrl, {
      perMessageDeflate: false,
      handshakeTimeout: 30000,
    });

    this.heliusWs.on('open', () => {
      console.log('[WEBSOCKET] Connected to Helius');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      
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

    this.heliusWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[WEBSOCKET] Connection closed - Code: ${code}, Reason: ${reason.toString()}`);
      this.stopHeartbeat();
      this.attemptReconnect();
    });

    this.heliusWs.on('error', (error: Error) => {
      console.error('[WEBSOCKET] Error:', error);
      this.stopHeartbeat();
      this.attemptReconnect();
    });

    this.heliusWs.on('pong', () => {
      console.log('[WEBSOCKET] Pong received - connection alive');
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.heliusWs && this.heliusWs.readyState === WebSocket.OPEN) {
        this.heliusWs.ping();
        console.log('[WEBSOCKET] Ping sent');
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WEBSOCKET] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[WEBSOCKET] Attempting to reconnect in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.startWebSocketMonitoring();
    }, delay);
  }

  private subscribeToAddress(address: string): void {
    if (!this.heliusWs || this.heliusWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscriptionId = ++this.subscriptionCounter;
    this.subscriptionIds.set(address, subscriptionId);

    const subscription = {
      jsonrpc: '2.0',
      id: subscriptionId,
      method: 'accountSubscribe',
      params: [
        address,
        {
          encoding: 'base64',
          commitment: 'confirmed',
          dataSlice: {
            offset: 0,
            length: 0
          }
        }
      ]
    };

    this.heliusWs.send(JSON.stringify(subscription));
    console.log(`[WEBSOCKET] Subscribed to account: ${address} (ID: ${subscriptionId})`);
  }

  private unsubscribeFromAddress(address: string): void {
    if (!this.heliusWs || this.heliusWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscriptionId = this.subscriptionIds.get(address);
    if (!subscriptionId) {
      return;
    }

    const unsubscribe = {
      jsonrpc: '2.0',
      id: ++this.subscriptionCounter,
      method: 'accountUnsubscribe',
      params: [subscriptionId]
    };

    this.heliusWs.send(JSON.stringify(unsubscribe));
    this.subscriptionIds.delete(address);
    console.log(`[WEBSOCKET] Unsubscribed from account: ${address} (ID: ${subscriptionId})`);
  }

  private async handleWebSocketMessage(message: any): Promise<void> {
    if (message.method === 'accountNotification') {
      const notification = message.params;
      if (notification && notification.result && notification.result.value) {
        const pubkey = notification.result.context?.slot ? 
          this.findAddressBySubscriptionId(notification.subscription) : null;
        
        if (pubkey) {
          console.log(`[WEBSOCKET] Account update for: ${pubkey}`);
          await this.processAccountUpdate(pubkey);
        }
      }
    } else if (message.result && typeof message.result === 'number') {
      console.log(`[WEBSOCKET] Subscription confirmed with ID: ${message.result}`);
    } else if (message.error) {
      console.error('[WEBSOCKET] RPC Error:', message.error);
    }
  }

  private findAddressBySubscriptionId(subscriptionId: number): string | null {
    for (const [address, id] of this.subscriptionIds.entries()) {
      if (id === subscriptionId) {
        return address;
      }
    }
    return null;
  }

  private async processAccountUpdate(address: string): Promise<void> {
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const pubkey = new PublicKey(address);
      const currentPositions = await this.fetchPositionsForAddress(pubkey);
      
      const addressPositions = currentPositions.filter(p => p.owner.equals(pubkey));
      const previousAddressPositions = Array.from(this.previousPositions.values())
        .filter(p => p.owner.equals(pubkey));
      
      for (const position of addressPositions) {
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
      
      for (const previousPosition of previousAddressPositions) {
        if (!addressPositions.find(p => p.id === previousPosition.id)) {
          const change: PositionChange = {
            position: previousPosition,
            changeType: 'deleted',
            timestamp: Date.now()
          };
          
          this.notifyPositionChange(change);
          this.previousPositions.delete(previousPosition.id);
        }
      }
    } catch (error) {
      console.error(`[WEBSOCKET] Error processing account update for ${address}:`, error);
    }
  }

  private hasPositionChanged(previous: Position, current: Position): boolean {
    if (Math.abs(previous.healthFactor - current.healthFactor) > 0.001) return true;
    if (previous.collateral.length !== current.collateral.length) return true;
    if (previous.debt.length !== current.debt.length) return true;
    
    for (let i = 0; i < previous.collateral.length; i++) {
      const prevColl = previous.collateral[i];
      const currColl = current.collateral[i];
      if (Math.abs(prevColl.amount - currColl.amount) > 0.001 ||
          Math.abs(prevColl.valueUsd - currColl.valueUsd) > 0.01) {
        return true;
      }
    }
    
    for (let i = 0; i < previous.debt.length; i++) {
      const prevDebt = previous.debt[i];
      const currDebt = current.debt[i];
      if (Math.abs(prevDebt.amount - currDebt.amount) > 0.001 ||
          Math.abs(prevDebt.valueUsd - currDebt.valueUsd) > 0.01) {
        return true;
      }
    }
    
    return false;
  }

  private notifyPositionChange(change: PositionChange): void {
    console.log(`[MONITOR] Position ${change.changeType}: ${change.position.id} (Protocol: ${change.position.protocol})`);
    
    if (change.changeType === 'updated' && change.previousPosition) {
      console.log(`[MONITOR] Health factor changed: ${change.previousPosition.healthFactor} -> ${change.position.healthFactor}`);
    }
    
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
      const [marginfiPositions, kaminoPositions, driftPositions] = await Promise.allSettled([
        this.fetchMarginfiPositions(owner),
        this.fetchKaminoPositions(owner),
        this.fetchDriftPositions(owner)
      ]);

      if (marginfiPositions.status === 'fulfilled') {
        positions.push(...marginfiPositions.value);
      } else {
        console.error('[MARGINFI] Error fetching positions:', marginfiPositions.reason);
      }

      if (kaminoPositions.status === 'fulfilled') {
        positions.push(...kaminoPositions.value);
      } else {
        console.error('[KAMINO] Error fetching positions:', kaminoPositions.reason);
      }

      if (driftPositions.status === 'fulfilled') {
        positions.push(...driftPositions.value);
      } else {
        console.error('[DRIFT] Error fetching positions:', driftPositions.reason);
      }
    } catch (error) {
      console.error(`[MONITOR] Error fetching positions for ${owner.toBase58()}:`, error);
    }

    return positions;
  }

  async fetchAllPositions(): Promise<Position[]> {
    const positions: Position[] = [];
    const fetchPromises: Promise<void>[] = [];

    for (const address of this.watchedAddresses) {
      fetchPromises.push(
        (async () => {
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
        })()
      );
    }

    await Promise.allSettled(fetchPromises);
    console.log(`[MONITOR] Fetched ${positions.length} total positions across all addresses`);
    
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
        ],
        dataSlice: { offset: 0, length: 0 }
      });

      for (const account of accounts) {
        positions.push({
          id: `marginfi-${account.pubkey.toBase58()}`,
          protocol: 'marginfi',
          owner,
          collateral: [],
          debt: [],
          healthFactor: 1.5,
          timestamp: Date.now(),
        });
      }

      console.log(`[MARGINFI] Found ${positions.length} positions`);
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
        ],
        dataSlice: { offset: 0, length: 0 }
      });

      for (const account of accounts) {
        positions.push({
          id: `kamino-${account.pubkey.toBase58()}`,
          protocol: 'kamino',
          owner,
          collateral: [],
          debt: [],
          healthFactor: 1.5,
          timestamp: Date.now(),
        });
      }

      console.log(`[KAMINO] Found ${positions.length} positions`);
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
        ],
        dataSlice: { offset: 0, length: 0 }
      });

      for (const account of accounts) {
        positions.push({
          id: `drift-${account.pubkey.toBase58()}`,
          protocol: 'drift',
          owner,
          collateral: [],
          debt: [],
          healthFactor: 1.5,
          timestamp: Date.now(),
        });
      }

      console.log(`[DRIFT] Found ${positions.length} positions`);
    } catch (error) {
      console.error('[DRIFT] Error:', error);
    }

    return positions;
  }

  getConnectionStatus(): string {
    if (!this.heliusWs) return 'disconnected';
    
    switch (this.heliusWs.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'closed';
      default: return 'unknown';
    }
  }

  getWatchedAddresses(): string[] {
    return Array.from(this.watchedAddresses);
  }

  getSubscriptionCount(): number {
    return this.subscriptionIds.size;
  }

  async stopWebSocketMonitoring(): Promise<void> {
    this.stopHeartbeat();
    
    if (this.heliusWs) {
      for (const address of this.watchedAddresses) {
        this.unsubscribeFromAddress(address);
      }
      
      await new Promise<void>((resolve) => {
        if (this.heliusWs) {
          this.heliusWs.close(1000, 'Manual shutdown');
          this.heliusWs.on('close', () => resolve());
        } else {
          resolve();
        }
      });
      
      this.heliusWs = null;
      this.subscriptionIds.clear();
      console.log('[WEBSOCKET] Stopped monitoring');
    }
  }
}
import { Connection, PublicKey } from "@solana/web3.js";

export interface Position {
  id: string;
  protocol: "marginfi" | "kamino" | "drift";
  owner: PublicKey;
  collateral: {
    mint: PublicKey;
    amount: number;
    valueUsd: number;
    priceUsd?: number;
  }[];
  debt: {
    mint: PublicKey;
    amount: number;
    valueUsd: number;
  }[];
  healthFactor: number;
  timestamp: number;
  liquidationThreshold?: number;
}

export interface PositionChange {
  position: Position;
  changeType: "created" | "updated" | "deleted";
  previousPosition?: Position;
  timestamp: number;
}

export interface ApiPosition {
  id: string;
  protocol: "marginfi" | "kamino" | "drift";
  owner: string;
  collateral: {
    mint: string;
    amount: number;
    valueUsd: number;
    priceUsd?: number;
  }[];
  debt: {
    mint: string;
    amount: number;
    valueUsd: number;
  }[];
  healthFactor: number;
  timestamp: number;
  liquidationThreshold?: number;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "down";
  timestamp: number;
  uptime: number;
  services: {
    database: boolean;
    rpc: boolean;
    websocket: boolean;
  };
  version: string;
}

export interface Alert {
  id: string;
  type: "liquidation_risk" | "health_factor" | "price_alert" | "system";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  positionId?: string;
  timestamp: number;
  acknowledged: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface ApiClientConfig {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

export class ApiError extends Error {
  public status: number;
  public response?: any;

  constructor(message: string, status: number, response?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.response = response;
  }
}

export class ApiClient {
  private baseURL: string;
  private timeout: number;
  private headers: Record<string, string>;
  private retries: number;
  private retryDelay: number;

  constructor(config: ApiClientConfig) {
    this.baseURL = config.baseURL.replace(/\/$/, "");
    this.timeout = config.timeout || 10000;
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };
    this.retries = config.retries || 3;
    this.retryDelay = config.retryDelay || 1000;
  }

  private async fetchWithRetry<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    let lastError: Error;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.headers,
            ...options.headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new ApiError(
            `HTTP ${response.status}: ${errorText}`,
            response.status,
            errorText
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.retries) {
          break;
        }

        if (error instanceof ApiError && error.status < 500) {
          break;
        }

        await this.delay(this.retryDelay * Math.pow(2, attempt));
      }
    }

    throw lastError!;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private convertApiPositionToPosition(apiPosition: ApiPosition): Position {
    return {
      ...apiPosition,
      owner: new PublicKey(apiPosition.owner),
      collateral: apiPosition.collateral.map(c => ({
        ...c,
        mint: new PublicKey(c.mint),
      })),
      debt: apiPosition.debt.map(d => ({
        ...d,
        mint: new PublicKey(d.mint),
      })),
    };
  }

  async fetchHealthStatus(): Promise<HealthStatus> {
    try {
      const response = await this.fetchWithRetry<ApiResponse<HealthStatus>>("/health");
      
      if (!response.success || !response.data) {
        throw new Error("Invalid health status response");
      }

      return response.data;
    } catch (error) {
      console.error("[API_CLIENT] Error fetching health status:", error);
      throw error;
    }
  }

  async fetchPositions(owner?: string): Promise<Position[]> {
    try {
      const endpoint = owner ? `/positions?owner=${encodeURIComponent(owner)}` : "/positions";
      const response = await this.fetchWithRetry<ApiResponse<ApiPosition[]>>(endpoint);
      
      if (!response.success || !response.data) {
        throw new Error("Invalid positions response");
      }

      return response.data.map(pos => this.convertApiPositionToPosition(pos));
    } catch (error) {
      console.error("[API_CLIENT] Error fetching positions:", error);
      throw error;
    }
  }

  async fetchPosition(id: string): Promise<Position> {
    try {
      const response = await this.fetchWithRetry<ApiResponse<ApiPosition>>(`/positions/${id}`);
      
      if (!response.success || !response.data) {
        throw new Error("Invalid position response");
      }

      return this.convertApiPositionToPosition(response.data);
    } catch (error) {
      console.error("[API_CLIENT] Error fetching position:", error);
      throw error;
    }
  }

  async fetchAlerts(filters?: {
    type?: string;
    severity?: string;
    positionId?: string;
    acknowledged?: boolean;
    limit?: number;
  }): Promise<Alert[]> {
    try {
      let endpoint = "/alerts";
      const params = new URLSearchParams();

      if (filters) {
        if (filters.type) params.append("type", filters.type);
        if (filters.severity) params.append("severity", filters.severity);
        if (filters.positionId) params.append("positionId", filters.positionId);
        if (filters.acknowledged !== undefined) params.append("acknowledged", String(filters.acknowledged));
        if (filters.limit) params.append("limit", String(filters.limit));
      }

      if (params.toString()) {
        endpoint += `?${params.toString()}`;
      }

      const response = await this.fetchWithRetry<ApiResponse<Alert[]>>(endpoint);
      
      if (!response.success || !response.data) {
        throw new Error("Invalid alerts response");
      }

      return response.data;
    } catch (error) {
      console.error("[API_CLIENT] Error fetching alerts:", error);
      throw error;
    }
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    try {
      const response = await this.fetchWithRetry<ApiResponse<void>>(`/alerts/${alertId}/acknowledge`, {
        method: "POST",
      });
      
      if (!response.success) {
        throw new Error("Failed to acknowledge alert");
      }
    } catch (error) {
      console.error("[API_CLIENT] Error acknowledging alert:", error);
      throw error;
    }
  }

  async createAlert(alert: Omit<Alert, "id" | "timestamp" | "acknowledged">): Promise<Alert> {
    try {
      const response = await this.fetchWithRetry<ApiResponse<Alert>>("/alerts", {
        method: "POST",
        body: JSON.stringify(alert),
      });
      
      if (!response.success || !response.data) {
        throw new Error("Invalid create alert response");
      }

      return response.data;
    } catch (error) {
      console.error("[API_CLIENT] Error creating alert:", error);
      throw error;
    }
  }

  async fetchPositionHistory(positionId: string, limit?: number): Promise<PositionChange[]> {
    try {
      let endpoint = `/positions/${positionId}/history`;
      if (limit) {
        endpoint += `?limit=${limit}`;
      }

      const response = await this.fetchWithRetry<ApiResponse<PositionChange[]>>(endpoint);
      
      if (!response.success || !response.data) {
        throw new Error("Invalid position history response");
      }

      return response.data.map(change => ({
        ...change,
        position: this.convertApiPositionToPosition(change.position as any),
        previousPosition: change.previousPosition 
          ? this.convertApiPositionToPosition(change.previousPosition as any)
          : undefined,
      }));
    } catch (error) {
      console.error("[API_CLIENT] Error fetching position history:", error);
      throw error;
    }
  }

  setAuthToken(token: string): void {
    this.headers["Authorization"] = `Bearer ${token}`;
  }

  removeAuthToken(): void {
    delete this.headers["Authorization"];
  }

  updateConfig(config: Partial<ApiClientConfig>): void {
    if (config.baseURL) {
      this.baseURL = config.baseURL.replace(/\/$/, "");
    }
    if (config.timeout) {
      this.timeout = config.timeout;
    }
    if (config.headers) {
      this.headers = { ...this.headers, ...config.headers };
    }
    if (config.retries !== undefined) {
      this.retries = config.retries;
    }
    if (config.retryDelay !== undefined) {
      this.retryDelay = config.retryDelay;
    }
  }
}

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  return new ApiClient(config);
};
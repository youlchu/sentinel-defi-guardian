import axios from 'axios';

const JUPITER_PRICE_API = 'https://price.jup.ag/v4';
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';

export interface TokenPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
  timeTaken?: number;
}

export interface PriceResponse {
  data: { [key: string]: TokenPrice };
  timeTaken: number;
}

export interface SwapQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: null;
  priceImpactPct: string;
  routePlan: RoutePlan[];
  contextSlot: number;
  timeTaken: number;
}

export interface RoutePlan {
  swapInfo: SwapInfo;
  percent: number;
}

export interface SwapInfo {
  ammKey: string;
  label: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  feeAmount: string;
  feeMint: string;
}

export interface PriceImpact {
  percentage: number;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  estimatedSlippage: number;
}

export interface RebalanceRoute {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  expectedOutput: string;
  priceImpact: PriceImpact;
  route: SwapQuote;
  priority: number;
}

export interface OptimalRebalanceStrategy {
  routes: RebalanceRoute[];
  totalPriceImpact: number;
  estimatedGasFeesSOL: number;
  expectedExecutionTime: number;
  riskLevel: 'low' | 'medium' | 'high';
}

// Common Solana token mints
export const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  mSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  stSOL: '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

export class JupiterPriceFeed {
  private cache: Map<string, { price: TokenPrice; timestamp: number }> = new Map();
  private cacheTtl: number = 10000; // 10 seconds

  async getPrice(mint: string): Promise<TokenPrice | null> {
    // Check cache
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.price;
    }

    try {
      const response = await axios.get<PriceResponse>(`${JUPITER_PRICE_API}/price`, {
        params: { ids: mint }
      });

      const priceData = response.data.data[mint];
      if (priceData) {
        this.cache.set(mint, { price: priceData, timestamp: Date.now() });
        return priceData;
      }
    } catch (error) {
      console.error(`[JUPITER] Error fetching price for ${mint}:`, error);
    }

    return null;
  }

  async getPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();

    // Split into cached and uncached
    const uncached: string[] = [];
    for (const mint of mints) {
      const cached = this.cache.get(mint);
      if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
        result.set(mint, cached.price);
      } else {
        uncached.push(mint);
      }
    }

    // Fetch uncached
    if (uncached.length > 0) {
      try {
        const response = await axios.get<PriceResponse>(`${JUPITER_PRICE_API}/price`, {
          params: { ids: uncached.join(',') }
        });

        for (const [mint, priceData] of Object.entries(response.data.data)) {
          this.cache.set(mint, { price: priceData, timestamp: Date.now() });
          result.set(mint, priceData);
        }
      } catch (error) {
        console.error('[JUPITER] Error fetching prices:', error);
      }
    }

    return result;
  }

  async getSolPrice(): Promise<number> {
    const price = await this.getPrice(TOKENS.SOL);
    return price?.price || 0;
  }

  async getSwapQuote(
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageBps: number = 50
  ): Promise<SwapQuote | null> {
    try {
      const response = await axios.get(`${JUPITER_QUOTE_API}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps,
          onlyDirectRoutes: false,
          asLegacyTransaction: false
        }
      });

      return response.data as SwapQuote;
    } catch (error) {
      console.error(`[JUPITER] Error fetching swap quote:`, error);
      return null;
    }
  }

  calculatePriceImpact(quote: SwapQuote): PriceImpact {
    const impactPct = parseFloat(quote.priceImpactPct);
    
    let severity: 'low' | 'medium' | 'high' | 'extreme';
    if (impactPct <= 0.1) severity = 'low';
    else if (impactPct <= 0.5) severity = 'medium';
    else if (impactPct <= 2.0) severity = 'high';
    else severity = 'extreme';

    return {
      percentage: impactPct,
      severity,
      estimatedSlippage: quote.slippageBps / 100
    };
  }

  async findOptimalRebalanceRoutes(
    rebalances: Array<{ from: string; to: string; amount: string; priority: number }>
  ): Promise<OptimalRebalanceStrategy> {
    const routes: RebalanceRoute[] = [];
    let totalPriceImpact = 0;

    // Sort by priority (higher first)
    const sortedRebalances = rebalances.sort((a, b) => b.priority - a.priority);

    for (const rebalance of sortedRebalances) {
      const quote = await this.getSwapQuote(
        rebalance.from,
        rebalance.to,
        rebalance.amount,
        100 // 1% slippage for emergency rebalancing
      );

      if (quote) {
        const priceImpact = this.calculatePriceImpact(quote);
        
        const route: RebalanceRoute = {
          inputToken: rebalance.from,
          outputToken: rebalance.to,
          inputAmount: rebalance.amount,
          expectedOutput: quote.outAmount,
          priceImpact,
          route: quote,
          priority: rebalance.priority
        };

        routes.push(route);
        totalPriceImpact += priceImpact.percentage;
      }
    }

    // Estimate gas fees (average 0.001 SOL per swap)
    const estimatedGasFeesSOL = routes.length * 0.001;

    // Estimate execution time (2 seconds per swap + network delays)
    const expectedExecutionTime = routes.length * 2.5;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high';
    if (totalPriceImpact <= 0.5) riskLevel = 'low';
    else if (totalPriceImpact <= 2.0) riskLevel = 'medium';
    else riskLevel = 'high';

    return {
      routes,
      totalPriceImpact,
      estimatedGasFeesSOL,
      expectedExecutionTime,
      riskLevel
    };
  }

  async getEmergencyRebalanceStrategy(
    currentPositions: Map<string, number>,
    targetPositions: Map<string, number>,
    emergencyThreshold: number = 5.0 // 5% max price impact per swap
  ): Promise<OptimalRebalanceStrategy> {
    const rebalances: Array<{ from: string; to: string; amount: string; priority: number }> = [];

    // Calculate required rebalances
    for (const [token, currentAmount] of currentPositions) {
      const targetAmount = targetPositions.get(token) || 0;
      const difference = currentAmount - targetAmount;

      if (Math.abs(difference) > 0.001) { // Ignore dust amounts
        if (difference > 0) {
          // Need to sell this token
          const sellAmount = Math.floor(difference * 1000000).toString(); // Convert to lamports/smallest unit
          
          // Find best token to buy
          for (const [targetToken, targetAmt] of targetPositions) {
            const currentTargetAmount = currentPositions.get(targetToken) || 0;
            if (currentTargetAmount < targetAmt) {
              rebalances.push({
                from: token,
                to: targetToken,
                amount: sellAmount,
                priority: Math.abs(difference) // Higher difference = higher priority
              });
              break;
            }
          }
        }
      }
    }

    // Filter routes by emergency threshold
    const strategy = await this.findOptimalRebalanceRoutes(rebalances);
    const filteredRoutes = strategy.routes.filter(route => 
      route.priceImpact.percentage <= emergencyThreshold
    );

    return {
      ...strategy,
      routes: filteredRoutes,
      totalPriceImpact: filteredRoutes.reduce((sum, route) => sum + route.priceImpact.percentage, 0)
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const jupiterPriceFeed = new JupiterPriceFeed();
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

export interface RouteAnalysis {
  route: SwapQuote;
  priceImpact: PriceImpact;
  liquidityScore: number;
  executionRisk: 'low' | 'medium' | 'high';
  alternativeRoutes?: SwapQuote[];
}

export interface MarketDepth {
  token: string;
  bidDepth: number;
  askDepth: number;
  spread: number;
  liquidityTier: 'high' | 'medium' | 'low';
}

export interface SwapRouteOptimization {
  originalRoute: SwapQuote;
  optimizedRoute: SwapQuote;
  improvement: {
    priceImpactReduction: number;
    outputIncrease: number;
    feeReduction: number;
  };
  splitStrategy?: {
    splits: Array<{
      percentage: number;
      route: SwapQuote;
      priceImpact: number;
    }>;
    combinedPriceImpact: number;
  };
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
  private routeCache: Map<string, { routes: SwapQuote[]; timestamp: number }> = new Map();
  private cacheTtl: number = 10000; // 10 seconds
  private routeCacheTtl: number = 5000; // 5 seconds for routes

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

  async getMultipleSwapQuotes(
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageOptions: number[] = [25, 50, 100, 300]
  ): Promise<SwapQuote[]> {
    const cacheKey = `${inputMint}-${outputMint}-${amount}`;
    const cached = this.routeCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.routeCacheTtl) {
      return cached.routes;
    }

    const quotes: SwapQuote[] = [];
    
    try {
      const requests = slippageOptions.map(slippage => 
        this.getSwapQuote(inputMint, outputMint, amount, slippage)
      );
      
      const results = await Promise.allSettled(requests);
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          quotes.push(result.value);
        }
      }

      this.routeCache.set(cacheKey, { routes: quotes, timestamp: Date.now() });
    } catch (error) {
      console.error('[JUPITER] Error fetching multiple quotes:', error);
    }

    return quotes;
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

  calculateLiquidityScore(quote: SwapQuote): number {
    let score = 100;
    const priceImpact = parseFloat(quote.priceImpactPct);
    const routeCount = quote.routePlan.length;
    
    // Penalize high price impact
    score -= priceImpact * 10;
    
    // Prefer fewer route splits for simplicity
    score -= (routeCount - 1) * 5;
    
    // Bonus for well-known AMMs
    const wellKnownAmms = ['Raydium', 'Orca', 'Jupiter', 'Meteora'];
    const hasWellKnownAmm = quote.routePlan.some(plan => 
      wellKnownAmms.some(amm => plan.swapInfo.label.includes(amm))
    );
    
    if (hasWellKnownAmm) score += 10;
    
    return Math.max(0, Math.min(100, score));
  }

  async analyzeRoute(
    inputMint: string,
    outputMint: string,
    amount: string
  ): Promise<RouteAnalysis> {
    const quotes = await this.getMultipleSwapQuotes(inputMint, outputMint, amount);
    
    if (quotes.length === 0) {
      throw new Error('No routes found');
    }

    // Select best quote based on output amount and price impact
    const bestQuote = quotes.reduce((best, current) => {
      const currentOutput = parseFloat(current.outAmount);
      const bestOutput = parseFloat(best.outAmount);
      const currentImpact = parseFloat(current.priceImpactPct);
      const bestImpact = parseFloat(best.priceImpactPct);
      
      // Prefer higher output with similar or better price impact
      if (currentOutput > bestOutput && currentImpact <= bestImpact * 1.1) {
        return current;
      }
      
      return best;
    });

    const priceImpact = this.calculatePriceImpact(bestQuote);
    const liquidityScore = this.calculateLiquidityScore(bestQuote);
    
    let executionRisk: 'low' | 'medium' | 'high';
    if (priceImpact.severity === 'low' && liquidityScore >= 70) {
      executionRisk = 'low';
    } else if (priceImpact.severity === 'medium' || liquidityScore >= 40) {
      executionRisk = 'medium';
    } else {
      executionRisk = 'high';
    }

    return {
      route: bestQuote,
      priceImpact,
      liquidityScore,
      executionRisk,
      alternativeRoutes: quotes.filter(q => q !== bestQuote)
    };
  }

  async optimizeSwapRoute(
    inputMint: string,
    outputMint: string,
    amount: string,
    maxSplits: number = 3
  ): Promise<SwapRouteOptimization> {
    const originalQuote = await this.getSwapQuote(inputMint, outputMint, amount);
    if (!originalQuote) {
      throw new Error('Could not get original quote');
    }

    // Try different slippage settings for optimization
    const optimizedQuotes = await this.getMultipleSwapQuotes(
      inputMint, outputMint, amount, [10, 25, 50, 100]
    );

    const bestOptimized = optimizedQuotes.reduce((best, current) => {
      const currentOutput = parseFloat(current.outAmount);
      const bestOutput = parseFloat(best.outAmount);
      return currentOutput > bestOutput ? current : best;
    }, optimizedQuotes[0] || originalQuote);

    const originalOutput = parseFloat(originalQuote.outAmount);
    const optimizedOutput = parseFloat(bestOptimized.outAmount);
    const originalImpact = parseFloat(originalQuote.priceImpactPct);
    const optimizedImpact = parseFloat(bestOptimized.priceImpactPct);

    // Try split strategy for large trades
    let splitStrategy;
    const inputAmount = parseFloat(amount);
    
    if (inputAmount > 1000000 && originalImpact > 0.5) { // Large trade with significant impact
      const splitSizes = [0.4, 0.35, 0.25]; // Split into 3 parts
      const splits = [];
      
      for (const percentage of splitSizes) {
        const splitAmount = Math.floor(inputAmount * percentage).toString();
        const splitQuote = await this.getSwapQuote(inputMint, outputMint, splitAmount, 50);
        
        if (splitQuote) {
          splits.push({
            percentage,
            route: splitQuote,
            priceImpact: parseFloat(splitQuote.priceImpactPct)
          });
        }
      }

      if (splits.length > 0) {
        const combinedPriceImpact = splits.reduce((sum, split) => 
          sum + (split.priceImpact * split.percentage), 0
        );

        splitStrategy = {
          splits,
          combinedPriceImpact
        };
      }
    }

    return {
      originalRoute: originalQuote,
      optimizedRoute: bestOptimized,
      improvement: {
        priceImpactReduction: originalImpact - optimizedImpact,
        outputIncrease: optimizedOutput - originalOutput,
        feeReduction: 0 // Would need fee calculation
      },
      splitStrategy
    };
  }

  async getMarketDepth(tokens: string[]): Promise<Map<string, MarketDepth>> {
    const depths = new Map<string, MarketDepth>();
    
    for (const token of tokens) {
      try {
        // Sample small and large trades to estimate depth
        const smallAmount = '1000000'; // 1M smallest units
        const largeAmount = '100000000'; // 100M smallest units
        
        const [smallQuote, largeQuote] = await Promise.all([
          this.getSwapQuote(TOKENS.USDC, token, smallAmount),
          this.getSwapQuote(TOKENS.USDC, token, largeAmount)
        ]);

        if (smallQuote && largeQuote) {
          const smallImpact = parseFloat(smallQuote.priceImpactPct);
          const largeImpact = parseFloat(largeQuote.priceImpactPct);
          
          const spread = largeImpact - smallImpact;
          let liquidityTier: 'high' | 'medium' | 'low';
          
          if (largeImpact < 0.5) liquidityTier = 'high';
          else if (largeImpact < 2.0) liquidityTier = 'medium';
          else liquidityTier = 'low';

          depths.set(token, {
            token,
            bidDepth: parseFloat(largeQuote.outAmount),
            askDepth: parseFloat(largeQuote.outAmount),
            spread,
            liquidityTier
          });
        }
      } catch (error) {
        console.error(`Error analyzing market depth for ${token}:`, error);
      }
    }

    return depths;
  }

  async findOptimalRebalanceRoutes(
    rebalances: Array<{ from: string; to: string; amount: string; priority: number }>
  ): Promise<OptimalRebalanceStrategy> {
    const routes: RebalanceRoute[] = [];
    let totalPriceImpact = 0;

    // Sort by priority (higher first)
    const sortedRebalances = rebalances.sort((a, b) => b.priority - a.priority);

    // Analyze all routes in parallel for better optimization
    const routePromises = sortedRebalances.map(async (rebalance) => {
      const optimization = await this.optimizeSwapRoute(
        rebalance.from,
        rebalance.to,
        rebalance.amount
      );

      const bestRoute = optimization.optimizedRoute;
      const priceImpact = this.calculatePriceImpact(bestRoute);
      
      return {
        inputToken: rebalance.from,
        outputToken: rebalance.to,
        inputAmount: rebalance.amount,
        expectedOutput: bestRoute.outAmount,
        priceImpact,
        route: bestRoute,
        priority: rebalance.priority
      };
    });

    const resolvedRoutes = await Promise.allSettled(routePromises);
    
    for (const result of resolvedRoutes) {
      if (result.status === 'fulfilled') {
        routes.push(result.value);
        totalPriceImpact += result.value.priceImpact.percentage;
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

    // Get market depth for all tokens
    const allTokens = [...new Set([...currentPositions.keys(), ...targetPositions.keys()])];
    const marketDepths = await this.getMarketDepth(allTokens);

    // Calculate required rebalances with market depth consideration
    for (const [token, currentAmount] of currentPositions) {
      const targetAmount = targetPositions.get(token) || 0;
      const difference = currentAmount - targetAmount;

      if (Math.abs(difference) > 0.001) { // Ignore dust amounts
        if (difference > 0) {
          // Need to sell this token
          const sellAmount = Math.floor(difference * 1000000).toString(); // Convert to lamports/smallest unit
          
          // Find best token to buy based on market depth and target needs
          const buyOpportunities = Array.from(targetPositions.entries())
            .filter(([targetToken, targetAmt]) => {
              const currentTargetAmount = currentPositions.get(targetToken) || 0;
              return currentTargetAmount < targetAmt;
            })
            .map(([targetToken, targetAmt]) => {
              const currentTargetAmount = currentPositions.get(targetToken) || 0;
              const need = targetAmt - currentTargetAmount;
              const depth = marketDepths.get(targetToken);
              const liquidityScore = depth ? (depth.liquidityTier === 'high' ? 3 : depth.liquidityTier === 'medium' ? 2 : 1) : 1;
              
              return {
                token: targetToken,
                need,
                liquidityScore,
                priority: need * liquidityScore
              };
            })
            .sort((a, b) => b.priority - a.priority);

          if (buyOpportunities.length > 0) {
            const bestBuy = buyOpportunities[0];
            rebalances.push({
              from: token,
              to: bestBuy.token,
              amount: sellAmount,
              priority: Math.abs(difference) * bestBuy.liquidityScore
            });
          }
        }
      }
    }

    // Filter routes by emergency threshold and optimize
    const strategy = await this.findOptimalRebalanceRoutes(rebalances);
    const filteredRoutes = strategy.routes.filter(route => 
      route.priceImpact.percentage <= emergencyThreshold
    );

    // Re-calculate metrics for filtered routes
    const filteredTotalImpact = filteredRoutes.reduce((sum, route) => sum + route.priceImpact.percentage, 0);
    
    let adjustedRiskLevel: 'low' | 'medium' | 'high';
    if (filteredTotalImpact <= 1.0) adjustedRiskLevel = 'low';
    else if (filteredTotalImpact <= 3.0) adjustedRiskLevel = 'medium';
    else adjustedRiskLevel = 'high';

    return {
      routes: filteredRoutes,
      totalPriceImpact: filteredTotalImpact,
      estimatedGasFeesSOL: filteredRoutes.length * 0.001,
      expectedExecutionTime: filteredRoutes.length * 2.5,
      riskLevel: adjustedRiskLevel
    };
  }

  clearCache(): void {
    this.cache.clear();
    this.routeCache.clear();
  }
}

export const jupiterPriceFeed = new JupiterPriceFeed();
```typescript
import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';

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

export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: null | any;
  priceImpactPct: string;
  routePlan: RoutePlan[];
}

export interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface RebalanceRoute {
  fromMint: string;
  toMint: string;
  amount: string;
  expectedOutput: string;
  priceImpact: number;
  routes: RoutePlan[];
  slippageBps: number;
  fee: string;
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
  private quoteCache: Map<string, { quote: QuoteResponse; timestamp: number }> = new Map();
  private cacheTtl: number = 10000; // 10 seconds
  private quoteCacheTtl: number = 5000; // 5 seconds for quotes

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

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageBps: number = 50
  ): Promise<QuoteResponse | null> {
    const cacheKey = `${inputMint}-${outputMint}-${amount}-${slippageBps}`;
    const cached = this.quoteCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.quoteCacheTtl) {
      return cached.quote;
    }

    try {
      const response = await axios.get<QuoteResponse>(`${JUPITER_QUOTE_API}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps,
          onlyDirectRoutes: false,
          asLegacyTransaction: false
        }
      });

      this.quoteCache.set(cacheKey, { quote: response.data, timestamp: Date.now() });
      return response.data;
    } catch (error) {
      console.error('[JUPITER] Error fetching quote:', error);
      return null;
    }
  }

  async calculatePriceImpact(
    inputMint: string,
    outputMint: string,
    amount: string
  ): Promise<number> {
    const quote = await this.getQuote(inputMint, outputMint, amount);
    if (!quote) return 0;

    return parseFloat(quote.priceImpactPct);
  }

  async findOptimalRebalanceRoute(
    fromMint: string,
    toMint: string,
    amount: string,
    maxSlippageBps: number = 100,
    maxPriceImpact: number = 2.0
  ): Promise<RebalanceRoute | null> {
    // Try different slippage tolerances to find optimal route
    const slippageOptions = [50, 100, 150, 200];
    let bestRoute: RebalanceRoute | null = null;
    let bestScore = -1;

    for (const slippageBps of slippageOptions) {
      if (slippageBps > maxSlippageBps) continue;

      const quote = await this.getQuote(fromMint, toMint, amount, slippageBps);
      if (!quote) continue;

      const priceImpact = parseFloat(quote.priceImpactPct);
      if (priceImpact > maxPriceImpact) continue;

      // Score based on output amount (higher is better) and lower price impact
      const outputAmount = parseFloat(quote.outAmount);
      const score = outputAmount / (1 + priceImpact / 100);
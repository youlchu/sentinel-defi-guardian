import axios from 'axios';

const JUPITER_PRICE_API = 'https://price.jup.ag/v4';

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

  clearCache(): void {
    this.cache.clear();
  }
}

export const jupiterPriceFeed = new JupiterPriceFeed();

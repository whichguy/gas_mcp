import { QuotaError } from '../errors/mcpErrors.js';

/**
 * Token Bucket Rate Limiter for Google Apps Script API
 * Implements 100 requests per 100 seconds limit with buffer
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity = 90; // Buffer below 100 limit
  private readonly refillRate = 0.9; // 90 tokens per 100 seconds
  private lastRefill = Date.now();

  constructor() {
    this.tokens = this.capacity; // Start with full bucket
  }

  /**
   * Check if request is allowed, throw QuotaError if not
   */
  async checkLimit(): Promise<void> {
    this.refillTokens();
    
    if (this.tokens < 1) {
      const waitTime = Math.ceil((1 - this.tokens) / this.refillRate * 1000);
      throw new QuotaError(
        'Google Apps Script API rate limit exceeded',
        Math.ceil(waitTime / 1000)
      );
    }
    
    this.tokens -= 1;
  }

  /**
   * Get current token count (for monitoring)
   */
  getTokenCount(): number {
    this.refillTokens();
    return Math.floor(this.tokens);
  }

  /**
   * Reset bucket to full capacity (for testing)
   */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Global rate limiter instance
 */
export const rateLimiter = new TokenBucketRateLimiter(); 
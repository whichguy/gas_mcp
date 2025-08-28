import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { TokenBucketRateLimiter } from '../../../src/api/rateLimiter.js';
import { QuotaError } from '../../../src/errors/mcpErrors.js';

describe('TokenBucketRateLimiter', () => {
  let rateLimiter: TokenBucketRateLimiter;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: Date.now() });
    rateLimiter = new TokenBucketRateLimiter();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('initialization', () => {
    it('should start with full capacity', () => {
      expect(rateLimiter.getTokenCount()).to.equal(90);
    });

    it('should allow initial requests', async () => {
      // Should not throw
      await rateLimiter.checkLimit();
      expect(rateLimiter.getTokenCount()).to.equal(89);
    });
  });

  describe('rate limiting', () => {
    it('should consume tokens on each request', async () => {
      const initialTokens = rateLimiter.getTokenCount();
      
      await rateLimiter.checkLimit();
      expect(rateLimiter.getTokenCount()).to.equal(initialTokens - 1);
      
      await rateLimiter.checkLimit();
      expect(rateLimiter.getTokenCount()).to.equal(initialTokens - 2);
    });

    it('should throw QuotaError when tokens exhausted', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 90; i++) {
        await rateLimiter.checkLimit();
      }

      try {
        await rateLimiter.checkLimit();
        expect.fail('Should have thrown QuotaError');
      } catch (error) {
        expect(error).to.be.instanceOf(QuotaError);
        expect((error as QuotaError).message).to.include('rate limit exceeded');
        const data = (error as QuotaError).data as any;
        expect(data.retryAfterSeconds).to.be.a('number');
        expect(data.retryAfterSeconds).to.be.greaterThan(0);
      }
    });

    it('should provide correct retry time when rate limited', async () => {
      // Exhaust tokens
      for (let i = 0; i < 90; i++) {
        await rateLimiter.checkLimit();
      }

      try {
        await rateLimiter.checkLimit();
        expect.fail('Should have thrown QuotaError');
      } catch (error) {
        const data = (error as QuotaError).data as any;
        expect(data.retryAfterSeconds).to.be.approximately(1, 1); // Should be around 1 second
      }
    });
  });

  describe('token refill', () => {
    it('should refill tokens over time', async () => {
      // Use a small number of tokens
      await rateLimiter.checkLimit();
      await rateLimiter.checkLimit();
      const tokensAfterUse = rateLimiter.getTokenCount();
      expect(tokensAfterUse).to.equal(88);

      // Advance time
      await clock.tickAsync(2000);

      const tokensAfterWait = rateLimiter.getTokenCount();
      // Tokens should have increased due to refill
      expect(tokensAfterWait).to.be.greaterThan(tokensAfterUse);
    });

    it('should not exceed capacity when refilling', async () => {
      // Reset to full capacity
      rateLimiter.reset();
      await clock.tickAsync(5000); // Advance time
      
      // Even after time passes, should not exceed 90 tokens
      const tokens = rateLimiter.getTokenCount();
      expect(tokens).to.equal(90);
      expect(tokens).to.be.at.most(90);
    });

    it('should have correct refill rate', async () => {
      // Refill rate should be 0.9 tokens per second (90 per 100 seconds)
      rateLimiter.reset();
      
      // Use several tokens to make the test more reliable
      await rateLimiter.checkLimit();
      await rateLimiter.checkLimit();
      await rateLimiter.checkLimit();
      const tokensAfterUse = rateLimiter.getTokenCount();
      expect(tokensAfterUse).to.equal(87); // Should be 90 - 3
        
      // Wait longer to ensure we get at least 1 full token refill
      // At 0.9 tokens/second, need ~1.11 seconds for 1 token
      await clock.tickAsync(2000); // 2 seconds should give us 1.8 tokens
      
      const tokensAfterRefill = rateLimiter.getTokenCount();
      const tokensAdded = tokensAfterRefill - tokensAfterUse;
      
      // Should have added approximately 1-2 tokens in 2 seconds
      // (0.9 tokens/sec * 2 sec = 1.8 tokens, floored to 1)
      expect(tokensAdded).to.be.at.least(1);
      expect(tokensAdded).to.be.at.most(2);
    });
  });

  describe('reset functionality', () => {
    it('should reset to full capacity', async () => {
      // Use some tokens
      await rateLimiter.checkLimit();
      await rateLimiter.checkLimit();
      expect(rateLimiter.getTokenCount()).to.equal(88);

      // Reset
      rateLimiter.reset();
      expect(rateLimiter.getTokenCount()).to.equal(90);
    });

    it('should allow requests after reset', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 90; i++) {
        await rateLimiter.checkLimit();
      }

      // Should be rate limited
      try {
        await rateLimiter.checkLimit();
        expect.fail('Should have thrown QuotaError');
      } catch (error) {
        expect(error).to.be.instanceOf(QuotaError);
      }

      // Reset and try again
      rateLimiter.reset();
      await rateLimiter.checkLimit(); // Should not throw
      expect(rateLimiter.getTokenCount()).to.equal(89);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid consecutive requests', async () => {
      const promises: Promise<void>[] = [];
      
      // Fire 85 requests rapidly (within capacity)
      for (let i = 0; i < 85; i++) {
        promises.push(rateLimiter.checkLimit());
      }

      // All should succeed
      await Promise.all(promises);
      expect(rateLimiter.getTokenCount()).to.equal(5);
    });

    it('should handle fractional token consumption', async () => {
      // The rate limiter should handle the math correctly even with floating point
      const initialTokens = rateLimiter.getTokenCount();
      expect(initialTokens).to.be.a('number');
      expect(Number.isInteger(initialTokens)).to.be.true;
    });
  });

  describe('configuration compliance', () => {
    it('should respect Google Apps Script API limits', () => {
      // Capacity should be 90 (buffer below 100)
      rateLimiter.reset();
      expect(rateLimiter.getTokenCount()).to.equal(90);
    });
  });

  describe('error message quality', () => {
    it('should provide helpful error messages', async () => {
      // Exhaust tokens
      for (let i = 0; i < 90; i++) {
        await rateLimiter.checkLimit();
      }

      try {
        await rateLimiter.checkLimit();
        expect.fail('Should have thrown QuotaError');
      } catch (error) {
        expect(error).to.be.instanceOf(QuotaError);
        expect((error as QuotaError).message).to.include('Google Apps Script API');
        expect((error as QuotaError).message).to.include('rate limit');
        
        const data = (error as QuotaError).data as any;
        expect(data.rateLimited).to.be.true;
        expect(data.retryAfterSeconds).to.be.a('number');
      }
    });
  });

  describe('global instance', () => {
    it('should export a global rate limiter instance', async () => {
      const { rateLimiter: globalRateLimiter } = await import('../../../src/api/rateLimiter.js');
      
      expect(globalRateLimiter).to.be.instanceOf(TokenBucketRateLimiter);
      expect(globalRateLimiter.getTokenCount()).to.be.a('number');
    });
  });
}); 
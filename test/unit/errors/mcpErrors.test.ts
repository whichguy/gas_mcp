import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  MCPGasError,
  AuthenticationError,
  ValidationError,
  QuotaError,
  GASApiError,
  OAuthError,
  FileOperationError
} from '../../../src/errors/mcpErrors.js';

describe('MCP Gas Error Classes', () => {
  describe('MCPGasError', () => {
    it('should create base error with correct properties', () => {
      const error = new MCPGasError('Test message', -32000, { extra: 'data' });
      
      expect(error.message).to.equal('Test message');
      expect(error.code).to.equal(-32000);
      expect(error.data).to.deep.equal({ extra: 'data' });
      expect(error.name).to.equal('MCPGasError');
    });

    it('should work without additional data', () => {
      const error = new MCPGasError('Test message', -32000);
      
      expect(error.message).to.equal('Test message');
      expect(error.data).to.be.undefined;
    });
  });

  describe('AuthenticationError', () => {
    it('should create authentication error with auth URL', () => {
      const authUrl = 'https://accounts.google.com/oauth/authorize?...';
      const error = new AuthenticationError('Not authenticated', authUrl);
      const data = error.data as any;
      
      expect(error.message).to.equal('Not authenticated');
      expect(data.requiresAuth).to.be.true;
      expect(data.authUrl).to.equal(authUrl);
      expect(data.instructions).to.include('auth(mode="start")');
    });

    it('should work without auth URL', () => {
      const error = new AuthenticationError('Token expired');
      const data = error.data as any;
      
      expect(error.message).to.equal('Token expired');
      expect(data.requiresAuth).to.be.true;
      expect(data.authUrl).to.be.undefined;
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with field information', () => {
      const error = new ValidationError('projectId', 'invalid-id', 'valid project ID');
      const data = error.data as any;
      
      expect(error.message).to.include('Invalid projectId');
      expect(error.message).to.include('expected valid project ID');
      expect(error.message).to.include('"invalid-id"');
      expect(data.field).to.equal('projectId');
      expect(data.value).to.equal('invalid-id');
      expect(data.expected).to.equal('valid project ID');
    });

    it('should handle complex values in validation', () => {
      const complexValue = { nested: { data: 'test' } };
      const error = new ValidationError('config', complexValue, 'simple string');
      const data = error.data as any;
      
      expect(error.message).to.include(JSON.stringify(complexValue));
      expect(data.value).to.deep.equal(complexValue);
    });
  });

  describe('QuotaError', () => {
    it('should create quota error with retry time', () => {
      const error = new QuotaError('Rate limit exceeded', 60);
      const data = error.data as any;
      
      expect(error.message).to.equal('Rate limit exceeded');
      expect(data.retryAfterSeconds).to.equal(60);
      expect(data.rateLimited).to.be.true;
    });

    it('should work without retry time', () => {
      const error = new QuotaError('Quota exceeded');
      const data = error.data as any;
      
      expect(error.message).to.equal('Quota exceeded');
      expect(data.retryAfterSeconds).to.be.undefined;
      expect(data.rateLimited).to.be.true;
    });
  });

  describe('GASApiError', () => {
    it('should create API error with status code and original error', () => {
      const originalError = new Error('Original API error');
      const error = new GASApiError('API call failed', 403, originalError);
      const data = error.data as any;
      
      expect(error.message).to.equal('API call failed');
      expect(data.statusCode).to.equal(403);
      expect(data.originalError).to.equal('Original API error');
    });

    it('should handle non-Error original errors', () => {
      const originalError = { message: 'String error', code: 'ERR_CODE' };
      const error = new GASApiError('API call failed', 500, originalError);
      const data = error.data as any;
      
      expect(data.originalError).to.deep.equal(originalError);
    });
  });

  describe('OAuthError', () => {
    it('should create OAuth error for authorization phase', () => {
      const error = new OAuthError('Failed to get auth URL', 'authorization');
      const data = error.data as any;
      
      expect(error.message).to.equal('Failed to get auth URL');
      expect(data.phase).to.equal('authorization');
      expect(data.instructions).to.include('auth(mode="start")');
    });

    it('should create OAuth error for token exchange phase', () => {
      const error = new OAuthError('Invalid authorization code', 'token_exchange');
      const data = error.data as any;
      
      expect(error.message).to.equal('Invalid authorization code');
      expect(data.phase).to.equal('token_exchange');
      expect(data.instructions).to.include('auth(mode="logout")');
    });

    it('should handle all OAuth phases', () => {
      const phases: Array<'authorization' | 'token_exchange' | 'token_refresh' | 'validation'> = [
        'authorization', 'token_exchange', 'token_refresh', 'validation'
      ];

      phases.forEach(phase => {
        const error = new OAuthError(`Error in ${phase}`, phase);
        const data = error.data as any;
        expect(data.phase).to.equal(phase);
        expect(data.instructions).to.be.a('string');
      });
    });
  });

  describe('FileOperationError', () => {
    it('should create file operation error with context', () => {
      const error = new FileOperationError('read', 'project/file.gs', 'file not found');
      const data = error.data as any;
      
      expect(error.message).to.equal('Cannot read project/file.gs: file not found');
      expect(data.operation).to.equal('read');
      expect(data.path).to.equal('project/file.gs');
      expect(data.reason).to.equal('file not found');
    });

    it('should work with different operations', () => {
      const operations = ['write', 'delete', 'move', 'copy'];
      
      operations.forEach(operation => {
        const error = new FileOperationError(operation, 'test/path', 'test reason');
        const data = error.data as any;
        expect(data.operation).to.equal(operation);
        expect(error.message).to.include(`Cannot ${operation}`);
      });
    });
  });

  describe('Error inheritance', () => {
    it('should maintain proper inheritance chain', () => {
      const errors = [
        new AuthenticationError('test'),
        new ValidationError('field', 'value', 'expected'),
        new QuotaError('test'),
        new GASApiError('test'),
        new OAuthError('test', 'authorization'),
        new FileOperationError('test', 'path', 'reason')
      ];

      errors.forEach(error => {
        expect(error).to.be.instanceOf(MCPGasError);
        expect(error).to.be.instanceOf(Error);
        expect(error.name).to.equal(error.constructor.name);
      });
    });
  });
}); 
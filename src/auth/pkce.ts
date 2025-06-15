/**
 * PKCE (Proof Key for Code Exchange) Utility
 * 
 * Implements RFC 7636 for secure OAuth flows in desktop applications.
 * Replaces client_secret with dynamically generated code_verifier/code_challenge pairs.
 */

import { randomBytes, createHash } from 'crypto';

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/**
 * PKCE generator for desktop OAuth flows
 */
export class PKCEGenerator {
  /**
   * Generate a cryptographically secure code verifier
   * Must be 43-128 characters, URL-safe without padding
   */
  static generateCodeVerifier(): string {
    // Generate 96 random bytes -> 128 character base64url string
    return randomBytes(96).toString('base64url');
  }

  /**
   * Generate code challenge from verifier using SHA256
   * Per RFC 7636: code_challenge = BASE64URL(SHA256(code_verifier))
   */
  static generateCodeChallenge(codeVerifier: string): string {
    return createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
  }

  /**
   * Generate complete PKCE challenge pair
   */
  static generateChallenge(): PKCEChallenge {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    
    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256'
    };
  }

  /**
   * Validate code verifier format
   */
  static isValidCodeVerifier(verifier: string): boolean {
    // Must be 43-128 characters, URL-safe base64 without padding
    const validLength = verifier.length >= 43 && verifier.length <= 128;
    const validChars = /^[A-Za-z0-9\-._~]+$/.test(verifier);
    return validLength && validChars;
  }
} 
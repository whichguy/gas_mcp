import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * MCP Resource: gas://auth/status
 * Returns current auth state with tokens MASKED.
 */
export async function readAuthStatus(): Promise<string> {
  const manager = new SessionAuthManager();
  const status = await manager.getAuthStatus();

  return JSON.stringify({
    authenticated: status.authenticated,
    user: status.user,
    tokenValid: status.tokenValid,
    expiresIn: status.expiresIn
  }, null, 2);
}

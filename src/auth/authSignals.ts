/**
 * Authentication signal handlers
 * Separated from auth.ts to avoid circular dependency with oauthClient.ts
 */

interface AuthResolver {
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
}

// Global state for auth flow tracking
export const authCompletionResolvers = new Map<string, AuthResolver>();
export const resolverStates = new Map<string, 'pending' | 'resolved' | 'rejected'>();

/**
 * Signal authentication completion with state protection
 * RACE CONDITION FIX: Prevents duplicate completion signals
 */
export function signalAuthCompletion(authKey: string, result: any): void {
  // ATOMIC STATE CHECK - prevent duplicate signals
  const currentState = resolverStates.get(authKey);
  if (currentState && currentState !== 'pending') {
    console.error(`⚠️ Ignoring duplicate completion for ${authKey} (state: ${currentState})`);
    return;
  }

  const resolver = authCompletionResolvers.get(authKey);
  if (resolver) {
    console.error(`🎯 Signaling auth completion for ${authKey}:`, result.status);

    // ATOMIC STATE TRANSITION
    resolverStates.set(authKey, 'resolved');
    clearTimeout(resolver.timeout);
    authCompletionResolvers.delete(authKey);
    resolverStates.delete(authKey); // Cleanup state tracking

    resolver.resolve(result);
  }
}

/**
 * Signal authentication error with state protection
 * RACE CONDITION FIX: Prevents duplicate error signals
 */
export function signalAuthError(authKey: string, error: any): void {
  // ATOMIC STATE CHECK - prevent duplicate signals
  const currentState = resolverStates.get(authKey);
  if (currentState && currentState !== 'pending') {
    console.error(`⚠️ Ignoring duplicate error for ${authKey} (state: ${currentState})`);
    return;
  }

  const resolver = authCompletionResolvers.get(authKey);
  if (resolver) {
    console.error(`❌ Signaling auth error for ${authKey}:`, error.message);

    // ATOMIC STATE TRANSITION
    resolverStates.set(authKey, 'rejected');
    clearTimeout(resolver.timeout);
    authCompletionResolvers.delete(authKey);
    resolverStates.delete(authKey); // Cleanup state tracking

    resolver.reject(error);
  }
}

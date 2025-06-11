/**
 * Centralized authentication messages and instructions
 * Reduces duplication across the codebase
 */

export const AUTH_MESSAGES = {
  // Basic authentication instructions
  REQUIRED: 'Authentication required. Please authenticate first using: gas_auth(mode="start")',
  EXPIRED: 'Authentication expired or invalid. Please re-authenticate using: gas_auth(mode="start")',
  INVALID: 'Invalid authentication token. Please re-authenticate using: gas_auth(mode="start")',
  
  // Context-specific messages
  REQUIRED_FOR_OPERATION: (operation: string) => 
    `Authentication required for ${operation}. Please authenticate using: gas_auth(mode="start")`,
  EXPIRED_FOR_OPERATION: (operation: string) => 
    `Authentication expired during ${operation}. Token needs refresh. Please re-authenticate using: gas_auth(mode="start")`,
  INVALID_FOR_OPERATION: (operation: string) => 
    `Invalid authentication token for ${operation}. Please re-authenticate using: gas_auth(mode="start")`,
  PERMISSION_DENIED_FOR_OPERATION: (operation: string) => 
    `Insufficient permissions for ${operation}. Please check OAuth scopes and re-authenticate using: gas_auth(mode="start")`,
  
  // Tool-specific messages
  TOOL_REQUIRES_AUTH: 'This tool requires Google Apps Script API authentication. Use: gas_auth(mode="start")',
  PROXY_AUTH_REQUIRED: 'Authentication required - use gas_auth(mode="start")',
  
  // Instructions for error responses
  BASIC_INSTRUCTION: 'Use gas_auth tool to authenticate: gas_auth(mode="start")',
  START_FLOW_INSTRUCTION: 'Start authentication flow with gas_auth(mode="start")',
  REFRESH_INSTRUCTION: 'Re-authenticate with gas_auth(mode="logout") then gas_auth(mode="start")',
  
  // Server startup messages
  SERVER_AUTH_READY: '🚀 Use gas_auth(mode="start") to authenticate with Google Apps Script',
  
  // Auto-auth fallback instructions
  AUTO_AUTH_FALLBACK: [
    '🔑 Authentication required',
    '❌ Auto-authentication failed - please authenticate manually',
    '🚀 Use: gas_auth(mode="start") to authenticate',
    '📝 Then retry your original request'
  ],
  
  // Manual auth instructions
  MANUAL_AUTH_INSTRUCTIONS: [
    '🔑 Authentication required - OAuth flow has been automatically started',
    '🌐 Please complete authentication in the browser window that opened',
    '✅ Once authenticated, retry your original request',
    '💡 This auto-auth feature helps streamline the authentication process'
  ]
} as const;

/**
 * OAuth phase-specific instructions
 */
export const OAUTH_PHASE_INSTRUCTIONS = {
  authorization: AUTH_MESSAGES.START_FLOW_INSTRUCTION,
  token_exchange: AUTH_MESSAGES.REFRESH_INSTRUCTION,
  token_refresh: AUTH_MESSAGES.REFRESH_INSTRUCTION,
  validation: AUTH_MESSAGES.REFRESH_INSTRUCTION
} as const;

/**
 * Helper function to get auth instructions for a specific OAuth phase
 */
export function getOAuthInstructions(phase: keyof typeof OAUTH_PHASE_INSTRUCTIONS): string {
  return OAUTH_PHASE_INSTRUCTIONS[phase];
}

/**
 * Helper function to get contextual auth message
 */
export function getContextualAuthMessage(
  type: 'required' | 'expired' | 'invalid' | 'permission_denied',
  operation?: string
): string {
  if (!operation) {
    switch (type) {
      case 'required': return AUTH_MESSAGES.REQUIRED;
      case 'expired': return AUTH_MESSAGES.EXPIRED;
      case 'invalid': return AUTH_MESSAGES.INVALID;
      case 'permission_denied': return AUTH_MESSAGES.INVALID;
    }
  }
  
  switch (type) {
    case 'required': return AUTH_MESSAGES.REQUIRED_FOR_OPERATION(operation);
    case 'expired': return AUTH_MESSAGES.EXPIRED_FOR_OPERATION(operation);
    case 'invalid': return AUTH_MESSAGES.INVALID_FOR_OPERATION(operation);
    case 'permission_denied': return AUTH_MESSAGES.PERMISSION_DENIED_FOR_OPERATION(operation);
  }
} 
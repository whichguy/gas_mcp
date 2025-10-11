/**
 * OAuth configuration loader
 * Separated from auth.ts to avoid circular dependency with base.ts
 */

import { AuthConfig } from '../auth/oauthClient.js';

/**
 * Load OAuth configuration from unified config
 */
// Cache the config to avoid repeated logging
let cachedAuthConfig: AuthConfig | null = null;

export function loadOAuthConfigFromJson(): AuthConfig {
  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  const authConfig: AuthConfig = {
    client_id: '428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com',
    type: 'uwp',
    redirect_uris: [
      'http://127.0.0.1:3000/callback',
      'http://localhost:3000/callback'
    ],
    scopes: [
      'https://www.googleapis.com/auth/script.projects',
      'https://www.googleapis.com/auth/script.processes',
      'https://www.googleapis.com/auth/script.deployments',
      'https://www.googleapis.com/auth/script.scriptapp',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.webapp.deploy',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/forms',
      'https://www.googleapis.com/auth/logging.read',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  };

  // Cache the config
  cachedAuthConfig = authConfig;

  // Only log once when first loaded
  console.error(`OAuth config loaded: UWP client (${authConfig.client_id.substring(0, 20)}...)`);

  return authConfig;
}

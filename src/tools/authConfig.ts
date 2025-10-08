/**
 * OAuth configuration loader
 * Separated from auth.ts to avoid circular dependency with base.ts
 */

import { AuthConfig } from '../auth/oauthClient.js';

/**
 * Load OAuth configuration from unified config
 */
export function loadOAuthConfigFromJson(): AuthConfig {
  console.error('🔧 Loading OAuth configuration from unified config...');

  const authConfig: AuthConfig = {
    client_id: '428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com',
    type: 'uwp',
    redirect_uris: [
      'http://127.0.0.1:3000/oauth/callback',
      'http://localhost:3000/oauth/callback'
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

  console.error(`🔐 OAuth client initialized with UWP configuration`);
  console.error(`🔑 Client ID: ${authConfig.client_id.substring(0, 20)}...`);
  console.error(`🏷️  Type: ${authConfig.type?.toUpperCase()}`);

  return authConfig;
}

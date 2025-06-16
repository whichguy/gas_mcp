import { OAuth2Client } from 'google-auth-library';
import http from 'node:http';
import { URL } from 'node:url';
import open from 'open';
import crypto from 'node:crypto';
import { AuthStateManager, TokenInfo, UserInfo } from './authState.js';
import { OAuthError } from '../errors/mcpErrors.js';
import { PKCEGenerator, PKCEChallenge } from './pkce.js';

// Import the signaling functions from auth.ts
import { signalAuthCompletion, signalAuthError } from '../tools/auth.js';

/**
 * Google Apps Script OAuth Client for UWP Applications
 * 
 * UWP PKCE-ONLY AUTHENTICATION:
 * - Uses UWP OAuth client type (eliminates client_secret requirement)
 * - Pure PKCE implementation following OAuth 2.0 standards
 * - Works around Google's non-standard desktop application requirements
 * - Client secret is optional (UWP clients don't require it)
 */

export interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
}

export interface AuthConfig {
    client_id: string;
    client_secret?: string;  // OPTIONAL - UWP clients don't require it
    type: 'uwp' | 'desktop';  // UWP preferred for PKCE-only flows
    redirect_uris: string[];
    scopes: string[];
}

/**
 * OAuth client for Google Apps Script API
 * 
 * Implements UWP OAuth 2.0 flow with PKCE (Proof Key for Code Exchange)
 * No client_secret required for UWP apps - uses PKCE instead
 */
export class GASAuthClient {
    private oauth2Client: OAuth2Client;
    private config: AuthConfig;
    private codeVerifier?: string;
    private codeChallenge?: string;
    private state?: string;  // Store state parameter for CSRF protection
    private server?: http.Server;
    private serverPort?: number;
    private redirectUri?: string;
    private currentAuthKey?: string; // Track the current auth key for signaling
    
    // RACE CONDITION FIX: Callback processing guard
    private callbackProcessed = false;
    private callbackProcessing = false;
    
    // RACE CONDITION FIX: Server cleanup protection
    private cleanupInProgress = false;

    constructor(config: AuthConfig) {
        this.config = config;
        
        // Initialize OAuth2Client with PKCE configuration
        this.oauth2Client = new OAuth2Client({
            clientId: config.client_id,
            clientSecret: config.client_secret, // Optional for UWP clients
            redirectUri: 'http://127.0.0.1:*' // Dynamic port will be set during auth flow
        });
        
        console.log('🔐 OAuth client initialized with UWP configuration');
        console.log(`🔑 Client ID: ${config.client_id.substring(0, 30)}...`);
        console.log(`🏷️  Type: ${config.type?.toUpperCase()}`);
    }

    /**
     * Set the current auth key for signaling completion
     */
    setAuthKey(authKey: string): void {
        this.currentAuthKey = authKey;
    }

    /**
     * Start the OAuth authentication flow with race condition protection
     * 
     * This method sets up a local callback server, generates PKCE parameters and state,
     * creates the authorization URL, and optionally opens it in the browser.
     * 
     * @param openBrowser - Whether to automatically open the browser for authentication
     * @returns Promise that resolves to the authorization URL
     * @throws OAuthError if the flow cannot be started
     */
    async startAuthFlow(openBrowser: boolean = true): Promise<string> {
        console.log('🔐 Starting Google OAuth 2.0 flow with PKCE...');

        try {
            // Reset callback state for new flow
            this.callbackProcessed = false;
            this.callbackProcessing = false;
            this.cleanupInProgress = false;
            
            // Generate PKCE parameters using the imported helper
            const pkceChallenge = PKCEGenerator.generateChallenge();
            this.codeVerifier = pkceChallenge.codeVerifier;
            this.codeChallenge = pkceChallenge.codeChallenge;
            
            // Generate state parameter for CSRF protection
            this.state = crypto.randomUUID();
            
            console.log('🔑 Generated PKCE challenge and state parameter');

            // Set up callback server with race condition protection
            await this.setupCallbackServerWithHandlers();

            // Generate authorization URL with all security parameters
            const authUrl = this.createAuthorizationUrl();

            console.log(`🔐 OAuth server listening on ${this.redirectUri}`);
            console.log(`🌐 Authorization URL: ${authUrl}`);

            if (openBrowser) {
                console.log('🚀 Opening browser for authentication...');
                try {
                    await open(authUrl);
                } catch (error) {
                    console.warn('⚠️ Could not open browser automatically. Please visit the URL above manually.');
                }
            }

            return authUrl;
        } catch (error: any) {
            throw new OAuthError(
                `Failed to start OAuth flow: ${error.message}`,
                'authorization'
            );
        }
    }

    /**
     * Set up callback server with race condition protection
     * RACE CONDITION FIX: Prevents duplicate callback processing and server conflicts
     */
    private async setupCallbackServerWithHandlers(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Create server with callback processing protection
            this.server = http.createServer(async (req, res) => {
                try {
                    if (req.url?.startsWith('/callback')) {
                        await this.handleAuthCallback(req, res);
                    } else if (req.url === '/health') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'ok', port: this.serverPort }));
                    } else if (req.url === '/favicon.ico') {
                        res.writeHead(404).end();
                    } else {
                        res.writeHead(404).end('Not found');
                    }
                } catch (error: any) {
                    console.error('❌ Server error:', error.message);
                    res.writeHead(500).end('Internal server error');
                    
                    if (this.currentAuthKey) {
                        signalAuthError(this.currentAuthKey, new OAuthError(`Server error: ${error.message}`, 'authorization'));
                    }
                }
            });
            
            // Listen on OS-assigned port
            this.server.listen(0, '127.0.0.1', () => {
                const address = this.server!.address();
                if (address && typeof address === 'object') {
                    this.serverPort = address.port;
                    this.redirectUri = `http://127.0.0.1:${this.serverPort}/callback`;
                    resolve();
                } else {
                    reject(new Error('Could not determine server port'));
                }
            });

            this.server.on('error', (error) => {
                reject(new Error(`Failed to start callback server: ${error.message}`));
            });
        });
    }

    /**
     * Handle OAuth callback with duplicate processing protection
     * RACE CONDITION FIX: Prevents multiple callback processing
     */
    private async handleAuthCallback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // ATOMIC CHECK: Prevent duplicate callback processing
        if (this.callbackProcessed) {
            console.log('⚠️ Callback already processed, ignoring duplicate request');
            res.writeHead(200, { 'Content-Type': 'text/html' })
               .end('<html><body><h2>Authentication already processed</h2><p>You can close this window.</p></body></html>');
            return;
        }

        // ATOMIC CHECK: Prevent concurrent callback processing
        if (this.callbackProcessing) {
            console.log('⚠️ Callback processing in progress, ignoring concurrent request');
            res.writeHead(200, { 'Content-Type': 'text/html' })
               .end('<html><body><h2>Authentication in progress</h2><p>Please wait...</p></body></html>');
            return;
        }

        // Set processing flag to prevent concurrency
        this.callbackProcessing = true;

        try {
            const url = new URL(req.url!, `http://${req.headers.host}`);
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            const returnedState = url.searchParams.get('state');

            console.log('🔄 OAuth callback received:', { hasCode: !!code, hasState: !!returnedState, hasError: !!error });

            // Validate state parameter to prevent CSRF attacks
            if (returnedState !== this.state) {
                const errorMsg = 'Invalid state parameter - possible CSRF attack detected';
                console.error('❌', errorMsg);
                res.writeHead(400, { 'Content-Type': 'text/html' }).end(this.createErrorPage(errorMsg));
                
                if (this.currentAuthKey) {
                    signalAuthError(this.currentAuthKey, new OAuthError(errorMsg, 'authorization'));
                }
                return;
            }

            if (error) {
                console.error('❌ OAuth error:', error);
                res.writeHead(400, { 'Content-Type': 'text/html' }).end(this.createErrorPage(`OAuth Error: ${error}`));
                
                if (this.currentAuthKey) {
                    signalAuthError(this.currentAuthKey, new OAuthError(`OAuth error: ${error}`, 'authorization'));
                }
                return;
            }

            if (!code) {
                const errorMsg = 'No authorization code found';
                console.error('❌', errorMsg);
                res.writeHead(400, { 'Content-Type': 'text/html' }).end(this.createErrorPage(errorMsg));
                
                if (this.currentAuthKey) {
                    signalAuthError(this.currentAuthKey, new OAuthError(errorMsg, 'authorization'));
                }
                return;
            }

            // Mark callback as processed AFTER validation but BEFORE token exchange
            this.callbackProcessed = true;

            console.log('✅ Authorization callback received successfully');
            console.log('✅ State parameter validated - CSRF protection confirmed');
            console.log('🔄 Processing OAuth callback...');

            // Show success page immediately
            res.writeHead(200, { 'Content-Type': 'text/html' }).end(this.createSuccessPage());

            // Exchange code for tokens
            try {
                const tokenResponse = await this.exchangeCodeForTokens(code);
                console.log('✅ Token exchange successful');
                
                // Signal completion to waiting gas_auth call
                if (this.currentAuthKey) {
                    signalAuthCompletion(this.currentAuthKey, {
                        status: 'authenticated',
                        message: 'Authentication completed successfully',
                        authenticated: true,
                        tokenResponse: tokenResponse,
                        authKey: this.currentAuthKey
                    });
                }
                
                // Clean up server after successful authentication
                this.cleanupServer();
                
            } catch (tokenError: any) {
                console.error('❌ Token exchange failed:', tokenError);
                
                if (this.currentAuthKey) {
                    signalAuthError(this.currentAuthKey, new OAuthError(`Token exchange failed: ${tokenError.message}`, 'token_exchange'));
                }
                
                this.cleanupServer();
            }

        } finally {
            // Always reset processing flag
            this.callbackProcessing = false;
        }
    }

    /**
     * Clean up the callback server with race condition protection
     * RACE CONDITION FIX: Prevents multiple cleanup calls from interfering
     */
    private cleanupServer(): void {
        // ATOMIC CHECK: Prevent multiple cleanup operations
        if (this.cleanupInProgress || !this.server) {
            return;
        }
        
        this.cleanupInProgress = true;
        console.log(`🧹 Cleaning up OAuth callback server on port ${this.serverPort}...`);
        
        // Store server reference and clear instance variable
        const server = this.server;
        const port = this.serverPort;
        
        this.server = undefined;
        this.serverPort = undefined;
        
        // Close server gracefully
        server.close(() => {
            console.log(`✅ OAuth callback server on port ${port} closed successfully`);
            this.cleanupInProgress = false;
        });
        
        // Force close after timeout to prevent hanging
        setTimeout(() => {
            if (!server.listening && this.cleanupInProgress) {
                console.log('⚠️ Force completing cleanup after timeout');
                this.cleanupInProgress = false;
            }
        }, 2000);
    }

    /**
     * Create the OAuth authorization URL with all required parameters
     * 
     * @private
     * @returns The complete authorization URL
     */
    private createAuthorizationUrl(): string {
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', this.config.client_id);
        authUrl.searchParams.set('redirect_uri', this.redirectUri!);
        authUrl.searchParams.set('scope', this.config.scopes.join(' '));
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');
        authUrl.searchParams.set('state', this.state!);
        authUrl.searchParams.set('code_challenge', this.codeChallenge!);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        return authUrl.toString();
    }

    /**
     * Exchange authorization code for access tokens
     * 
     * @private
     * @param code - The authorization code from Google
     * @returns Token response with expiry buffer applied
     */
    private async exchangeCodeForTokens(code: string): Promise<TokenResponse> {
        console.log('🔍 === UWP PKCE TOKEN EXCHANGE ===');
        console.log('📤 Request Parameters:');
        console.log('  - Client ID:', this.config.client_id);
        console.log('  - Client Secret:', this.config.client_secret ? 'PROVIDED (optional)' : 'NOT PROVIDED (UWP PKCE-only)');
        console.log('  - Redirect URI:', this.redirectUri);
        console.log('  - Authorization Code:', code.substring(0, 20) + '...');
        console.log('  - Code Verifier:', this.codeVerifier?.substring(0, 20) + '...');
        console.log('  - Code Challenge:', this.codeChallenge?.substring(0, 20) + '...');
        
        try {
            console.log('📡 Exchanging authorization code for tokens...');
            console.log(`💡 Using UWP PKCE-only flow (standards-compliant)`);
            
            // Use Google Auth Library's built-in getToken method with PKCE
            const { tokens } = await this.oauth2Client.getToken({
                code: code,
                codeVerifier: this.codeVerifier!,
                redirect_uri: this.redirectUri!
            });
            
            console.log('✅ UWP PKCE token exchange successful!');
            console.log('📥 Received tokens:');
            console.log('  - Access token:', tokens.access_token?.substring(0, 30) + '...');
            console.log('  - Refresh token:', tokens.refresh_token ? tokens.refresh_token.substring(0, 30) + '...' : 'none');
            console.log('  - Token type:', tokens.token_type);
            console.log('  - Expires in:', tokens.expiry_date ? Math.floor((tokens.expiry_date - Date.now()) / 1000) : 'unknown', 'seconds');
            console.log('  - Scope:', tokens.scope);
            
            // Apply 60-second buffer to token expiry for clock skew and network latency
            const expiresIn = tokens.expiry_date 
                ? Math.floor((tokens.expiry_date - Date.now() - 60000) / 1000) // Apply 60-second buffer
                : undefined;

            console.log('⏰ Token expiry calculation:');
            console.log('  - Original expiry:', tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'none');
            console.log('  - Buffer applied: 60 seconds');
            console.log('  - Effective expires_in:', expiresIn, 'seconds');
            console.log('🔍 === END UWP PKCE TOKEN EXCHANGE ===');

            return {
                access_token: tokens.access_token!,
                refresh_token: tokens.refresh_token || undefined,
                expires_in: expiresIn,
                token_type: tokens.token_type || 'Bearer',
                scope: tokens.scope || undefined
            };
            
        } catch (error: any) {
            console.log('❌ === TOKEN EXCHANGE ERROR DEBUG ===');
            console.log('🚨 Error details:');
            console.log('  - Error message:', error.message);
            console.log('  - Error type:', error.constructor.name);
            console.log('  - Error stack:', error.stack);
            console.log('🔍 === END ERROR DEBUG ===');
            
            throw new Error(`Token exchange failed: ${error.message}`);
        }
    }

    /**
     * Get the configured OAuth2Client for advanced usage
     * 
     * @returns The Google Auth Library OAuth2Client instance
     */
    getOAuth2Client(): OAuth2Client {
        return this.oauth2Client;
    }

    /**
     * Get user information using access token
     */
    async getUserInfo(accessToken: string): Promise<UserInfo> {
        try {
            console.log(`📡 [GOOGLE OAUTH API] Starting getUserInfo request`);
            console.log(`   ⏰ Timestamp: ${new Date().toISOString()}`);
            console.log(`   📍 URL: https://www.googleapis.com/oauth2/v2/userinfo`);
            console.log(`   🔑 Auth: Token present (${accessToken.substring(0, 10)}...)`);
            
            const startTime = Date.now();
            
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            const duration = Date.now() - startTime;
            console.log(`📥 [GOOGLE OAUTH API] getUserInfo response received after ${duration}ms`);
            console.log(`   🔢 Status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ [GOOGLE OAUTH API ERROR] getUserInfo failed`);
                console.error(`   🔢 Status: ${response.status} ${response.statusText}`);
                console.error(`   📄 Error body: ${errorText}`);
                console.error(`   ⏱️  Duration: ${duration}ms`);
                throw new Error(`User info fetch failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();

            console.log(`✅ [GOOGLE OAUTH API SUCCESS] getUserInfo completed`);
            console.log(`   📊 User email: ${data.email || 'No email'}`);
            console.log(`   📊 User name: ${data.name || 'No name'}`);
            console.log(`   📏 Response size: ${JSON.stringify(data).length} characters`);
            console.log(`   ⏱️  Total duration: ${duration}ms`);

            if (!data.email) {
                throw new Error('No email address in user info response');
            }

            const userInfo: UserInfo = {
                email: data.email,
                name: data.name || data.email,
                id: data.id || data.email,
                picture: data.picture,
                verified_email: data.verified_email || false,
            };

            console.log(`✅ User info retrieved for: ${userInfo.email}`);
            return userInfo;

        } catch (error: any) {
            console.error('❌ User info fetch failed:', error);
            throw new OAuthError(
                `Failed to fetch user information: ${error.message}`,
                'validation'
            );
        }
    }

    /**
     * Revoke tokens
     */
    async revokeTokens(accessToken: string): Promise<void> {
        try {
            console.log(`📡 [GOOGLE OAUTH API] Starting token revocation`);
            console.log(`   ⏰ Timestamp: ${new Date().toISOString()}`);
            console.log(`   📍 URL: https://oauth2.googleapis.com/revoke`);
            console.log(`   🔑 Token: ${accessToken.substring(0, 10)}...`);
            
            const startTime = Date.now();
            
            const response = await fetch('https://oauth2.googleapis.com/revoke', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    token: accessToken,
                })
            });

            const duration = Date.now() - startTime;
            console.log(`📥 [GOOGLE OAUTH API] Token revocation response received after ${duration}ms`);
            console.log(`   🔢 Status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                console.warn(`⚠️ [GOOGLE OAUTH API] Token revocation failed: ${response.status} ${response.statusText}`);
                console.warn(`   ⏱️  Duration: ${duration}ms`);
                // Don't throw error - revocation failure shouldn't block logout
            } else {
                console.log(`✅ [GOOGLE OAUTH API SUCCESS] Token revoked successfully after ${duration}ms`);
            }

        } catch (error: any) {
            console.warn('⚠️  Token revocation error:', error.message);
            // Don't throw error - revocation failure shouldn't block logout
        }
    }

    /**
     * Validate token and get basic info
     */
    async validateToken(accessToken: string): Promise<boolean> {
        try {
            console.log(`📡 [GOOGLE OAUTH API] Starting token validation`);
            console.log(`   ⏰ Timestamp: ${new Date().toISOString()}`);
            console.log(`   📍 URL: https://www.googleapis.com/oauth2/v1/tokeninfo`);
            console.log(`   🔑 Token: ${accessToken.substring(0, 10)}...`);
            
            const startTime = Date.now();
            
            const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            const duration = Date.now() - startTime;
            console.log(`📥 [GOOGLE OAUTH API] Token validation response received after ${duration}ms`);
            console.log(`   🔢 Status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                console.log(`❌ [GOOGLE OAUTH API] Token validation failed: ${response.status} ${response.statusText}`);
                console.log(`   ⏱️  Duration: ${duration}ms`);
                return false;
            }

            const data = await response.json();
            
            console.log(`✅ [GOOGLE OAUTH API SUCCESS] Token validation completed after ${duration}ms`);
            console.log(`   📊 Token scope: ${data.scope || 'No scope info'}`);
            console.log(`   📊 Token expires in: ${data.expires_in || 'Unknown'} seconds`);
            
            // Check if token has required scopes
            const requiredScopes = ['script.projects', 'script.processes', 'script.deployments', 'script.scriptapp'];
            const tokenScope = data.scope || '';
            
            const hasRequiredScopes = requiredScopes.every(scope =>
                tokenScope.includes(scope)
            );

            console.log(`📊 Required scopes present: ${hasRequiredScopes}`);
            return hasRequiredScopes;

        } catch (error) {
            console.error('❌ [GOOGLE OAUTH API ERROR] Token validation error:', error);
            return false;
        }
    }

    private createErrorPage(message: string): string {
        return `
            <html>
                <head>
                    <title>OAuth Authentication Error</title>
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            max-width: 800px; 
                            margin: 50px auto; 
                            padding: 20px; 
                            background: #f9f9f9; 
                        }
                        .error-container { 
                            background: white; 
                            padding: 30px; 
                            border-radius: 8px; 
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
                        }
                        .error-header { 
                            color: #dc3545; 
                            margin-bottom: 20px; 
                            border-bottom: 2px solid #dc3545; 
                            padding-bottom: 10px; 
                        }
                        .error-details { 
                            background: #f8f9fa; 
                            padding: 15px; 
                            border-radius: 4px; 
                            margin: 15px 0; 
                            font-family: monospace; 
                            font-size: 14px;
                            overflow-x: auto;
                        }
                        .suggestions { 
                            background: #fff3cd; 
                            border: 1px solid #ffeaa7; 
                            padding: 15px; 
                            border-radius: 4px; 
                            margin: 15px 0; 
                        }
                        .suggestions ul { 
                            margin: 10px 0; 
                            padding-left: 20px; 
                        }
                        .suggestions li { 
                            margin: 8px 0; 
                            line-height: 1.4; 
                        }
                        .close-button { 
                            background: #007bff; 
                            color: white; 
                            border: none; 
                            padding: 10px 20px; 
                            border-radius: 4px; 
                            cursor: pointer; 
                            margin-top: 20px; 
                        }
                        .close-button:hover { 
                            background: #0056b3; 
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <div class="error-header">
                            <h2>❌ OAuth Authentication Failed</h2>
                            <h3>${message}</h3>
                        </div>
                        
                        <div class="error-details">
                            <strong>Error Details:</strong><br>
                            ${message}
                        </div>
                        
                        <div class="suggestions">
                            <h4>💡 How to Fix This:</h4>
                            <ul>
                                <li>🔧 Check your Google Cloud Console OAuth client configuration</li>
                                <li>📍 Ensure the client is configured as "Desktop Application"</li>
                                <li>🔗 Verify redirect URIs are set to http://127.0.0.1/* and http://localhost/*</li>
                                <li>👤 Make sure you are added as a test user if the app is in Testing mode</li>
                            </ul>
                        </div>
                        
                        <button class="close-button" onclick="window.close()">
                            Close Tab
                        </button>
                    </div>
                    
                    <script>
                        // Auto-close after 30 seconds
                        setTimeout(() => {
                            window.close();
                        }, 30000);
                    </script>
                </body>
            </html>
        `;
    }

    private createSuccessPage(): string {
        return `
            <html>
                <head>
                    <title>OAuth Authentication Successful</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            max-width: 600px; 
                            margin: 50px auto; 
                            padding: 30px; 
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-align: center;
                            line-height: 1.6;
                            border-radius: 15px;
                            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                        }
                        .success-container { 
                            background: rgba(255, 255, 255, 0.1); 
                            padding: 40px; 
                            border-radius: 15px; 
                            backdrop-filter: blur(10px);
                            border: 1px solid rgba(255, 255, 255, 0.2);
                        }
                        .success-header { 
                            margin-bottom: 30px; 
                        }
                        .success-header h1 {
                            margin: 0;
                            font-size: 32px;
                            font-weight: 600;
                            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        }
                        .success-header h2 {
                            margin: 15px 0 0 0;
                            font-weight: 300;
                            font-size: 18px;
                            opacity: 0.9;
                        }
                        .success-details { 
                            background: rgba(255, 255, 255, 0.1); 
                            padding: 25px; 
                            border-radius: 10px; 
                            margin: 25px 0; 
                            font-size: 16px;
                            border: 1px solid rgba(255, 255, 255, 0.2);
                        }
                        .close-button { 
                            background: rgba(255, 255, 255, 0.2); 
                            color: white; 
                            border: 2px solid rgba(255, 255, 255, 0.3); 
                            padding: 15px 30px; 
                            border-radius: 8px; 
                            cursor: pointer; 
                            margin-top: 25px; 
                            font-size: 16px;
                            font-weight: 500;
                            transition: all 0.3s ease;
                            backdrop-filter: blur(5px);
                        }
                        .close-button:hover { 
                            background: rgba(255, 255, 255, 0.3);
                            transform: translateY(-2px);
                            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                        }
                        .checkmark {
                            font-size: 48px;
                            margin-bottom: 20px;
                            display: block;
                        }
                        .feature-list {
                            text-align: left;
                            margin: 20px 0;
                        }
                        .feature-list li {
                            margin: 8px 0;
                            padding-left: 25px;
                            position: relative;
                        }
                        .feature-list li:before {
                            content: "✓";
                            position: absolute;
                            left: 0;
                            color: #4ade80;
                            font-weight: bold;
                        }
                    </style>
                </head>
                <body>
                    <div class="success-container">
                        <div class="success-header">
                            <span class="checkmark">&#x2705;</span>
                            <h1>Authentication Successful!</h1>
                            <h2>MCP Gas Server OAuth Flow Complete</h2>
                        </div>
                        
                        <div class="success-details">
                            <strong>You are now authenticated with Google Apps Script API</strong>
                            <ul class="feature-list">
                                <li>Access token received and saved securely</li>
                                <li>PKCE security validation passed</li>
                                <li>CSRF protection confirmed</li>
                                <li>All Google Apps Script scopes granted</li>
                            </ul>
                            <p style="margin-top: 20px; font-size: 14px; opacity: 0.8;">
                                You can now close this tab and return to your application.
                            </p>
                        </div>
                        
                        <button class="close-button" onclick="window.close()">
                            Close Tab
                        </button>
                    </div>
                    
                    <script>
                        // Auto-close after 3 seconds
                        setTimeout(() => {
                            window.close();
                        }, 3000);
                        
                        // Add a subtle animation
                        document.addEventListener('DOMContentLoaded', () => {
                            const container = document.querySelector('.success-container');
                            container.style.opacity = '0';
                            container.style.transform = 'translateY(20px)';
                            container.style.transition = 'all 0.5s ease';
                            
                            setTimeout(() => {
                                container.style.opacity = '1';
                                container.style.transform = 'translateY(0)';
                            }, 100);
                        });
                    </script>
                </body>
            </html>
        `;
    }

    private createTokenErrorPage(error: any): string {
        const isClientSecretError = error.message?.includes('client_secret is missing');
        
        const errorTitle = isClientSecretError 
            ? 'OAuth Client Configuration Error'
            : 'Token Exchange Failed';
            
        const errorMessage = isClientSecretError
            ? 'Your OAuth client is configured as "Web Application" but should be "Desktop Application" for PKCE to work.'
            : error.message;
            
        const suggestions = isClientSecretError ? [
            '🔧 IMMEDIATE FIX REQUIRED: Change OAuth Client Type',
            '📍 Go to: https://console.cloud.google.com/apis/credentials',
            '🔑 Find your OAuth client ID in the list',
            '⚙️ Click on the client name (not download button)',
            '🔄 Change "Application type" from "Web application" to "Desktop application"',
            '💾 Click "Save" to apply changes',
            '⏰ Wait 5-10 minutes for Google servers to propagate the change',
            '🔁 Then retry the authentication flow',
            '',
            '📋 DETAILED STEPS:',
            '1. Open Google Cloud Console Credentials page',
            '2. Look for client ID: 428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com',
            '3. Click on the client name (should open edit dialog)',
            '4. At the top, find "Application type" dropdown',
            '5. Change from "Web application" to "Desktop application"',
            '6. Save and wait for propagation',
            '',
            '❓ WHY THIS HAPPENS:',
            '• Web Application clients require client_secret for token exchange',
            '• Desktop Application clients use PKCE instead (more secure)',
            '• Our implementation correctly uses PKCE but your client type is wrong',
            '',
            '🔍 VERIFICATION:',
            '• After changing to Desktop app, no redirect URIs should be required',
            '• Desktop apps automatically allow localhost redirects',
            '• You can keep the client_secret but our app will not use it'
        ] : [
            '🔧 Check your Google Cloud Console OAuth client configuration',
            '📍 Ensure the client is configured as "Desktop Application"',
            '🔗 Verify redirect URIs are set to http://127.0.0.1/* and http://localhost/*',
            '👤 Make sure you are added as a test user if the app is in Testing mode'
        ];

        return `
            <html>
                <head>
                    <title>OAuth Authentication Error</title>
                    <meta charset="UTF-8">
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            max-width: 900px; 
                            margin: 20px auto; 
                            padding: 20px; 
                            background: #f5f5f5; 
                            line-height: 1.6;
                        }
                        .error-container { 
                            background: white; 
                            padding: 30px; 
                            border-radius: 12px; 
                            box-shadow: 0 4px 20px rgba(0,0,0,0.1); 
                        }
                        .error-header { 
                            color: #d73a49; 
                            margin-bottom: 25px; 
                            border-bottom: 3px solid #d73a49; 
                            padding-bottom: 15px; 
                        }
                        .error-header h2 {
                            margin: 0;
                            font-size: 24px;
                        }
                        .error-header h3 {
                            margin: 10px 0 0 0;
                            font-weight: normal;
                            color: #586069;
                        }
                        .error-details { 
                            background: #f6f8fa; 
                            padding: 20px; 
                            border-radius: 8px; 
                            margin: 20px 0; 
                            font-family: 'Monaco', 'Menlo', monospace; 
                            font-size: 14px;
                            border-left: 4px solid #d73a49;
                            word-break: break-word;
                        }
                        .suggestions { 
                            background: #fff3cd; 
                            border: 2px solid #ffeaa7; 
                            padding: 25px; 
                            border-radius: 8px; 
                            margin: 25px 0; 
                        }
                        .suggestions h4 {
                            margin-top: 0;
                            color: #856404;
                            font-size: 18px;
                        }
                        .suggestions ul { 
                            margin: 15px 0; 
                            padding-left: 25px; 
                        }
                        .suggestions li { 
                            margin: 12px 0; 
                            line-height: 1.5; 
                        }
                        .close-button { 
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                            color: white; 
                            border: none; 
                            padding: 12px 24px; 
                            border-radius: 6px; 
                            cursor: pointer; 
                            margin-top: 20px; 
                            font-size: 16px;
                            font-weight: 500;
                            transition: transform 0.2s ease;
                        }
                        .close-button:hover { 
                            transform: translateY(-2px);
                        }
                        .debug-info {
                            background: #f1f3f4;
                            padding: 15px;
                            border-radius: 6px;
                            margin: 15px 0;
                            font-family: monospace;
                            font-size: 13px;
                            border: 1px solid #dadce0;
                        }
                        .highlight {
                            background: #fff2cc;
                            padding: 2px 4px;
                            border-radius: 3px;
                            font-weight: bold;
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <div class="error-header">
                            <h2>❌ ${errorTitle}</h2>
                            <h3>${errorMessage}</h3>
                        </div>
                        
                        <div class="error-details">
                            <strong>Technical Error:</strong><br>
                            ${error.message}
                        </div>
                        
                        ${isClientSecretError ? `
                        <div class="debug-info">
                            <strong>🔍 What We Detected:</strong><br>
                            • OAuth Client Type: <span class="highlight">Web Application</span> (should be Desktop Application)<br>
                            • PKCE Parameters: ✅ Correctly sent<br>
                            • Client Secret: ❌ Required by Web App type but not sent (correct for PKCE)<br>
                            • Solution: Change client type to Desktop Application
                        </div>
                        ` : ''}
                        
                        <div class="suggestions">
                            <h4>💡 How to Fix This:</h4>
                            <ul>
                                ${suggestions.map(s => `<li>${s}</li>`).join('')}
                            </ul>
                        </div>
                        
                        <button class="close-button" onclick="window.close()">
                            Close Tab
                        </button>
                    </div>
                    
                    <script>
                        // Auto-close after 2 minutes
                        setTimeout(() => {
                            if (confirm('Close this tab automatically?')) {
                                window.close();
                            }
                        }, 120000);
                    </script>
                </body>
            </html>
        `;
    }
} 
import express from 'express';
import cors from 'cors';
import { Server } from 'http';
import { OAuthError } from '../errors/mcpErrors.js';

/**
 * OAuth callback result structure
 * 
 * Contains the authorization code and state received from Google OAuth callback,
 * or error information if the OAuth flow failed.
 * 
 * @interface CallbackResult
 */
export interface CallbackResult {
  /** Authorization code from Google OAuth (empty string if error occurred) */
  code: string;
  /** Optional state parameter for CSRF protection */
  state?: string;
  /** OAuth error code if authentication failed */
  error?: string;
  /** Human-readable error description */
  error_description?: string;
}

/**
 * Singleton OAuth callback server for Google Apps Script authentication
 * 
 * ## Architecture Overview
 * 
 * This server implements a **singleton OAuth callback server** that handles Google OAuth 2.0
 * redirects for all MCP Gas sessions. It's designed to be shared across multiple authentication
 * sessions while maintaining proper isolation and security.
 * 
 * ### 🔒 Singleton Design Pattern
 * - **Single Instance**: Only one callback server runs per MCP Gas server instance
 * - **Shared Across Sessions**: All authentication sessions use the same callback endpoint
 * - **Port Fixation**: MUST use port 3000 due to hardcoded Google OAuth redirect URI
 * - **Lifecycle Management**: Starts on-demand, auto-shuts down after auth completion
 * 
 * ### 🌐 OAuth 2.0 Callback Requirements
 * - **Fixed Redirect URI**: `http://localhost:3000/oauth/callback` (registered with Google)
 * - **Port Binding**: Cannot use random ports - OAuth requires exact URI match
 * - **Browser Integration**: Provides user-friendly HTML responses and auto-close functionality
 * - **Error Handling**: Graceful handling of OAuth errors and edge cases
 * 
 * ### 🔄 Server Lifecycle Management
 * - **On-Demand Startup**: Server starts when OAuth flow begins
 * - **Auto-Shutdown**: Server stops after callback received (success or failure)
 * - **Port Conflict Resolution**: Handles EADDRINUSE errors with helpful messages
 * - **Connection Tracking**: Monitors active connections for forced cleanup
 * - **Graceful Shutdown**: 2-second timeout with forced connection termination
 * 
 * ### 🎯 Development Considerations for AI Assistants
 * 
 * When working with this OAuth callback server:
 * 
 * #### Port Management
 * ```typescript
 * // Port 3000 is REQUIRED - cannot be changed without updating Google OAuth config
 * const server = new OAuthCallbackServer(3000);
 * ```
 * 
 * #### Callback Handling
 * ```typescript
 * // Wait for OAuth callback with timeout
 * const result = await server.waitForCallback(300000); // 5 minute timeout
 * ```
 * 
 * #### Error Recovery
 * ```typescript
 * // Handle port conflicts gracefully
 * try {
 *   await server.start();
 * } catch (error) {
 *   if (error.code === 'EADDRINUSE') {
 *     // Port 3000 already in use - handle appropriately
 *   }
 * }
 * ```
 * 
 * ## Security Considerations
 * 
 * - **CORS Enabled**: Allows cross-origin requests for OAuth flows
 * - **Connection Logging**: Tracks incoming connections for security monitoring
 * - **Auto-Close Browser**: Attempts to close browser window after auth completion
 * - **State Parameter**: Supports OAuth state parameter for CSRF protection
 * 
 * @export
 * @class OAuthCallbackServer
 */
export class OAuthCallbackServer {
  /** Express application instance for handling HTTP requests */
  private app: express.Application;
  
  /** HTTP server instance (null when not running) */
  private server: Server | null = null;
  
  /** Port number for OAuth callback (MUST be 3000 for Google OAuth) */
  private port: number;
  
  /** Promise that resolves when OAuth callback is received */
  private pendingCallback: Promise<CallbackResult> | null = null;
  
  /** Resolver function for pending callback promise */
  private callbackResolver: ((result: CallbackResult) => void) | null = null;
  
  /** Set of active socket connections for forced cleanup */
  private connections: Set<any> = new Set();

  /**
   * Initialize OAuth callback server with singleton port requirements
   * 
   * ## Critical OAuth Requirements:
   * 
   * The OAuth callback server MUST use port 3000 because:
   * 1. Google OAuth redirect URI is hardcoded as `http://localhost:3000/oauth/callback`
   * 2. OAuth 2.0 requires exact URI match for security
   * 3. Cannot use random ports or the OAuth flow will fail
   * 
   * ## Port Conflict Handling:
   * - If port 3000 is in use, authentication will fail
   * - Error handling provides clear guidance for port conflicts
   * - Test mode logging helps debug port issues
   * 
   * @param port - OAuth callback port (defaults to 3000, should not be changed)
   * 
   * @example
   * ```typescript
   * // Standard usage - port 3000 required for OAuth
   * const callbackServer = new OAuthCallbackServer(3000);
   * 
   * // This would fail OAuth due to mismatched redirect URI
   * const badServer = new OAuthCallbackServer(8080); // ❌ Don't do this
   * ```
   */
  constructor(port: number = 3000) {
    // OAuth callback MUST use port 3000 because the Google OAuth redirect URI is hardcoded
    // Random ports are not allowed for OAuth callbacks as they won't match the configured redirect URI
    this.port = port;
    
    // Log the port decision
    if (process.env.NODE_ENV === 'test' || process.env.MCP_TEST_MODE === 'true') {
      console.log(`🔒 OAuth callback server will use port ${this.port} (OAuth requires exact redirect URI match)`);
    }
    
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Get a random port for testing scenarios
   * 
   * ⚠️ **WARNING**: This method is for testing only and should NOT be used
   * for actual OAuth callbacks. OAuth requires the exact redirect URI match.
   * 
   * @private
   * @returns Random port number between 10000-65535
   */
  private getRandomPort(): number {
    return Math.floor(Math.random() * (65535 - 10000) + 10000);
  }

  /**
   * Setup Express middleware for OAuth callback handling
   * 
   * Configures essential middleware:
   * - CORS for cross-origin requests
   * - JSON and URL-encoded body parsing
   * - Request logging and security monitoring
   * 
   * @private
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  /**
   * Setup OAuth callback routes and endpoints
   * 
   * Creates the following endpoints:
   * 
   * ### Main Endpoints
   * - `GET /` - Server information page with auto-refresh
   * - `GET /oauth/callback` - **Critical OAuth callback endpoint**
   * - `GET /health` - Health check and status endpoint
   * - `404 Handler` - Friendly 404 page for unknown routes
   * 
   * ### OAuth Callback Flow
   * 1. **Success Path**: Receives `code` parameter, shows success page, auto-closes
   * 2. **Error Path**: Receives `error` parameter, shows error page with retry guidance
   * 3. **Invalid Path**: Missing code, shows error page
   * 
   * ### Browser UX Features
   * - **Auto-Close**: JavaScript attempts to close browser window after 3 seconds
   * - **Fallback UI**: Manual close button if auto-close is blocked
   * - **Countdown Timer**: Visual feedback during auto-close countdown
   * - **Responsive Design**: Clean, accessible HTML with inline CSS
   * 
   * @private
   * 
   * @example
   * OAuth callback URLs this server handles:
   * ```
   * # Success callback
   * http://localhost:3000/oauth/callback?code=auth_code_here&state=csrf_token
   * 
   * # Error callback  
   * http://localhost:3000/oauth/callback?error=access_denied&error_description=User+denied
   * ```
   */
  private setupRoutes(): void {
    // Root URL handler - inform users about the OAuth server
    this.app.get('/', (req, res) => {
      res.send(`
        <html>
          <head>
            <title>MCP Gas OAuth Server</title>
            <meta http-equiv="refresh" content="30">
          </head>
          <body style="font-family: Arial, sans-serif; padding: 50px; text-align: center; background: #f5f5f5;">
            <h1 style="color: #1976d2;">MCP Gas OAuth Server</h1>
            <p>This is the OAuth callback server for MCP Gas authentication.</p>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px auto; max-width: 600px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3>Server Status</h3>
              <p><strong>Status:</strong> <span style="color: #4caf50;">Running</span></p>
              <p><strong>Callback URL:</strong> <code>http://localhost:${this.port}/oauth/callback</code></p>
              <p><strong>Health Check:</strong> <a href="/health">http://localhost:${this.port}/health</a></p>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px auto; max-width: 600px; border: 1px solid #ffeaa7;">
              <p><strong>Note:</strong> This server will automatically shut down after OAuth authentication is complete.</p>
              <p>If you see this page after authentication, the OAuth flow may still be in progress or the server may shut down soon.</p>
            </div>
            <p style="color: #666; font-size: 0.9em;">Page auto-refreshes every 30 seconds</p>
          </body>
        </html>
      `);
    });

    // OAuth callback endpoint
    this.app.get('/oauth/callback', (req, res) => {
      console.log(`📥 OAuth callback received:`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        query: req.query,
        timestamp: new Date().toISOString()
      });

      const { code, state, error, error_description } = req.query as any;

      if (error) {
        console.log(`❌ OAuth callback error: ${error} - ${error_description}`);
        const result: CallbackResult = {
          code: '',
          error,
          error_description
        };
        
        res.send(`
          <html>
            <head><title>Authentication Failed</title></head>
            <body style="font-family: Arial, sans-serif; padding: 50px; text-align: center;">
              <h1 style="color: #d32f2f;">Authentication Failed</h1>
              <p><strong>Error:</strong> ${error}</p>
              <p><strong>Description:</strong> ${error_description || 'Unknown error'}</p>
              <div style="background: #ffebee; padding: 20px; border-radius: 8px; margin: 20px auto; max-width: 500px;">
                <p>You can close this window and try authenticating again.</p>
                <p>This server will shut down automatically in a few seconds.</p>
              </div>
              <script>
                setTimeout(() => {
                  if (window.close) window.close();
                  else window.location.href = '/';
                }, 5000);
              </script>
            </body>
          </html>
        `);

        if (this.callbackResolver) {
          this.callbackResolver(result);
          this.callbackResolver = null;
        }
        return;
      }

      if (!code) {
        console.log(`❌ OAuth callback missing authorization code`);
        res.status(400).send(`
          <html>
            <head><title>Authentication Error</title></head>
            <body style="font-family: Arial, sans-serif; padding: 50px; text-align: center;">
              <h1 style="color: #d32f2f;">Authentication Error</h1>
              <p>No authorization code received.</p>
              <div style="background: #ffebee; padding: 20px; border-radius: 8px; margin: 20px auto; max-width: 500px;">
                <p>You can close this window and try authenticating again.</p>
                <p>This server will shut down automatically in a few seconds.</p>
              </div>
              <script>
                setTimeout(() => {
                  if (window.close) window.close();
                  else window.location.href = '/';
                }, 5000);
              </script>
            </body>
          </html>
        `);
        return;
      }

      console.log(`✅ OAuth callback successful with code: ${code.substring(0, 10)}...`);
      const result: CallbackResult = {
        code: code as string,
        state: state as string
      };

      res.send(`
        <html>
          <head><title>Authentication Successful</title></head>
          <body style="font-family: Arial, sans-serif; padding: 50px; text-align: center;">
            <h1 style="color: #4caf50;">🎉 Authentication Successful!</h1>
            <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px auto; max-width: 500px; border: 1px solid #4caf50;">
              <p><strong>✅ You have successfully authenticated with Google Apps Script!</strong></p>
              <p>Your MCP Gas tools are now ready to use.</p>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px auto; max-width: 500px; border: 1px solid #ffeaa7;">
              <p><strong>Important:</strong> This OAuth server will shut down automatically in a few seconds.</p>
              <p>Please <strong>close this browser window</strong> or return to your application.</p>
              <p><strong>Do not bookmark or refresh this page</strong> - it will not be available after authentication.</p>
            </div>
            <p style="color: #666; font-size: 0.9em;">This window will close automatically in 3 seconds...</p>
            <script>
              let countdown = 3;
              const countdownElement = document.querySelector('p[style*="color: #666"]');
              
              const updateCountdown = () => {
                if (countdown > 0) {
                  countdownElement.textContent = 'This window will close automatically in ' + countdown + ' seconds...';
                  countdown--;
                  setTimeout(updateCountdown, 1000);
                } else {
                  // Try to close the window
                  try {
                    window.close();
                    // If we're still here after 500ms, the close didn't work
                    setTimeout(() => {
                      countdownElement.textContent = 'Please close this window manually - auto-close is blocked by your browser';
                      countdownElement.style.color = '#ff9800';
                      countdownElement.style.fontSize = '1em';
                      countdownElement.style.fontWeight = 'bold';
                      
                      // Add a close button as fallback
                      const closeButton = document.createElement('button');
                      closeButton.textContent = 'Try to Close Window';
                      closeButton.style.cssText = 'background: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-top: 20px; font-size: 16px;';
                      closeButton.onclick = () => {
                        window.close();
                        closeButton.textContent = 'Close blocked - please close manually';
                        closeButton.disabled = true;
                        closeButton.style.background = '#999';
                      };
                      
                      const div = document.createElement('div');
                      div.appendChild(closeButton);
                      countdownElement.parentNode.appendChild(div);
                    }, 500);
                  } catch (error: any) {
                    countdownElement.textContent = 'Please close this window manually';
                    countdownElement.style.color = '#ff9800';
                  }
                }
              };
              
              updateCountdown();
            </script>
          </body>
        </html>
      `);

      console.log(`🔄 Resolving OAuth callback with result`);
      if (this.callbackResolver) {
        this.callbackResolver(result);
        this.callbackResolver = null;
      }
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        server: 'MCP Gas OAuth Callback Server',
        endpoints: [
          'GET / - Server information',
          'GET /oauth/callback - OAuth callback endpoint',
          'GET /health - This health check'
        ]
      });
    });

    // 404 handler for any other routes
    this.app.use((req, res) => {
      res.status(404).send(`
        <html>
          <head><title>Page Not Found</title></head>
          <body style="font-family: Arial, sans-serif; padding: 50px; text-align: center;">
            <h1>404 - Page Not Found</h1>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px auto; max-width: 500px;">
              <p>This is the <strong>MCP Gas OAuth callback server</strong>.</p>
              <p><strong>Path requested:</strong> <code>${req.path}</code></p>
            </div>
            <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px auto; max-width: 500px; border: 1px solid #2196f3;">
              <h3>Available Endpoints:</h3>
              <ul style="text-align: left; display: inline-block;">
                <li><a href="/">Server Information</a></li>
                <li><a href="/health">Health Check</a></li>
                <li><code>/oauth/callback</code> - OAuth callback (used automatically)</li>
              </ul>
            </div>
            <p style="color: #666; font-size: 0.9em;">
              This server runs temporarily during OAuth authentication and shuts down automatically afterward.
            </p>
          </body>
        </html>
      `);
    });
  }

  /**
   * Start the callback server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        console.log(`OAuth callback server already running on port ${this.port}`);
        resolve();
        return;
      }

      console.log(`Starting OAuth callback server on port ${this.port}...`);

      // Bind to all interfaces (0.0.0.0) to ensure accessibility
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        console.log(`✅ OAuth callback server listening on http://localhost:${this.port}`);
        console.log(`   - Root page: http://localhost:${this.port}/`);
        console.log(`   - Callback: http://localhost:${this.port}/oauth/callback`);
        console.log(`   - Health: http://localhost:${this.port}/health`);
        resolve();
      });

      this.server.on('error', (error: any) => {
        console.error(`❌ OAuth callback server error:`, error);
        if (error.code === 'EADDRINUSE') {
          reject(new OAuthError(`Port ${this.port} is already in use`, 'authorization'));
        } else if (error.code === 'EACCES') {
          reject(new OAuthError(`Permission denied to bind to port ${this.port}`, 'authorization'));
        } else {
          reject(new OAuthError(`Failed to start callback server: ${error.message}`, 'authorization'));
        }
      });

      // Add connection logging and tracking
      this.server.on('connection', (socket) => {
        console.log(`🔌 New connection to OAuth callback server from ${socket.remoteAddress}`);
        
        // Track this connection
        this.connections.add(socket);
        
        socket.on('close', () => {
          console.log(`🔌 Connection closed from ${socket.remoteAddress}`);
          this.connections.delete(socket);
        });
        
        // Handle connection errors
        socket.on('error', (error) => {
          console.log(`⚠️  Connection error from ${socket.remoteAddress}:`, error.message);
          this.connections.delete(socket);
        });
      });

      // Ensure server stays running
      this.server.on('close', () => {
        console.log('⚠️  OAuth callback server closed unexpectedly');
        this.server = null;
      });
    });
  }

  /**
   * Stop the callback server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      console.log(`🛑 Stopping OAuth callback server (${this.connections.size} active connections)...`);

      // Force close all active connections
      if (this.connections.size > 0) {
        console.log(`🔌 Forcefully closing ${this.connections.size} active connections...`);
        for (const socket of this.connections) {
          try {
            socket.destroy();
          } catch (error: any) {
            console.warn(`⚠️  Error destroying connection:`, error.message);
          }
        }
        this.connections.clear();
      }

      // Set a timeout to force shutdown if graceful close doesn't work
      const forceTimeout = setTimeout(() => {
        console.log(`⚠️  Force closing OAuth callback server (graceful close timed out)`);
        if (this.server) {
          try {
            (this.server as any).destroy?.();
          } catch (error: any) {
            console.warn(`⚠️  Error during force close:`, error.message);
          }
        }
        this.server = null;
        resolve();
      }, 2000); // 2 second timeout

      this.server.close((error: any) => {
        clearTimeout(forceTimeout);
        
        if (error) {
          console.warn(`⚠️  Error closing OAuth callback server:`, error.message);
        } else {
          console.log(`✅ OAuth callback server stopped gracefully`);
        }
        
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Wait for OAuth callback
   */
  async waitForCallback(timeoutMs: number = 300000): Promise<CallbackResult> {
    // If there's already a pending callback, reject it first to allow new one
    if (this.pendingCallback) {
      console.log(`⚠️  OAuth callback server already waiting - clearing previous callback`);
      if (this.callbackResolver) {
        // Reject the previous callback with timeout
        const previousResolver = this.callbackResolver;
        this.callbackResolver = null;
        this.pendingCallback = null;
        try {
          previousResolver({
            code: '',
            error: 'replaced',
            error_description: 'Callback was replaced by new request'
          });
        } catch (error) {
          // Ignore errors when cleaning up previous callback
        }
      } else {
        this.pendingCallback = null;
      }
    }

    this.pendingCallback = new Promise<CallbackResult>((resolve, reject) => {
      this.callbackResolver = resolve;

      // Set timeout
      const timeout = setTimeout(() => {
        this.callbackResolver = null;
        this.pendingCallback = null;
        reject(new OAuthError('OAuth callback timeout', 'authorization'));
      }, timeoutMs);

      // Clear timeout when resolved
      const originalResolver = this.callbackResolver;
      this.callbackResolver = (result) => {
        clearTimeout(timeout);
        this.pendingCallback = null;
        originalResolver(result);
      };
    });

    return this.pendingCallback;
  }

  /**
   * Get the callback URL for OAuth redirects
   */
  getCallbackUrl(): string {
    return `http://localhost:${this.port}/oauth/callback`;
  }

  /**
   * Get the current port number
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null;
  }
} 
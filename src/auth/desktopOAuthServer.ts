/**
 * Desktop OAuth Callback Server
 * 
 * Implements localhost callback server for desktop OAuth flows.
 * Listens on random port on 127.0.0.1 for OAuth redirects.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { URL } from 'url';
import { AddressInfo } from 'net';

export interface OAuthCallbackResult {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/**
 * Desktop OAuth callback server for PKCE flow
 */
export class DesktopOAuthServer {
  private server: Server | null = null;
  private port: number = 0;
  private callbackPromise: Promise<OAuthCallbackResult> | null = null;
  private callbackResolve: ((result: OAuthCallbackResult) => void) | null = null;
  private callbackReject: ((error: Error) => void) | null = null;

  /**
   * Start the OAuth callback server on a random port
   */
  async start(): Promise<number> {
    if (this.server) {
      throw new Error('OAuth callback server is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleRequest.bind(this));
      
      this.server.on('error', (error) => {
        console.error('OAuth callback server error:', error);
        reject(error);
      });

      // Listen on random port on 127.0.0.1 (localhost)
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address() as AddressInfo;
        this.port = address.port;
        console.error(`🔐 Desktop OAuth server listening on http://127.0.0.1:${this.port}`);
        resolve(this.port);
      });
    });
  }

  /**
   * Stop the OAuth callback server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          console.error('Error stopping OAuth callback server:', error);
          reject(error);
        } else {
          console.error('✅ Desktop OAuth server stopped');
          this.server = null;
          this.port = 0;
          resolve();
        }
      });
    });
  }

  /**
   * Get the callback URL for this server
   */
  getCallbackUrl(): string {
    if (!this.server || this.port === 0) {
      throw new Error('OAuth callback server is not running');
    }
    return `http://127.0.0.1:${this.port}/callback`;
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.port !== 0;
  }

  /**
   * Wait for OAuth callback
   */
  async waitForCallback(expectedState?: string, timeoutMs: number = 300000): Promise<OAuthCallbackResult> {
    if (this.callbackPromise) {
      throw new Error('Already waiting for OAuth callback');
    }

    this.callbackPromise = new Promise((resolve, reject) => {
      this.callbackResolve = resolve;
      this.callbackReject = reject;

      // Set timeout
      setTimeout(() => {
        if (this.callbackReject) {
          this.callbackReject(new Error('OAuth callback timeout after 5 minutes'));
          this.callbackPromise = null;
          this.callbackResolve = null;
          this.callbackReject = null;
        }
      }, timeoutMs);
    });

    try {
      const result = await this.callbackPromise;
      
      // Validate state parameter if provided
      if (expectedState && result.state !== expectedState) {
        throw new Error(`OAuth state mismatch. Expected: ${expectedState}, Received: ${result.state}`);
      }

      return result;
    } finally {
      this.callbackPromise = null;
      this.callbackResolve = null;
      this.callbackReject = null;
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '', `http://127.0.0.1:${this.port}`);
    
    console.error(`📥 OAuth callback request: ${req.method} ${url.pathname}`);

    if (url.pathname === '/callback') {
      this.handleOAuthCallback(url, res);
    } else if (url.pathname === '/health') {
      this.handleHealthCheck(res);
    } else {
      this.handleNotFound(res);
    }
  }

  /**
   * Handle OAuth callback
   */
  private handleOAuthCallback(url: URL, res: ServerResponse): void {
    const params = url.searchParams;
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    console.error(`🔄 OAuth callback received:`, {
      hasCode: !!code,
      hasState: !!state,
      hasError: !!error,
      state: state?.substring(0, 20) + '...'
    });

    // Send response to browser
    if (error) {
      this.sendErrorResponse(res, error, errorDescription);
    } else if (code) {
      this.sendSuccessResponse(res);
    } else {
      this.sendErrorResponse(res, 'invalid_request', 'Missing authorization code');
    }

    // Resolve callback promise
    if (this.callbackResolve) {
      this.callbackResolve({
        code: code || undefined,
        state: state || undefined,
        error: error || undefined,
        error_description: errorDescription || undefined
      });
    }
  }

  /**
   * Handle health check
   */
  private handleHealthCheck(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      server: 'MCP Gas Desktop OAuth',
      port: this.port 
    }));
  }

  /**
   * Handle 404 not found
   */
  private handleNotFound(res: ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>OAuth Server - Not Found</title></head>
        <body>
          <h1>404 - Not Found</h1>
          <p>OAuth callback server is running on port ${this.port}</p>
          <p>Valid endpoints: /callback, /health</p>
        </body>
      </html>
    `);
  }

  /**
   * Send success response to browser
   */
  private sendSuccessResponse(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Success</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; background: #f5f5f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .success-icon { font-size: 48px; color: #4CAF50; margin-bottom: 20px; }
            h1 { color: #333; margin-bottom: 10px; }
            p { color: #666; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Authentication Successful</h1>
            <p>You have successfully authenticated with Google Apps Script.</p>
            <p>You can now close this browser tab and return to your application.</p>
          </div>
          <script>
            // Auto-close tab after 3 seconds
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
  }

  /**
   * Send error response to browser
   */
  private sendErrorResponse(res: ServerResponse, error: string, description?: string | null): void {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Error</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; background: #f5f5f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .error-icon { font-size: 48px; color: #f44336; margin-bottom: 20px; }
            h1 { color: #333; margin-bottom: 10px; }
            p { color: #666; margin-bottom: 20px; }
            .error-code { background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Authentication Failed</h1>
            <p>There was a problem with the authentication process.</p>
            <div class="error-code">
              <strong>Error:</strong> ${error}<br>
              ${description ? `<strong>Description:</strong> ${description}` : ''}
            </div>
            <p>Please try again or check your configuration.</p>
          </div>
        </body>
      </html>
    `);
  }
} 
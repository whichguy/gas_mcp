/**
 * Tool for setting up Google Apps Script project for HTTP proxy functionality
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { AuthenticationError, ValidationError } from '../errors/mcpErrors.js';
import { AUTH_MESSAGES } from '../constants/authMessages.js';

export class GASProxySetupTool extends BaseTool {
  public name = 'gas_proxy_setup';
  public description = 'Set up Google Apps Script project for HTTP proxy functionality with doGet handler';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID'
      },
      webAppUrl: {
        type: 'string', 
        description: 'Optional: existing web app URL to verify',
        default: null
      },
      deploy: {
        type: 'boolean',
        description: 'Whether to create deployment',
        default: true
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['scriptId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const scriptId = this.validate.scriptId(params.scriptId, 'proxy setup');
    const webAppUrl = params.webAppUrl || null;
    const deploy = params.deploy !== false;
    
    let accessToken: string;
    try {
      accessToken = await this.getAuthToken(params);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(AUTH_MESSAGES.PROXY_AUTH_REQUIRED);
    }

    try {
      // Get current project structure
      const files = await this.gasClient.getProjectContent(scriptId, accessToken);
      
      // Check if proxy setup already exists
      const hasDoGet = files.some(file => 
        file.source?.includes('function doGet') || 
        file.source?.includes('doGet(')
      );

      if (hasDoGet && !deploy) {
        return {
          status: 'already_configured',
          scriptId,
          message: 'Project already has doGet handler configured',
          existingFiles: files.map(f => f.name),
          recommendation: 'Set deploy=true to create/update deployment'
        };
      }

      // Generate proxy code
      const proxyCode = this.generateProxyCode();
      
      // Update project with proxy files
      const proxyFile = {
        name: 'proxy_handler.gs',
        type: 'SERVER_JS' as const,
        source: proxyCode
      };

      // Add or update proxy file
      const existingFiles = files.filter(f => f.name !== 'proxy_handler.gs');
      const updatedFiles = [proxyFile, ...existingFiles];

      await this.gasClient.updateProjectContent(scriptId, updatedFiles, accessToken);

      let deployment = null;
      if (deploy) {
        try {
          // Create deployment with USER_ACCESSING for proper user context
          deployment = await this.gasClient.createDeployment(
            scriptId,
            'HTTP Proxy Deployment',
            {
              entryPointType: 'WEB_APP',
              accessLevel: 'MYSELF',
              webAppConfig: {
                access: 'MYSELF',
                executeAs: 'USER_ACCESSING'
              }
            },
            undefined,
            accessToken
          );
        } catch (deployError: any) {
          console.warn(`Deployment creation failed: ${deployError.message}`);
          // Continue without deployment
        }
      }

      return {
        status: 'success',
        scriptId,
        configured: true,
        proxyFile: 'proxy_handler.gs',
        deployment: deployment ? {
          deploymentId: deployment.deploymentId,
          webAppUrl: deployment.webAppUrl,
          versionNumber: deployment.versionNumber
        } : null,
        instructions: deployment?.webAppUrl ? [
          'Proxy setup complete!',
          `Web App URL: ${deployment.webAppUrl}`,
          'You can now make HTTP requests to this URL',
          'Parameters will be forwarded to your doGet handler'
        ] : [
          'Proxy files uploaded successfully',
          'Manual deployment required to get web app URL',
          'Deploy via Apps Script console for production use'
        ]
      };

    } catch (error: any) {
      if (error.status === 404) {
        throw new ValidationError('scriptId', scriptId, 'valid Google Apps Script project ID');
      }
      
      if (error.status === 403) {
        throw new AuthenticationError(
          'Permission denied. Ensure you have edit access to the script and proper OAuth scopes.'
        );
      }

      throw error;
    }
  }

  private generateProxyCode(): string {
    return `
/**
 * HTTP Proxy Handler for Google Apps Script
 * Handles incoming HTTP requests and provides proxy functionality
 */

function doGet(e) {
  try {
    // Log incoming request
    console.log('Proxy request received:', {
      parameters: e.parameter,
      timestamp: new Date().toISOString()
    });

    // Get request parameters
    const params = e.parameter || {};
    
    // Default response
    const response = {
      status: 'success',
      timestamp: new Date().toISOString(),
      message: 'HTTP Proxy is working',
      receivedParameters: params,
      instructions: [
        'This is a basic HTTP proxy handler',
        'Customize this function for your specific needs',
        'Parameters are available in the e.parameter object'
      ]
    };

    // Return JSON response
    return ContentService
      .createTextOutput(JSON.stringify(response, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('Proxy error:', error);
    
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'error',
        message: error.toString(),
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  // Handle POST requests similarly to GET
  return doGet(e);
}

/**
 * Test function to verify proxy setup
 */
function testProxy() {
  const mockEvent = {
    parameter: {
      test: 'value',
      timestamp: new Date().toISOString()
    }
  };
  
  return doGet(mockEvent);
}
`;
  }
} 
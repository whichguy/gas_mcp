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
      
      // Check if __mcp_gas_run exists (the proper proxy handler)
      const hasMcpGasRun = files.some(file => 
        file.name === '__mcp_gas_run' && (
          file.source?.includes('function doGet') || 
          file.source?.includes('doGet(')
        )
      );

      if (hasMcpGasRun && !deploy) {
        return {
          status: 'already_configured',
          scriptId,
          message: 'Project already has __mcp_gas_run doGet handler configured',
          existingFiles: files.map(f => f.name),
          proxyFile: '__mcp_gas_run',
          recommendation: 'Set deploy=true to create/update deployment'
        };
      }

      // Don't create redundant proxy_handler.gs - __mcp_gas_run provides all functionality
      if (!hasMcpGasRun) {
        return {
          status: 'error',
          scriptId,
          message: 'Project missing __mcp_gas_run file. This file should be created automatically by gas_run tool.',
          existingFiles: files.map(f => f.name),
          recommendation: 'Use gas_run tool which automatically creates __mcp_gas_run with proper doGet handler'
        };
      }

      let deployment = null;
      let gasRunUrl = null;
      
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

          // Get the Google web app URL and convert to gas_run format
          if (deployment && deployment.webAppUrl) {
            gasRunUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
            console.log(`🌐 Google Web App URL: ${deployment.webAppUrl}`);
            console.log(`🔧 Gas_run URL (replaced /exec with /dev): ${gasRunUrl}`);
          }
        } catch (deployError: any) {
          console.warn(`Deployment creation failed: ${deployError.message}`);
          // Continue without deployment
        }
      }

      // If no deployment was created or no URL available, try to find existing deployment
      if (!gasRunUrl) {
        try {
          const deployments = await this.gasClient.listDeployments(scriptId, accessToken);
          const foundDeployment = deployments.find(d => 
            d.entryPoints?.some(ep => ep.entryPointType === 'WEB_APP')
          );
          
          if (foundDeployment) {
            const webAppEntry = foundDeployment.entryPoints?.find(ep => ep.entryPointType === 'WEB_APP');
            const googleWebAppUrl = (webAppEntry as any)?.webApp?.url;
            
            if (googleWebAppUrl) {
              gasRunUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
              console.log(`🌐 Using existing Google Web App URL: ${googleWebAppUrl}`);
              console.log(`🔧 Gas_run URL (replaced /exec with /dev): ${gasRunUrl}`);
            }
          }
        } catch (listError: any) {
          console.warn(`Could not find existing deployments: ${listError.message}`);
        }
      }
      
      return {
        status: 'success',
        scriptId,
        configured: true,
        proxyFile: '__mcp_gas_run',
        deployment: deployment ? {
          deploymentId: deployment.deploymentId,
          webAppUrl: gasRunUrl, // Use gas_run URL format  
          versionNumber: deployment.versionNumber
        } : null,
        instructions: gasRunUrl ? [
          'Proxy setup complete!',
          `Web App URL: ${gasRunUrl}`,
          'Using existing __mcp_gas_run for doGet handler',
          'You can now make HTTP requests to this URL',
          'Note: This URL is compatible with gas_run tool'
        ] : [
          'Proxy setup complete!',
          'Using existing __mcp_gas_run for doGet handler',
          'No web app deployment found - use deploy=true to create one',
          'Note: Compatible with gas_run tool once deployed'
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
} 
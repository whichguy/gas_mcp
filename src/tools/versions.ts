import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * Get details of a specific version of a script project
 */
export class VersionGetTool extends BaseTool {
  public name = 'version_get';
  public description = '[DEPLOY] Get details of a specific version of a script project. Examine specific code versions and their metadata.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      versionNumber: {
        type: 'number',
        description: 'Version number to retrieve. Get this from version_list or deploy_list responses.',
        minimum: 1,
        llmHints: {
          obtaining: 'Use version_list to see all available version numbers',
          sequential: 'Version numbers are sequential integers starting from 1',
          latest: 'Higher numbers represent more recent versions'
        }
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'versionNumber'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Review specific version before deployment | Compare multiple versions',
      workflow: 'version_list → select versionNumber → version_get → deploy_create'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'version retrieval');
    const versionNumber = this.validate.number(params.versionNumber, 'versionNumber', 'version retrieval', 1);

    return await this.handleApiCall(
      () => this.gasClient.getVersion(scriptId, versionNumber, accessToken),
      'get version details',
      { scriptId, versionNumber }
    );
  }
}

/**
 * List all versions of a script project
 */
export class VersionListTool extends BaseTool {
  public name = 'version_list';
  public description = '[DEPLOY] List all versions of a script project. See version history and select versions for deployment or comparison.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      pageSize: {
        type: 'number',
        description: 'Maximum number of versions to return (default: 50). Use larger values to see complete version history.',
        minimum: 1,
        default: 50,
        llmHints: {
          complete: 'Use 50 to see all versions in most cases',
          recent: 'Use smaller values (10-20) to see only recent versions',
          performance: 'Larger values may be slower for projects with many versions'
        }
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional). Include token from previous response to get next page.',
        llmHints: {
          workflow: 'Get this from previous version_list response.nextPageToken',
          iteration: 'Keep calling with pageToken until nextPageToken is null'
        }
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'View version history | Select version for deployment',
      workflow: 'version_list → version_get (detail) → deploy_create (deploy specific version)'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'version listing');
    const pageSize = params.pageSize ? this.validate.number(params.pageSize, 'pageSize', 'version listing', 1, 50) : 50;
    const pageToken = params.pageToken ? this.validate.string(params.pageToken, 'pageToken', 'version listing') : undefined;

    return await this.handleApiCall(
      () => this.gasClient.listVersions(scriptId, pageSize, pageToken, accessToken),
      'list versions',
      { scriptId, pageSize, pageToken }
    );
  }
} 
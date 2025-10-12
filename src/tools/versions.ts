import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * Get details of a specific version of a script project
 */
export class VersionGetTool extends BaseTool {
  public name = 'version_get';
  public description = 'Get details of a specific version of a script project. Examine specific code versions and their metadata.';
  
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
    llmWorkflowGuide: {
      prereq: 'auth→start | scriptId | version exists (version_list)',
      limits: 'immutable snapshots | 50-100 typical limit | metadata only (use cat for content)',
      usage: 'review: version_get({scriptId,versionNumber}) | compare: multiple version_get | deploy: verify before deploy',
      errors: 'AuthenticationError: auth→start | ScriptNotFound: verify scriptId | VersionNotFound: version_list',
      return: 'versionNumber | description | createTime | fileCount'
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
  public description = 'List all versions of a script project. See version history and select versions for deployment or comparison.';
  
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
    llmWorkflowGuide: {
      prereq: 'auth→start | scriptId',
      limits: 'pageSize+pageToken pagination | reverse chronological | metadata only (version_get for detail)',
      usage: 'history: version_list({scriptId}) | deploy: select for deploy_create | compare: identify→compare',
      errors: 'AuthenticationError: auth→start | ScriptNotFound: verify scriptId | NoVersions: version_create',
      return: 'versions[] | totalCount | nextPageToken',
      next: 'version_get for detail | deploy_create with versionNumber'
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
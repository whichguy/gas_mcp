import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * Get details of a specific version of a script project
 */
export class VersionGetTool extends BaseTool {
  public name = 'version_get';
  public description = 'Get details of a specific version of a script project. LLM USE: Examine specific code versions and their metadata.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      versionNumber: {
        type: 'number',
        description: 'Version number to retrieve. LLM USE: Get this from version_list or deploy_list responses.',
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
      prerequisites: ['1.auth→start if needed', '2.scriptId from project_create|ls', '3.version exists (version_list)'],
      scriptTypeCompatibility: {standalone: 'Full Support', containerBound: 'Full Support', notes: 'Universal version mgmt'},
      limitations: {versionCreation: 'immutable snapshots→no edit after', versionLimit: 'account-dependent (50-100 typical)', fileContentAccess: 'metadata only→cat for content'},
      useCases: {codeReview: 'version_get({scriptId,versionNumber:5})', comparison: 'multiple version_get→compare', deployment: 'version_get→verify before deploy'},
      errorHandling: {AuthenticationError: 'auth→start first', ScriptNotFound: 'verify scriptId correct+accessible', VersionNotFound: 'version_list→see available'},
      returnValue: {versionNumber: 'requested version num', description: 'version description/changelog', createTime: 'creation timestamp', fileCount: 'file count in version'}
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
  public description = 'List all versions of a script project. LLM USE: See version history and select versions for deployment or comparison.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      pageSize: {
        type: 'number',
        description: 'Maximum number of versions to return (default: 50). LLM RECOMMENDATION: Use larger values to see complete version history.',
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
        description: 'Token for pagination (optional). LLM USE: Include token from previous response to get next page.',
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
      prerequisites: ['1.auth→start if needed', '2.scriptId from project_create|ls'],
      scriptTypeCompatibility: {standalone: 'Full Support', containerBound: 'Full Support', notes: 'Universal version listing'},
      limitations: {pagination: 'pageSize per call→pageToken for more', sortOrder: 'reverse chronological (newest first)', metadataOnly: 'metadata only→version_get for detail'},
      useCases: {history: 'version_list({scriptId})', deployment: 'version_list→select for deploy_create', comparison: 'version_list→identify versions→compare'},
      errorHandling: {AuthenticationError: 'auth→start first', ScriptNotFound: 'verify scriptId correct+accessible', NoVersions: 'no saved versions→version_create'},
      returnValue: {versions: 'Array: version objects+nums+metadata', totalCount: 'total versions count', nextPageToken: 'token if more exist'},
      nextSteps: ['version_get→examine detail', 'deploy_create with versionNumber→deploy']
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
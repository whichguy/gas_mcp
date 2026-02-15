/**
 * Unified project health dashboard tool
 *
 * Returns aggregated status across auth, project, git, deployments, locks,
 * cache, and sync in a single call - replacing 4+ separate tool invocations.
 */

import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import os from 'os';

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { LockManager } from '../utils/lockManager.js';
import { execGitCommand } from '../utils/gitCommands.js';
import { getCachedGASMetadata } from '../utils/gasMetadataCache.js';
import { LocalFileManager } from '../utils/localFileManager.js';

const ENV_TAGS = {
  dev: '[DEV]',
  staging: '[STAGING]',
  prod: '[PROD]'
} as const;

type Section = 'auth' | 'project' | 'git' | 'deploy' | 'locks' | 'cache' | 'sync';

const ALL_SECTIONS: Section[] = ['auth', 'project', 'git', 'deploy', 'locks', 'cache', 'sync'];

export class StatusTool extends BaseTool {
  public name = 'status';
  public description = '[STATUS] Project health dashboard — shows sync state, lock status, git branch, uncommitted changes, and deployment info. WHEN: diagnosing issues or checking overall project state. Example: status({scriptId})';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      sections: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['auth', 'project', 'git', 'deploy', 'locks', 'cache', 'sync']
        },
        description: 'Optional filter for specific sections. Returns all if omitted.'
      }
    },
    required: ['scriptId'],
    additionalProperties: false
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    const scriptId = this.validate.scriptId(params.scriptId, 'status check');
    const sections: Section[] = params.sections && params.sections.length > 0
      ? params.sections
      : ALL_SECTIONS;

    const shouldInclude = (section: Section) => sections.includes(section);

    const result: any = {
      scriptId,
      timestamp: new Date().toISOString()
    };

    // Run independent sections in parallel where possible
    const promises: Promise<void>[] = [];

    if (shouldInclude('auth')) {
      promises.push(
        this.getAuthSection().then(v => { result.auth = v; }).catch(e => {
          result.auth = { authenticated: false, error: (e as Error).message };
        })
      );
    }

    if (shouldInclude('project')) {
      promises.push(
        this.getProjectSection(scriptId, accessToken).then(v => { result.project = v; }).catch(e => {
          result.project = { error: (e as Error).message };
        })
      );
    }

    if (shouldInclude('git')) {
      promises.push(
        this.getGitSection(scriptId).then(v => { result.git = v; }).catch(e => {
          result.git = { detected: false, error: (e as Error).message };
        })
      );
    }

    if (shouldInclude('deploy')) {
      promises.push(
        this.getDeploySection(scriptId, accessToken).then(v => { result.deployments = v; }).catch(e => {
          result.deployments = { error: (e as Error).message };
        })
      );
    }

    if (shouldInclude('locks')) {
      promises.push(
        this.getLocksSection(scriptId).then(v => { result.locks = v; }).catch(e => {
          result.locks = { error: (e as Error).message };
        })
      );
    }

    if (shouldInclude('cache')) {
      promises.push(
        this.getCacheSection(scriptId).then(v => { result.cache = v; }).catch(e => {
          result.cache = { error: (e as Error).message };
        })
      );
    }

    if (shouldInclude('sync')) {
      promises.push(
        this.getSyncSection(scriptId, accessToken).then(v => { result.sync = v; }).catch(e => {
          result.sync = { error: (e as Error).message };
        })
      );
    }

    await Promise.all(promises);

    return result;
  }

  // --- Section implementations ---

  private async getAuthSection(): Promise<any> {
    const status = await this.getAuthStatus();
    return {
      authenticated: status.authenticated,
      email: status.user?.email,
      tokenValid: status.tokenValid,
      expiresIn: status.expiresIn
    };
  }

  private async getProjectSection(scriptId: string, accessToken?: string): Promise<any> {
    const metadata = await this.gasClient.getProjectMetadata(scriptId, accessToken);
    let lastModified: string | undefined;
    if (metadata.length > 0) {
      const times = metadata
        .map((f: any) => f.updateTime)
        .filter(Boolean)
        .map((t: string) => new Date(t).getTime());
      if (times.length > 0) {
        lastModified = new Date(Math.max(...times)).toISOString();
      }
    }
    return {
      scriptId,
      fileCount: metadata.length,
      lastModified
    };
  }

  private async getGitSection(scriptId: string): Promise<any> {
    const repoPath = LocalFileManager.resolveProjectPath(scriptId);

    if (!existsSync(repoPath)) {
      return { detected: false };
    }

    const gitDir = path.join(repoPath, '.git');
    if (!existsSync(gitDir)) {
      return { detected: false, repoPath };
    }

    // Get branch name using spawn (secure)
    let branch: string | undefined;
    try {
      const branchOutput = await execGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
      branch = branchOutput.trim();
      if (branch === 'HEAD') branch = undefined; // detached HEAD
    } catch {
      // git command failed
    }

    // Get uncommitted changes using spawn
    let uncommittedChanges: { count: number; files: string[] } | undefined;
    try {
      const statusOutput = await execGitCommand(['status', '--porcelain'], repoPath);
      const lines = statusOutput.trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        uncommittedChanges = {
          count: lines.length,
          files: lines.map(l => l.slice(3)) // Remove status prefix (e.g., " M ")
        };
      }
    } catch {
      // git command failed
    }

    return {
      detected: true,
      repoPath,
      branch,
      uncommittedChanges
    };
  }

  private async getDeploySection(scriptId: string, accessToken?: string): Promise<any> {
    const deployments = await this.gasClient.listDeployments(scriptId, accessToken);

    const dev = deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.dev));
    const staging = deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.staging));
    const prod = deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.prod));

    const formatEnv = (d: any) => {
      if (!d) return null;
      const webEp = d.entryPoints?.find((ep: any) => ep.entryPointType === 'WEB_APP');
      return {
        deploymentId: d.deploymentId,
        versionNumber: d.versionNumber ?? null,
        description: d.description,
        url: webEp?.webApp?.url || null,
        updateTime: d.updateTime
      };
    };

    return {
      totalDeployments: deployments.length,
      dev: formatEnv(dev),
      staging: formatEnv(staging),
      prod: formatEnv(prod)
    };
  }

  private async getLocksSection(scriptId: string): Promise<any> {
    const lockManager = LockManager.getInstance();
    const lockStatus = await lockManager.getLockStatus(scriptId);
    const metrics = lockManager.getMetrics();

    return {
      held: lockStatus.locked,
      info: lockStatus.info || undefined,
      metrics: {
        currentlyHeld: metrics.currentlyHeld,
        staleRemoved: metrics.staleRemoved,
        contentions: metrics.contentions,
        timeouts: metrics.timeouts
      }
    };
  }

  private async getCacheSection(scriptId: string): Promise<any> {
    const syncFolder = LocalFileManager.resolveProjectPath(scriptId);

    if (!existsSync(syncFolder)) {
      return { entries: 0, syncFolderExists: false };
    }

    // Count files that have cached xattr metadata
    let entries = 0;
    let totalFiles = 0;
    try {
      const files = await readdir(syncFolder);
      const codeFiles = files.filter(f =>
        f.endsWith('.gs') || f.endsWith('.html') || f.endsWith('.json')
      );
      totalFiles = codeFiles.length;

      for (const file of codeFiles) {
        const filePath = path.join(syncFolder, file);
        try {
          const meta = await getCachedGASMetadata(filePath);
          if (meta) entries++;
        } catch {
          // xattr not available or file issue
        }
      }
    } catch {
      // readdir failed
    }

    return {
      entries,
      totalLocalFiles: totalFiles,
      syncFolderExists: true
    };
  }

  private async getSyncSection(scriptId: string, accessToken?: string): Promise<any> {
    const syncFolder = LocalFileManager.resolveProjectPath(scriptId);

    if (!existsSync(syncFolder)) {
      return { status: 'no_local_repo', message: 'No local sync folder found' };
    }

    // Dynamic import to avoid loading sync checker unless needed
    const { checkSyncStatus } = await import('../utils/syncStatusChecker.js');

    // Get remote files with content for hash comparison
    const remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    const { summary } = await checkSyncStatus(scriptId, remoteFiles, {
      excludeSystemFiles: true
    });

    let status: string;
    if (summary.stale === 0 && summary.remoteOnly === 0 && summary.localOnly === 0) {
      status = 'in_sync';
    } else if (summary.stale > 0 || summary.remoteOnly > 0) {
      status = 'drift_detected';
    } else {
      status = 'local_additions';
    }

    return {
      status,
      summary
    };
  }
}

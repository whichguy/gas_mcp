/**
 * GitProjectManager - Manages git configuration files across multiple projects
 *
 * Supports .git/ folders at any path level with native format preservation
 */

import { GitFormatTranslator, type GitFileFormat } from './GitFormatTranslator.js';
import { parseINI, serializeINI, parseAttributes, parseRef } from './iniParser.js';
import { GASClient } from '../api/gasClient.js';
import { fileNameMatches } from '../api/pathParser.js';
import * as GitUtils from './GitUtilities.js';

export interface GitProject {
  prefix: string;           // e.g., 'foo/bar' or '' for root
  files: Map<string, GitFileFormat>;  // git-relative paths -> content
}

export interface GitConfigData {
  core?: {
    repositoryformatversion?: number;
    filemode?: boolean;
    bare?: boolean;
    ignorecase?: boolean;
    [key: string]: any;
  };
  remote?: {
    [name: string]: {
      url?: string;
      fetch?: string;
      [key: string]: any;
    };
  };
  branch?: {
    [name: string]: {
      remote?: string;
      merge?: string;
      [key: string]: any;
    };
  };
  user?: {
    name?: string;
    email?: string;
    [key: string]: any;
  };
  [section: string]: any;
}

export class GitProjectManager {
  private gasClient: GASClient;

  constructor() {
    this.gasClient = new GASClient();
  }

  /**
   * Load all git projects from GAS - with strict validation
   */
  async loadAllGitProjects(scriptId: string, accessToken: string): Promise<Map<string, GitProject>> {
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Strict filtering - only files actually inside .git/ folders
    const gitFiles = files.filter(f => GitUtils.isGitConfigFile(f.name));

    // Group by project prefix
    const projects = new Map<string, GitProject>();

    for (const file of gitFiles) {
      const prefix = GitUtils.getProjectPrefix(file.name);
      const gitPath = GitUtils.getGitRelativePath(file.name);

      // Skip if we couldn't extract valid paths
      if (prefix === null || gitPath === null) {
        console.warn(`Skipping invalid git file: ${file.name}`);
        continue;
      }

      if (!projects.has(prefix)) {
        projects.set(prefix, {
          prefix,
          files: new Map()
        });
      }

      const nativeContent = GitFormatTranslator.fromGAS(file.source || '');
      projects.get(prefix)!.files.set(gitPath, {
        format: GitUtils.detectGitFileFormat(gitPath),
        raw: nativeContent,
        parsed: this.parseContent(nativeContent, gitPath)
      });
    }

    return projects;
  }

  /**
   * Get git config for a specific project
   */
  async getProjectConfig(
    scriptId: string,
    accessToken: string,
    projectPath: string = ''
  ): Promise<GitConfigData | null> {
    const configPath = projectPath
      ? `${projectPath}/.git/config`
      : '.git/config';

    try {
      const files = await this.gasClient.getProjectContent(scriptId, accessToken);

      // Use extension-agnostic matching to find .git/config with or without .gs extension
      const file = files.find(f => fileNameMatches(f.name, configPath));

      if (!file) return null;

      const content = GitFormatTranslator.fromGAS(file.source || '');
      return parseINI(content) as GitConfigData;
    } catch (error) {
      console.error(`Failed to get git config for ${projectPath}:`, error);
      return null;
    }
  }

  /**
   * Save a git file with proper project path
   */
  async saveGitFile(
    scriptId: string,
    accessToken: string,
    projectPath: string,
    gitRelativePath: string,
    content: string
  ): Promise<void> {
    const fullPath = projectPath 
      ? `${projectPath}/.git/${gitRelativePath}`
      : `.git/${gitRelativePath}`;
    
    // Validate it's a proper git path
    if (!fullPath.includes('.git/')) {
      throw new Error(`Invalid git file path: ${fullPath} - must be inside .git/ folder`);
    }
    
    // GAS API automatically adds .gs extension for SERVER_JS files, so don't append it manually
    const gasPath = fullPath;

    // Validate the path structure (will check with .gs appended since that's what GAS creates)
    const expectedGasPath = fullPath.endsWith('.gs') ? fullPath : fullPath + '.gs';
    if (!GitUtils.isGitConfigFile(expectedGasPath)) {
      throw new Error(`Path validation failed: ${expectedGasPath} is not a valid git config file`);
    }
    
    const gasContent = GitFormatTranslator.toGAS(content, gasPath);
    
    await this.gasClient.updateFile(
      scriptId,
      gasPath,
      gasContent,
      undefined,
      accessToken,
      'SERVER_JS'
    );
  }

  /**
   * Update an existing git config with new values
   */
  async updateProjectConfig(
    scriptId: string,
    accessToken: string,
    projectPath: string,
    updates: Partial<GitConfigData>
  ): Promise<void> {
    // Get existing config
    const existingConfig = await this.getProjectConfig(scriptId, accessToken, projectPath);
    if (!existingConfig) {
      throw new Error(`No git config found for project path: ${projectPath || '(root)'}`);
    }
    
    // Deep merge the updates
    const mergedConfig = this.deepMerge(existingConfig, updates);
    
    // Save back to GAS
    const iniContent = serializeINI(mergedConfig);
    await this.saveGitFile(scriptId, accessToken, projectPath, 'config', iniContent);
  }
  
  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Create a default .git/config file for a new project
   */
  async initGitConfig(
    scriptId: string,
    accessToken: string,
    projectPath: string,
    repository: string,
    branch: string = 'main',
    localPath?: string
  ): Promise<void> {
    const config: GitConfigData = {
      core: {
        repositoryformatversion: 0,
        filemode: true,
        bare: false,
        ignorecase: true
      },
      remote: {
        origin: {
          url: repository,
          fetch: '+refs/heads/*:refs/remotes/origin/*'
        }
      },
      branch: {
        [branch]: {
          remote: 'origin',
          merge: `refs/heads/${branch}`
        }
      }
    };

    // Add custom sync section for GAS-specific settings
    (config as any).sync = {
      localPath: localPath || `~/gas-repos/project-${scriptId}`,
      branch: branch,
      autoCommit: true,
      mergeStrategy: 'merge',
      includeReadme: true
    };

    const iniContent = serializeINI(config);
    await this.saveGitFile(scriptId, accessToken, projectPath, 'config', iniContent);
  }

  /**
   * Get or create default exclude patterns
   */
  async getExcludePatterns(
    scriptId: string,
    accessToken: string,
    projectPath: string
  ): Promise<string[]> {
    const excludePath = projectPath
      ? `${projectPath}/.git/info/exclude`
      : '.git/info/exclude';
    
    try {
      const files = await this.gasClient.getProjectContent(scriptId, accessToken);
      const file = files.find(f => fileNameMatches(f.name, excludePath));

      if (file) {
        const content = GitFormatTranslator.fromGAS(file.source || '');
        return content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      }
    } catch (error) {
      console.error('Failed to get exclude patterns:', error);
    }
    
    // Return default patterns if file doesn't exist
    return [
      '.vscode/',
      '*.local.gs',
      'debug.log',
      'test-*.gs'
    ];
  }

  /**
   * Parse content based on git-relative path
   */
  private parseContent(content: string, gitPath: string): any {
    const format = GitUtils.detectGitFileFormat(gitPath);
    
    switch (format) {
      case 'ini':
        return parseINI(content);
      case 'gitignore':
        return content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      case 'attributes':
        return parseAttributes(content);
      case 'ref':
        return parseRef(content);
      case 'json':
        try {
          return JSON.parse(content);
        } catch {
          return null;
        }
      default:
        return null;
    }
  }

  /**
   * List all git projects in a GAS project
   */
  async listGitProjects(scriptId: string, accessToken: string): Promise<string[]> {
    const projects = await this.loadAllGitProjects(scriptId, accessToken);
    return Array.from(projects.keys()).map(prefix => prefix || '(root)');
  }

  /**
   * Check if a project has git configuration
   */
  async hasGitConfig(
    scriptId: string,
    accessToken: string,
    projectPath: string = ''
  ): Promise<boolean> {
    const configPath = projectPath
      ? `${projectPath}/.git/config`
      : '.git/config';
    
    try {
      const files = await this.gasClient.getProjectContent(scriptId, accessToken);
      return files.some(f => fileNameMatches(f.name, configPath));
    } catch {
      return false;
    }
  }
}
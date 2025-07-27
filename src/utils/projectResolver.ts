import * as fs from 'fs/promises';
import * as path from 'path';
import { ValidationError } from '../errors/mcpErrors.js';
import { GASClient } from '../api/gasClient.js';
import { McpGasConfigManager } from '../config/mcpGasConfig.js';

/**
 * Project configuration structure
 */
export interface ProjectConfig {
  projects: Record<string, {
    scriptId: string;
    name: string;
    description?: string;
  }>;
  environments?: {
    dev?: { scriptId: string; name: string; };
    staging?: { scriptId: string; name: string; };
    production?: { scriptId: string; name: string; };
  };
}

/**
 * Current project context
 */
export interface CurrentProject {
  projectName: string;
  scriptId: string;
  lastSync: string;
}

/**
 * Project resolver parameter types
 */
export type ProjectParam = string | { dev?: boolean; staging?: boolean; prod?: boolean; production?: boolean; };

/**
 * Utility class for resolving project names to script IDs
 * Handles .gas-projects.json and .gas-current.json configuration files
 */
export class ProjectResolver {
  private static readonly CONFIG_FILE = '.gas-projects.json';
  private static readonly CURRENT_FILE = '.gas-current.json';
  private static readonly SCRIPT_ID_PATTERN = /^[a-zA-Z0-9_-]{20,60}$/;
  
  /**
   * Get safe working directory (fallback to tmp if process.cwd() is unsafe)
   */
  private static getSafeWorkingDir(): string {
    try {
      const cwd = process.cwd();
      // Check if we're in root filesystem (unsafe)
      if (cwd === '/' || cwd === 'C:\\' || cwd === 'C:/') {
        return '/tmp/mcp-gas-workspace';
      }
      return cwd;
    } catch (error) {
      return '/tmp/mcp-gas-workspace';
    }
  }

  /**
   * Resolve project parameter to script ID
   * Supports: project names, environment shortcuts, direct script IDs, current project, remote title search
   */
  static async resolveScriptId(projectParam?: ProjectParam, workingDir: string = ProjectResolver.getSafeWorkingDir(), accessToken?: string): Promise<string> {
    if (!projectParam) {
      // No parameter = current project
      return await this.getCurrentScriptId(workingDir);
    }

    if (typeof projectParam === 'string') {
      // Check if it's a direct script ID (44 characters)
      if (this.SCRIPT_ID_PATTERN.test(projectParam)) {
        return projectParam;
      }

      // Check local project configuration first
      const config = await this.getProjectConfig(workingDir);
      if (config.projects[projectParam]) {
        return config.projects[projectParam].scriptId;
      }

      // If not found locally, try to resolve from remote GAS projects by title
      try {
        const gasClient = new GASClient();
        const remoteProjects = await gasClient.listProjects(50, accessToken);
        
        // Try exact title match first
        const exactMatch = remoteProjects.find(p => 
          p.title.toLowerCase() === projectParam.toLowerCase()
        );
        if (exactMatch) {
          return exactMatch.scriptId;
        }

        // Try fuzzy matching - find projects that contain the search term
        const fuzzyMatches = remoteProjects.filter(p => 
          p.title.toLowerCase().includes(projectParam.toLowerCase()) ||
          projectParam.toLowerCase().includes(p.title.toLowerCase())
        );

        if (fuzzyMatches.length === 1) {
          // Single fuzzy match found
          return fuzzyMatches[0].scriptId;
        } else if (fuzzyMatches.length > 1) {
          // Multiple matches - provide helpful error with options
          const matchNames = fuzzyMatches.map(p => `"${p.title}"`).join(', ');
          throw new ValidationError(
            'projectParam', 
            projectParam, 
            `unique project name. Found multiple matches: ${matchNames}. Use full title or script ID.`
          );
        }

        // No matches found
        throw new ValidationError(
          'projectParam', 
          projectParam, 
          'valid project name, title, or script ID. Use gas_ls to see available projects.'
        );
      } catch (error: any) {
        // If remote search fails (e.g., not authenticated), fall back to original error
        if (error instanceof ValidationError) {
          throw error;
        }
        throw new ValidationError('projectParam', projectParam, 'valid project name or script ID (remote search failed - check authentication)');
      }
    }

    if (typeof projectParam === 'object') {
      // Environment parameter shortcuts
      const config = await this.getProjectConfig(workingDir);
      
      if (projectParam.dev && config.environments?.dev) {
        return config.environments.dev.scriptId;
      }
      if (projectParam.staging && config.environments?.staging) {
        return config.environments.staging.scriptId;
      }
      if (projectParam.prod && config.environments?.production) {
        return config.environments.production.scriptId;
      }
      if (projectParam.production && config.environments?.production) {
        return config.environments.production.scriptId;
      }

      throw new ValidationError('projectParam', JSON.stringify(projectParam), 'valid environment (dev, staging, prod)');
    }

    throw new ValidationError('projectParam', String(projectParam), 'string or environment object');
  }

  /**
   * Get current project script ID from unified configuration
   */
  static async getCurrentScriptId(workingDir: string = ProjectResolver.getSafeWorkingDir()): Promise<string> {
    try {
      const currentProject = await McpGasConfigManager.getCurrentProject();
      if (!currentProject || !currentProject.scriptId) {
        throw new ValidationError('current project', 'not set', 'valid current project (use gas_project_set first)');
      }
      return currentProject.scriptId;
    } catch (error: any) {
      // If unified config fails, fall back to legacy file-based approach
      if (error instanceof ValidationError) {
        throw error;
      }
      
      console.error(`⚠️ [PROJECT_RESOLVER] Unified config failed, trying legacy approach: ${error.message}`);
      try {
        const currentPath = path.join(workingDir, this.CURRENT_FILE);
        const content = await fs.readFile(currentPath, 'utf-8');
        const current: CurrentProject = JSON.parse(content);
        return current.scriptId;
      } catch (legacyError) {
        throw new ValidationError('current project', 'not set', 'valid current project (use gas_project_set first)');
      }
    }
  }

  /**
   * Get current project info from unified configuration
   */
  static async getCurrentProject(workingDir: string = ProjectResolver.getSafeWorkingDir()): Promise<CurrentProject> {
    try {
      const currentProject = await McpGasConfigManager.getCurrentProject();
      if (!currentProject || !currentProject.scriptId || !currentProject.projectName) {
        throw new ValidationError('current project', 'not set', 'valid current project (use gas_project_set first)');
      }
      return {
        projectName: currentProject.projectName,
        scriptId: currentProject.scriptId,
        lastSync: currentProject.lastSync || new Date().toISOString()
      };
    } catch (error: any) {
      // If unified config fails, fall back to legacy file-based approach
      if (error instanceof ValidationError) {
        throw error;
      }
      
      console.error(`⚠️ [PROJECT_RESOLVER] Unified config failed, trying legacy approach: ${error.message}`);
      try {
        const currentPath = path.join(workingDir, this.CURRENT_FILE);
        const content = await fs.readFile(currentPath, 'utf-8');
        return JSON.parse(content);
      } catch (legacyError) {
        throw new ValidationError('current project', 'not set', 'valid current project (use gas_project_set first)');
      }
    }
  }

  /**
   * Set current project in unified configuration
   */
  static async setCurrentProject(projectName: string, scriptId: string, workingDir: string = ProjectResolver.getSafeWorkingDir()): Promise<void> {
    // Use unified configuration instead of separate files
    console.error(`🔧 [PROJECT_RESOLVER] Setting current project via unified config: ${projectName}`);
    await McpGasConfigManager.setCurrentProject(projectName, scriptId);
  }

  /**
   * Get project configuration from .gas-projects.json
   */
  static async getProjectConfig(workingDir: string = ProjectResolver.getSafeWorkingDir()): Promise<ProjectConfig> {
    try {
      const configPath = path.join(workingDir, this.CONFIG_FILE);
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // Return empty config if file doesn't exist
      return { projects: {} };
    }
  }

  /**
   * Save project configuration to .gas-projects.json
   */
  static async saveProjectConfig(config: ProjectConfig, workingDir: string = ProjectResolver.getSafeWorkingDir()): Promise<void> {
    const configPath = path.join(workingDir, this.CONFIG_FILE);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Add project to configuration
   */
  static async addProject(
    name: string, 
    scriptId: string, 
    description?: string, 
    workingDir: string = ProjectResolver.getSafeWorkingDir()
  ): Promise<void> {
    try {
      // Try unified configuration first
      console.error(`🔧 [PROJECT_RESOLVER] Attempting unified config for project: ${name}`);
      await McpGasConfigManager.addProject(name, scriptId, description);
      console.error(`✅ [PROJECT_RESOLVER] Successfully added to unified config`);
    } catch (unifiedError: any) {
      console.error(`⚠️ [PROJECT_RESOLVER] Unified config failed: ${unifiedError.message}`);
      console.error(`🔄 [PROJECT_RESOLVER] Falling back to legacy config...`);
      
      // Fall back to legacy method
      try {
        const config = await this.getProjectConfig(workingDir);
        
        config.projects[name] = {
          scriptId,
          name,
          description
        };

        await this.saveProjectConfig(config, workingDir);
        console.error(`✅ [PROJECT_RESOLVER] Successfully added to legacy config`);
      } catch (legacyError: any) {
        console.error(`❌ [PROJECT_RESOLVER] Both unified and legacy config failed`);
        throw new Error(`Failed to add project to configuration: unified config error: ${unifiedError.message}, legacy config error: ${legacyError.message}`);
      }
    }
  }

  /**
   * Get project name by script ID from unified configuration
   */
  static async getProjectNameByScriptId(scriptId: string, workingDir: string = ProjectResolver.getSafeWorkingDir()): Promise<string | null> {
    try {
      // Try unified configuration first
      const config = await McpGasConfigManager.getConfig();
      
      // Check regular projects
      if (config.projects) {
        for (const [name, project] of Object.entries(config.projects)) {
          if (project.scriptId === scriptId) {
            return name;
          }
        }
      }

      // Check environments
      if (config.environments) {
        for (const [env, project] of Object.entries(config.environments)) {
          if (project?.scriptId === scriptId) {
            return `${env} (environment)`;
          }
        }
      }

      return null;
    } catch (error: any) {
      console.error(`⚠️ [PROJECT_RESOLVER] Unified config failed, trying legacy approach: ${error.message}`);
      
      // Fall back to legacy method
      try {
        const config = await this.getProjectConfig(workingDir);
        
        for (const [name, project] of Object.entries(config.projects)) {
          if (project.scriptId === scriptId) {
            return name;
          }
        }

        // Check environments
        if (config.environments) {
          for (const [env, project] of Object.entries(config.environments)) {
            if (project?.scriptId === scriptId) {
              return `${env} (environment)`;
            }
          }
        }

        return null;
      } catch (legacyError) {
        return null; // Return null if both methods fail
      }
    }
  }

  /**
   * List all configured projects from unified configuration
   */
  static async listProjects(workingDir: string = ProjectResolver.getSafeWorkingDir()): Promise<Array<{name: string; scriptId: string; description?: string; type: string}>> {
    try {
      // Try unified configuration first
      const config = await McpGasConfigManager.getConfig();
      const results: Array<{name: string; scriptId: string; description?: string; type: string}> = [];

      // Add regular projects from unified config
      if (config.projects) {
        for (const [name, project] of Object.entries(config.projects)) {
          results.push({
            name,
            scriptId: project.scriptId,
            description: project.description,
            type: 'project'
          });
        }
      }

      // Add environments from unified config
      if (config.environments) {
        for (const [env, project] of Object.entries(config.environments)) {
          if (project) {
            results.push({
              name: env,
              scriptId: project.scriptId,
              description: project.name,
              type: 'environment'
            });
          }
        }
      }

      return results;
    } catch (error: any) {
      console.error(`⚠️ [PROJECT_RESOLVER] Unified config failed, trying legacy approach: ${error.message}`);
      
      // Fall back to legacy method
      try {
        const config = await this.getProjectConfig(workingDir);
        const results: Array<{name: string; scriptId: string; description?: string; type: string}> = [];

        // Add regular projects
        for (const [name, project] of Object.entries(config.projects)) {
          results.push({
            name,
            scriptId: project.scriptId,
            description: project.description,
            type: 'project'
          });
        }

        // Add environments
        if (config.environments) {
          for (const [env, project] of Object.entries(config.environments)) {
            if (project) {
              results.push({
                name: env,
                scriptId: project.scriptId,
                description: project.name,
                type: 'environment'
              });
            }
          }
        }

        return results;
      } catch (legacyError) {
        return []; // Return empty array if both methods fail
      }
    }
  }
} 
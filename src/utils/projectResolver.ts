import * as fs from 'fs/promises';
import * as path from 'path';
import { ValidationError } from '../errors/mcpErrors.js';

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
   * Resolve project parameter to script ID
   * Supports: project names, environment shortcuts, direct script IDs, current project
   */
  static async resolveProjectId(projectParam?: ProjectParam, workingDir: string = process.cwd()): Promise<string> {
    if (!projectParam) {
      // No parameter = current project
      return await this.getCurrentProjectId(workingDir);
    }

    if (typeof projectParam === 'string') {
      // Check if it's a direct script ID (44 characters)
      if (this.SCRIPT_ID_PATTERN.test(projectParam)) {
        return projectParam;
      }

      // Assume it's a project name - look it up
      const config = await this.getProjectConfig(workingDir);
      if (config.projects[projectParam]) {
        return config.projects[projectParam].scriptId;
      }

      throw new ValidationError('projectParam', projectParam, 'valid project name or script ID');
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
   * Get current project script ID from .gas-current.json
   */
  static async getCurrentProjectId(workingDir: string = process.cwd()): Promise<string> {
    try {
      const currentPath = path.join(workingDir, this.CURRENT_FILE);
      const content = await fs.readFile(currentPath, 'utf-8');
      const current: CurrentProject = JSON.parse(content);
      return current.scriptId;
    } catch (error) {
      throw new ValidationError('current project', 'not set', 'valid current project (use gas_project_set first)');
    }
  }

  /**
   * Get current project info from .gas-current.json
   */
  static async getCurrentProject(workingDir: string = process.cwd()): Promise<CurrentProject> {
    try {
      const currentPath = path.join(workingDir, this.CURRENT_FILE);
      const content = await fs.readFile(currentPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new ValidationError('current project', 'not set', 'valid current project (use gas_project_set first)');
    }
  }

  /**
   * Set current project in .gas-current.json
   */
  static async setCurrentProject(projectName: string, scriptId: string, workingDir: string = process.cwd()): Promise<void> {
    const current: CurrentProject = {
      projectName,
      scriptId,
      lastSync: new Date().toISOString()
    };

    const currentPath = path.join(workingDir, this.CURRENT_FILE);
    await fs.writeFile(currentPath, JSON.stringify(current, null, 2));
  }

  /**
   * Get project configuration from .gas-projects.json
   */
  static async getProjectConfig(workingDir: string = process.cwd()): Promise<ProjectConfig> {
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
  static async saveProjectConfig(config: ProjectConfig, workingDir: string = process.cwd()): Promise<void> {
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
    workingDir: string = process.cwd()
  ): Promise<void> {
    const config = await this.getProjectConfig(workingDir);
    
    config.projects[name] = {
      scriptId,
      name,
      description
    };

    await this.saveProjectConfig(config, workingDir);
  }

  /**
   * Get project name by script ID
   */
  static async getProjectNameByScriptId(scriptId: string, workingDir: string = process.cwd()): Promise<string | null> {
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
  }

  /**
   * List all configured projects
   */
  static async listProjects(workingDir: string = process.cwd()): Promise<Array<{name: string; scriptId: string; description?: string; type: string}>> {
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
  }
} 
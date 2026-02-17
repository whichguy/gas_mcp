import { promises as fs } from 'fs';
import path from 'path';
import type { WorktreesConfig, WorktreeLock } from '../types/worktreeTypes.js';

/**
 * Per-project environment consumer info (e.g., staging/prod spreadsheet + library bindings)
 */
export interface McpGasProjectEnvironment {
  consumerScriptId: string;
  spreadsheetId: string;
  libraryVersion: number;
}

/**
 * Environment configuration for a project's distribution targets
 */
export interface McpGasProjectEnvironments {
  staging?: McpGasProjectEnvironment;
  prod?: McpGasProjectEnvironment;
  templateScriptId?: string;
  templateSpreadsheetId?: string;
  userSymbol?: string;
}

/**
 * A single GAS project entry in the configuration
 */
export interface McpGasProject {
  scriptId: string;
  name: string;
  description?: string;
  environments?: McpGasProjectEnvironments;
}

/**
 * Unified MCP Gas Server Configuration
 * Consolidates OAuth, projects, current project, local root settings, and worktrees
 */
export interface McpGasConfig {
  // OAuth Configuration
  oauth: {
    client_id: string;
    type: 'uwp' | 'web';
    redirect_uris: string[];
    scopes: string[];
  };

  // Project Management
  projects: {
    [projectName: string]: McpGasProject;
  };

  // Current Active Project
  currentProject?: {
    projectName: string;
    scriptId: string;
    lastSync: string;
  };

  // Local Root Directory for Projects
  localRoot: {
    rootPath: string;
    lastUpdated: string;
  };

  // Server Configuration
  server: {
    defaultWorkingDir: string;
    configVersion: string;
    lastModified: string;
  };

  // Worktree Management (for parallel development)
  worktrees?: WorktreesConfig;
}

/**
 * Default configuration template
 */
const DEFAULT_CONFIG: McpGasConfig = {
  oauth: {
    // HARDCODED: Client ID is public and tied to the application
    client_id: "428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com",
    type: "uwp",
    redirect_uris: [
      "http://127.0.0.1/*",
      "http://localhost/*",
      // PRODUCTION: Support custom redirect URIs for different environments
      ...(process.env.MCP_GAS_REDIRECT_URIS ? process.env.MCP_GAS_REDIRECT_URIS.split(',') : [])
    ],
    scopes: [
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.processes",
      "https://www.googleapis.com/auth/script.deployments",
      "https://www.googleapis.com/auth/script.scriptapp",
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/script.webapp.deploy",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/forms",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile"
    ]
  },
  projects: {},
  localRoot: {
    // PRODUCTION-READY: Use ~/gas-repos for all projects (consistent with git sync)
    rootPath: process.env.MCP_GAS_PROJECTS_ROOT ||
      (process.platform === 'win32'
        ? path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'gas-repos')
        : path.join(process.env.HOME || '/var/lib/mcp-gas', 'gas-repos')),
    lastUpdated: new Date().toISOString()
  },
  server: {
    // PRODUCTION-READY: Use persistent workspace
    defaultWorkingDir: process.env.MCP_GAS_WORKSPACE || 
      (process.platform === 'win32' 
        ? path.join(process.env.USERPROFILE || 'C:\\Users\\Default', '.mcp-gas', 'workspace')
        : path.join(process.env.HOME || '/var/lib/mcp-gas', '.mcp-gas', 'workspace')),
    configVersion: "1.0.0",
    lastModified: new Date().toISOString()
  }
};

/**
 * Unified Configuration Manager
 */
export class McpGasConfigManager {
  private static readonly CONFIG_FILE = 'gas-config.json';
  private static configCache: McpGasConfig | null = null;
  private static configPath: string | null = null;

  /**
   * Get the configuration path (initializes if needed)
   */
  private static async getConfigPath(): Promise<string> {
    if (!McpGasConfigManager.configPath) {
      // Import LocalFileManager dynamically to avoid circular dependencies
      const { LocalFileManager } = await import('../utils/localFileManager.js');
      const workingDir = LocalFileManager.getResolvedWorkingDirectory();
      McpGasConfigManager.configPath = path.join(workingDir, McpGasConfigManager.CONFIG_FILE);
      console.error(`🔧 [CONFIG] Config path initialized to: ${McpGasConfigManager.configPath}`);
    }
    return McpGasConfigManager.configPath;
  }

  /**
   * Initialize configuration file if it doesn't exist
   */
  static async initialize(workingDir?: string): Promise<void> {
    console.error(`🔧 [CONFIG] Initializing with workingDir: ${workingDir}`);
    
    if (workingDir) {
      McpGasConfigManager.configPath = path.join(workingDir, McpGasConfigManager.CONFIG_FILE);
    } else {
      const { LocalFileManager } = await import('../utils/localFileManager.js');
      const resolvedWorkingDir = LocalFileManager.getResolvedWorkingDirectory();
      McpGasConfigManager.configPath = path.join(resolvedWorkingDir, McpGasConfigManager.CONFIG_FILE);
    }
    
    console.error(`🔧 [CONFIG] Config path set to: ${McpGasConfigManager.configPath}`);
    
    try {
      await fs.access(McpGasConfigManager.configPath);
      console.error(`✅ [CONFIG] Found existing config: ${McpGasConfigManager.configPath}`);
    } catch (error) {
      console.error(`🔧 [CONFIG] Creating new config: ${McpGasConfigManager.configPath}`);
      const finalWorkingDir = workingDir || path.dirname(McpGasConfigManager.configPath);
      await McpGasConfigManager.migrateExistingConfigs(finalWorkingDir);
    }
  }

  /**
   * Initialize with explicit config file path
   */
  static async initializeFromFile(configFilePath: string): Promise<void> {
    console.error(`🔧 [CONFIG] Initializing from explicit file: ${configFilePath}`);
    
    McpGasConfigManager.configPath = path.resolve(configFilePath);
    
    // Derive working directory from config file location and set environment variable
    const workingDir = path.dirname(McpGasConfigManager.configPath);
    process.env.MCP_GAS_WORKING_DIR = workingDir;
    console.error(`🔧 [CONFIG] Set MCP_GAS_WORKING_DIR to: ${workingDir}`);
    
    try {
      await fs.access(McpGasConfigManager.configPath);
      console.error(`✅ [CONFIG] Found existing config: ${McpGasConfigManager.configPath}`);
      
      // Load and validate the config
      const config = await McpGasConfigManager.getConfig();
      console.error(`🔧 [CONFIG] Loaded config with ${Object.keys(config.projects).length} projects`);
      console.error(`🔧 [CONFIG] Local root: ${config.localRoot.rootPath}`);
    } catch (error) {
      console.error(`❌ [CONFIG] Config file not found or invalid: ${McpGasConfigManager.configPath}`);
      throw new Error(`Config file not found: ${configFilePath}`);
    }
  }

  /**
   * Get the unified configuration
   */
  static async getConfig(): Promise<McpGasConfig> {
    if (McpGasConfigManager.configCache) {
      return McpGasConfigManager.configCache as McpGasConfig;
    }

    try {
      const configPath = await McpGasConfigManager.getConfigPath();
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      // Merge with defaults to ensure all required fields exist
      McpGasConfigManager.configCache = {
        ...DEFAULT_CONFIG,
        ...config,
        oauth: { ...DEFAULT_CONFIG.oauth, ...config.oauth },
        localRoot: { ...DEFAULT_CONFIG.localRoot, ...config.localRoot },
        server: { ...DEFAULT_CONFIG.server, ...config.server }
      };
      
      return McpGasConfigManager.configCache as McpGasConfig;
    } catch (error) {
      console.error(`⚠️ [CONFIG] Failed to read config, using defaults: ${error}`);
      McpGasConfigManager.configCache = { ...DEFAULT_CONFIG };
      await McpGasConfigManager.saveConfig(McpGasConfigManager.configCache);
      return McpGasConfigManager.configCache as McpGasConfig;
    }
  }

  /**
   * Save the unified configuration
   */
  static async saveConfig(config: McpGasConfig): Promise<void> {
    config.server.lastModified = new Date().toISOString();
    
    const configPath = await McpGasConfigManager.getConfigPath();
    await fs.writeFile(
      configPath, 
      JSON.stringify(config, null, 2),
      'utf-8'
    );
    
    McpGasConfigManager.configCache = config;
    console.error(`💾 [CONFIG] Saved configuration to ${configPath}`);
  }

  /**
   * Update specific section of configuration
   */
  static async updateConfig(updates: Partial<McpGasConfig>): Promise<void> {
    const config = await McpGasConfigManager.getConfig();
    const updatedConfig = {
      ...config,
      ...updates,
      server: {
        ...config.server,
        ...updates.server,
        lastModified: new Date().toISOString()
      }
    };
    
    await McpGasConfigManager.saveConfig(updatedConfig);
  }

  /**
   * Get OAuth configuration
   */
  static async getOAuthConfig(): Promise<McpGasConfig['oauth']> {
    const config = await McpGasConfigManager.getConfig();
    return config.oauth;
  }

  /**
   * Get current project
   */
  static async getCurrentProject(): Promise<McpGasConfig['currentProject'] | null> {
    const config = await McpGasConfigManager.getConfig();
    return config.currentProject || null;
  }

  /**
   * Set current project
   */
  static async setCurrentProject(projectName: string, scriptId: string): Promise<void> {
    await McpGasConfigManager.updateConfig({
      currentProject: {
        projectName,
        scriptId,
        lastSync: new Date().toISOString()
      }
    });
  }

  /**
   * Add a project to configuration
   */
  static async addProject(
    name: string, 
    scriptId: string, 
    description?: string
  ): Promise<void> {
    const config = await McpGasConfigManager.getConfig();
    
    config.projects[name] = {
      scriptId,
      name,
      description
    };
    
    await McpGasConfigManager.saveConfig(config);
  }

  /**
   * Get local root path - now uses git sync pattern
   * Each project lives in ~/gas-repos/project-{scriptId}/
   */
  static async getLocalRootPath(): Promise<string> {
    // Always use the git sync pattern
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    return path.resolve(homeDir, 'gas-repos');
  }

  /**
   * Get working directory
   */
  static async getWorkingDir(): Promise<string> {
    const configPath = await McpGasConfigManager.getConfigPath();
    return path.dirname(configPath);
  }

  /**
   * Clear configuration cache
   */
  static clearCache(): void {
    McpGasConfigManager.configCache = null;
  }

  /**
   * Migrate existing configuration files to unified format
   */
  private static async migrateExistingConfigs(workingDir: string): Promise<void> {
    console.error(`🔄 [CONFIG] Migrating existing configurations...`);
    
    const config: McpGasConfig = { ...DEFAULT_CONFIG };
    config.server.defaultWorkingDir = workingDir;

    // Migrate OAuth config
    try {
      const oauthPath = path.join(workingDir, 'oauth-config.json');
      const oauthContent = await fs.readFile(oauthPath, 'utf-8');
      const oauthData = JSON.parse(oauthContent);
      if (oauthData.oauth) {
        config.oauth = { ...config.oauth, ...oauthData.oauth };
        console.error(`   ✅ Migrated OAuth configuration`);
      }
    } catch (error) {
      console.error(`   ⚠️ No OAuth config to migrate`);
    }

    // Migrate projects config
    try {
      const projectsPath = path.join(workingDir, '.gas-projects.json');
      const projectsContent = await fs.readFile(projectsPath, 'utf-8');
      const projectsData = JSON.parse(projectsContent);
      if (projectsData.projects) {
        config.projects = projectsData.projects;
        console.error(`   ✅ Migrated ${Object.keys(projectsData.projects).length} projects`);
      }
      // Note: Legacy top-level environments are no longer supported.
      // Environment config is now per-project via McpGasProject.environments.
    } catch (error) {
      console.error(`   ⚠️ No projects config to migrate`);
    }

    // Migrate current project
    try {
      const currentPath = path.join(workingDir, '.gas-current.json');
      const currentContent = await fs.readFile(currentPath, 'utf-8');
      const currentData = JSON.parse(currentContent);
      config.currentProject = currentData;
      console.error(`   ✅ Migrated current project: ${currentData.projectName}`);
    } catch (error) {
      console.error(`   ⚠️ No current project to migrate`);
    }

    // Migrate local root
    try {
      const rootPath = path.join(workingDir, '.gas-local-root.json');
      const rootContent = await fs.readFile(rootPath, 'utf-8');
      const rootData = JSON.parse(rootContent);
      config.localRoot = rootData;
      console.error(`   ✅ Migrated local root: ${rootData.rootPath}`);
    } catch (error) {
      console.error(`   ⚠️ No local root to migrate`);
    }

    await McpGasConfigManager.saveConfig(config);
    console.error(`🎉 [CONFIG] Migration complete! Unified config created.`);
  }

  /**
   * Export configuration to backup file
   */
  static async exportConfig(backupPath?: string): Promise<string> {
    const config = await McpGasConfigManager.getConfig();
    const exportPath = backupPath || path.join(
      await McpGasConfigManager.getWorkingDir(),
      `mcp-gas-config-backup-${Date.now()}.json`
    );
    
    await fs.writeFile(exportPath, JSON.stringify(config, null, 2));
    return exportPath;
  }

  /**
   * Import configuration from backup file
   */
  static async importConfig(importPath: string): Promise<void> {
    const content = await fs.readFile(importPath, 'utf-8');
    const config = JSON.parse(content);
    await McpGasConfigManager.saveConfig(config);
    console.error(`📥 [CONFIG] Imported configuration from ${importPath}`);
  }
} 
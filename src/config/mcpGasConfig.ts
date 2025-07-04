import { promises as fs } from 'fs';
import path from 'path';

/**
 * Unified MCP Gas Server Configuration
 * Consolidates OAuth, projects, current project, and local root settings
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
    [projectName: string]: {
      scriptId: string;
      name: string;
      description?: string;
    };
  };
  
  // Environment Management
  environments?: {
    dev?: { scriptId: string; name: string; };
    staging?: { scriptId: string; name: string; };
    production?: { scriptId: string; name: string; };
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
}

/**
 * Default configuration template
 */
const DEFAULT_CONFIG: McpGasConfig = {
  oauth: {
    client_id: "428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com",
    type: "uwp",
    redirect_uris: [
      "http://127.0.0.1/*",
      "http://localhost/*"
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
    rootPath: '/tmp/gas-projects',
    lastUpdated: new Date().toISOString()
  },
  server: {
    defaultWorkingDir: '/tmp/mcp-gas-workspace',
    configVersion: "1.0.0",
    lastModified: new Date().toISOString()
  }
};

/**
 * Unified Configuration Manager
 */
export class McpGasConfigManager {
  private static readonly CONFIG_FILE = 'mcp-gas-config.json';
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
   * Get local root path
   */
  static async getLocalRootPath(): Promise<string> {
    const config = await McpGasConfigManager.getConfig();
    return config.localRoot.rootPath;
  }

  /**
   * Set local root path
   */
  static async setLocalRootPath(rootPath: string): Promise<void> {
    await McpGasConfigManager.updateConfig({
      localRoot: {
        rootPath,
        lastUpdated: new Date().toISOString()
      }
    });
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
      if (projectsData.environments) {
        config.environments = projectsData.environments;
        console.error(`   ✅ Migrated environments configuration`);
      }
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
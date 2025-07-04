import { BaseTool } from './base.js';
import { LocalFileManager, LocalRootConfig, ProjectInfo } from '../utils/localFileManager.js';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

/**
 * Tool to set the local root directory for all project folders
 */
export class GASLocalSetRootTool extends BaseTool {
  public name = 'gas_local_set_root';
  public description = 'Set the local root directory where all GAS project folders will be stored';

  public inputSchema = {
    type: 'object' as const,
    properties: {
      rootPath: {
        type: 'string',
        description: 'Local root directory path (relative or absolute). All project folders will be created under this directory',
        examples: ['gas-projects', '../my-gas-projects', '~/Development/gas', '/Users/user/projects/gas']
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['rootPath']
  };

  async execute({ rootPath, workingDir, accessToken }: { 
    rootPath: string; 
    workingDir?: string; 
    accessToken?: string 
  }) {
    // Use LocalFileManager's workspace detection instead of process.cwd()
    const actualWorkingDir = workingDir || this.detectWorkspace();
    const resolvedPath = path.resolve(actualWorkingDir, rootPath);
    
    await LocalFileManager.setLocalRoot(rootPath, actualWorkingDir);
    
    return {
      success: true,
      message: `Local root set successfully`,
      rootPath: resolvedPath,
      workingDir: actualWorkingDir,
      config: {
        relativePath: rootPath,
        absolutePath: resolvedPath
      }
    };
  }

  private detectWorkspace(): string {
    // Try to find the workspace by looking for package.json or other project markers
    let currentDir = process.cwd();
    const maxAttempts = 10;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const nodeModulesPath = path.join(currentDir, 'node_modules');
        const gasProjectsPath = path.join(currentDir, 'gas-projects');
        
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.name === 'mcp-gas-server' || 
              fs.existsSync(gasProjectsPath) ||
              fs.existsSync(nodeModulesPath)) {
            return currentDir;
          }
        }
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
        attempts++;
      } catch (error) {
        break;
      }
    }
    
    // Fallback to /tmp for MCP environments
    return '/tmp/mcp-gas-workspace';
  }
}

/**
 * Tool to get the current local root directory configuration
 */
export class GASLocalGetRootTool extends BaseTool {
  public name = 'gas_local_get_root';
  public description = 'Get the current local root directory configuration where GAS project folders are stored';

  public inputSchema = {
    type: 'object' as const,
    properties: {
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    }
  };

  async execute({ workingDir, accessToken }: { 
    workingDir?: string; 
    accessToken?: string 
  } = {}) {
    // Use consistent workspace detection
    const actualWorkingDir = workingDir || this.detectWorkspace();
    const rootPath = await LocalFileManager.getLocalRoot(actualWorkingDir);
    const configPath = path.join(actualWorkingDir, '.gas-local-root.json');
    
    // Get relative path from working directory
    const relativePath = path.relative(actualWorkingDir, rootPath);
    
    return {
      success: true,
      rootPath,
      relativePath: relativePath || '.',
      configPath,
      workingDir: actualWorkingDir,
      exists: fs.existsSync(rootPath)
    };
  }

  private detectWorkspace(): string {
    // Same workspace detection logic as above
    let currentDir = process.cwd();
    const maxAttempts = 10;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const nodeModulesPath = path.join(currentDir, 'node_modules');
        const gasProjectsPath = path.join(currentDir, 'gas-projects');
        
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.name === 'mcp-gas-server' || 
              fs.existsSync(gasProjectsPath) ||
              fs.existsSync(nodeModulesPath)) {
            return currentDir;
          }
        }
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
        attempts++;
      } catch (error) {
        break;
      }
    }
    
    return '/tmp/mcp-gas-workspace';
  }
}

/**
 * Tool to list all local GAS projects in the local root directory
 */
export class GASLocalListProjectsTool extends BaseTool {
  public name = 'gas_local_list_projects';
  public description = 'List all local GAS projects found in the local root directory structure';

  public inputSchema = {
    type: 'object' as const,
    properties: {
      detailed: {
        type: 'boolean',
        description: 'Include detailed project information and file counts',
        default: false
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    }
  };

  async execute({ detailed = false, workingDir, accessToken }: { 
    detailed?: boolean; 
    workingDir?: string; 
    accessToken?: string 
  } = {}) {
    const actualWorkingDir = workingDir || this.detectWorkspace();
    const rootPath = await LocalFileManager.getLocalRoot(actualWorkingDir);
    const projects = await LocalFileManager.listLocalProjects(actualWorkingDir);

    const result: any = {
      success: true,
      localRoot: rootPath,
      projectCount: projects.length,
      projects: []
    };

    for (const project of projects) {
      const projectEntry: any = {
        name: project.projectName,
        scriptId: project.scriptId,
        lastSync: project.lastSync,
        created: project.created
      };

      if (project.description) {
        projectEntry.description = project.description;
      }

      if (detailed) {
        try {
          const files = await LocalFileManager.getProjectFiles(project.projectName, actualWorkingDir);
          const projectDir = await LocalFileManager.getProjectDirectory(project.projectName, actualWorkingDir);
          
          projectEntry.fileCount = files.length;
          projectEntry.totalSize = files.reduce((sum, f) => sum + f.size, 0);
          projectEntry.lastModified = files.length > 0 
            ? new Date(Math.max(...files.map(f => f.lastModified.getTime()))).toISOString()
            : null;
          projectEntry.projectPath = projectDir;
          projectEntry.files = files.map(f => ({
            name: f.name,
            size: f.size,
            lastModified: f.lastModified.toISOString()
          }));
        } catch (error) {
          projectEntry.error = `Failed to read project details: ${error}`;
        }
      }

      result.projects.push(projectEntry);
    }

    if (projects.length === 0) {
      result.message = `No local projects found in ${rootPath}`;
    } else {
      result.message = `Found ${projects.length} local project${projects.length === 1 ? '' : 's'}`;
    }

    return result;
  }

  private detectWorkspace(): string {
    let currentDir = process.cwd();
    const maxAttempts = 10;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const nodeModulesPath = path.join(currentDir, 'node_modules');
        const gasProjectsPath = path.join(currentDir, 'gas-projects');
        
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.name === 'mcp-gas-server' || 
              fs.existsSync(gasProjectsPath) ||
              fs.existsSync(nodeModulesPath)) {
            return currentDir;
          }
        }
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
        attempts++;
      } catch (error) {
        break;
      }
    }
    
    return '/tmp/mcp-gas-workspace';
  }
}

/**
 * Tool to show the structure of the local root directory
 */
export class GASLocalShowStructureTool extends BaseTool {
  public name = 'gas_local_show_structure';
  public description = 'Show the directory structure of the local root with all project folders';

  public inputSchema = {
    type: 'object' as const,
    properties: {
      depth: {
        type: 'number',
        description: 'Maximum depth to show (1 = just project folders, 2 = include src directories)',
        default: 2,
        minimum: 1,
        maximum: 3
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    }
  };

  async execute({ depth = 2, workingDir, accessToken }: { 
    depth?: number; 
    workingDir?: string; 
    accessToken?: string 
  } = {}) {
    const actualWorkingDir = workingDir || this.detectWorkspace();
    const rootPath = await LocalFileManager.getLocalRoot(actualWorkingDir);

    const tree = await this.buildDirectoryTree(rootPath, depth);

    return {
      success: true,
      localRoot: rootPath,
      workingDir: actualWorkingDir,
      depth,
      structure: tree
    };
  }

  private detectWorkspace(): string {
    let currentDir = process.cwd();
    const maxAttempts = 10;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const nodeModulesPath = path.join(currentDir, 'node_modules');
        const gasProjectsPath = path.join(currentDir, 'gas-projects');
        
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.name === 'mcp-gas-server' || 
              fs.existsSync(gasProjectsPath) ||
              fs.existsSync(nodeModulesPath)) {
            return currentDir;
          }
        }
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
        attempts++;
      } catch (error) {
        break;
      }
    }
    
    return '/tmp/mcp-gas-workspace';
  }

  private async buildDirectoryTree(dirPath: string, maxDepth: number, currentDepth = 0): Promise<any> {
    if (currentDepth >= maxDepth) {
      return null;
    }

    try {
      const stats = await fsPromises.stat(dirPath);
      if (!stats.isDirectory()) {
        return {
          name: path.basename(dirPath),
          type: 'file',
          size: stats.size
        };
      }

      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      const children: any[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden files
        
        const childPath = path.join(dirPath, entry.name);
        const child = await this.buildDirectoryTree(childPath, maxDepth, currentDepth + 1);
        if (child) {
          children.push(child);
        }
      }

      return {
        name: path.basename(dirPath),
        type: 'directory',
        children: children.sort((a, b) => {
          // Directories first, then files
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        })
      };
    } catch (error) {
      return {
        name: path.basename(dirPath),
        type: 'error',
        error: `Access denied: ${error}`
      };
    }
  }
} 
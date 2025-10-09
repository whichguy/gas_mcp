/**
 * Project structure visualization tool for Google Apps Script projects
 * Provides hierarchical tree views with dependency relationships and file analysis
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { GasDependencyAnalyzer, DependencyGraph } from './gas-deps.js';
import { ContentSummarizer } from '../utils/contentSummarizer.js';
import { COMMON_TOOL_SCHEMAS } from '../utils/schemaPatterns.js';
import { GASErrorHandler } from '../utils/errorHandler.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

export interface TreeNode {
  name: string;
  type: 'file' | 'directory' | 'system' | 'entry' | 'orphan';
  path: string;
  children?: TreeNode[];
  metadata?: {
    fileType?: string;
    size?: number;
    complexity?: number;
    exports?: string[];
    imports?: string[];
    dependents?: string[];
    dependencies?: string[];
    isCircular?: boolean;
    lastModified?: string;
  };
}

export interface ProjectTree {
  root: TreeNode;
  totalFiles: number;
  systemFiles: string[];
  entryPoints: string[];
  orphanedFiles: string[];
  circularDependencies: string[][];
  statistics: {
    totalSize: number;
    averageComplexity: number;
    maxDepth: number;
    fileTypeDistribution: Record<string, number>;
  };
}

export class GasTreeAnalyzer {
  
  /**
   * Generate project tree structure with dependency analysis
   */
  static generateProjectTree(files: any[], dependencyGraph?: DependencyGraph): ProjectTree {
    const tree: ProjectTree = {
      root: {
        name: 'project',
        type: 'directory',
        path: '',
        children: [],
        metadata: {}
      },
      totalFiles: files.length,
      systemFiles: [],
      entryPoints: [],
      orphanedFiles: [],
      circularDependencies: [],
      statistics: {
        totalSize: 0,
        averageComplexity: 0,
        maxDepth: 0,
        fileTypeDistribution: {}
      }
    };

    // Use dependency graph if provided, otherwise create one
    const depGraph = dependencyGraph || GasDependencyAnalyzer.analyzeDependencies(files);
    
    // Copy dependency metadata
    tree.systemFiles = depGraph.systemFiles;
    tree.entryPoints = depGraph.entryPoints;
    tree.orphanedFiles = depGraph.orphanedFiles;
    tree.circularDependencies = depGraph.circularDependencies;

    // Build hierarchical structure based on pseudo-directories
    const pathNodes = new Map<string, TreeNode>();
    
    // First pass: create directory structure
    for (const file of files) {
      const pathParts = file.name.split('/');
      let currentPath = '';
      let currentParent = tree.root;

      // Create intermediate directories
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        let dirNode = pathNodes.get(currentPath);
        if (!dirNode) {
          dirNode = {
            name: part,
            type: 'directory',
            path: currentPath,
            children: [],
            metadata: {}
          };
          pathNodes.set(currentPath, dirNode);
          currentParent.children!.push(dirNode);
        }
        currentParent = dirNode;
      }

      // Create file node
      const fileName = pathParts[pathParts.length - 1];
      const dependencyNode = depGraph.nodes.get(file.name);
      const isCircular = depGraph.circularDependencies.some(cycle => cycle.includes(file.name));
      
      let nodeType: 'file' | 'system' | 'entry' | 'orphan' = 'file';
      if (depGraph.systemFiles.includes(file.name)) {
        nodeType = 'system';
      } else if (depGraph.entryPoints.includes(file.name)) {
        nodeType = 'entry';
      } else if (depGraph.orphanedFiles.includes(file.name)) {
        nodeType = 'orphan';
      }

      const fileNode: TreeNode = {
        name: fileName,
        type: nodeType,
        path: file.name,
        metadata: {
          fileType: file.type,
          size: file.source ? file.source.length : 0,
          complexity: dependencyNode?.complexity || 0,
          exports: dependencyNode?.exports || [],
          imports: dependencyNode?.imports || [],
          dependents: dependencyNode?.dependents || [],
          dependencies: dependencyNode?.dependencies || [],
          isCircular: isCircular,
          lastModified: file.lastModified
        }
      };

      currentParent.children!.push(fileNode);
      
      // Update statistics
      tree.statistics.totalSize += fileNode.metadata?.size || 0;
      const fileType = file.type || 'UNKNOWN';
      tree.statistics.fileTypeDistribution[fileType] = (tree.statistics.fileTypeDistribution[fileType] || 0) + 1;
    }

    // Sort children alphabetically, with directories first
    this.sortTreeNodes(tree.root);
    
    // Calculate additional statistics
    tree.statistics.averageComplexity = files.length > 0 ? 
      Array.from(depGraph.nodes.values()).reduce((sum, node) => sum + (node.complexity || 0), 0) / files.length : 0;
    tree.statistics.maxDepth = this.calculateMaxDepth(tree.root);

    return tree;
  }

  private static sortTreeNodes(node: TreeNode): void {
    if (!node.children) return;
    
    node.children.sort((a, b) => {
      // Directories first
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (b.type === 'directory' && a.type !== 'directory') return 1;
      
      // System files at the end
      if (a.type === 'system' && b.type !== 'system') return 1;
      if (b.type === 'system' && a.type !== 'system') return -1;
      
      // Entry points near top
      if (a.type === 'entry' && b.type === 'file') return -1;
      if (b.type === 'entry' && a.type === 'file') return 1;
      
      // Orphans at bottom (but before system)
      if (a.type === 'orphan' && b.type === 'file') return 1;
      if (b.type === 'orphan' && a.type === 'file') return -1;
      
      // Alphabetical for same types
      return a.name.localeCompare(b.name);
    });

    // Recursively sort children
    for (const child of node.children) {
      this.sortTreeNodes(child);
    }
  }

  private static calculateMaxDepth(node: TreeNode, depth = 0): number {
    if (!node.children || node.children.length === 0) {
      return depth;
    }
    
    return Math.max(...node.children.map(child => 
      this.calculateMaxDepth(child, depth + 1)
    ));
  }

  /**
   * Generate ASCII tree representation
   */
  static generateAsciiTree(tree: ProjectTree, showMetadata = true): string {
    const lines: string[] = [];
    
    const renderNode = (node: TreeNode, prefix: string, isLast: boolean, depth: number): void => {
      // Node icon based on type
      let icon = '';
      switch (node.type) {
        case 'directory': icon = '📁'; break;
        case 'system': icon = '⚙️'; break;
        case 'entry': icon = '🚪'; break;
        case 'orphan': icon = '🔴'; break;
        default: icon = '📄'; break;
      }
      
      // Build line with prefix
      const connector = isLast ? '└── ' : '├── ';
      let line = prefix + connector + icon + ' ' + node.name;
      
      // Add metadata annotations
      if (showMetadata && node.metadata && node.type !== 'directory') {
        const annotations: string[] = [];
        
        if (node.metadata.size) {
          const sizeKb = Math.round(node.metadata.size / 1024 * 10) / 10;
          annotations.push(`${sizeKb}kb`);
        }
        
        if (node.metadata.complexity && node.metadata.complexity > 0) {
          annotations.push(`C:${node.metadata.complexity}`);
        }
        
        if (node.metadata.exports && node.metadata.exports.length > 0) {
          annotations.push(`E:${node.metadata.exports.length}`);
        }
        
        if (node.metadata.dependencies && node.metadata.dependencies.length > 0) {
          annotations.push(`D:${node.metadata.dependencies.length}`);
        }
        
        if (node.metadata.isCircular) {
          annotations.push('🔄');
        }
        
        if (annotations.length > 0) {
          line += ` (${annotations.join(', ')})`;
        }
      }
      
      lines.push(line);
      
      // Process children
      if (node.children && node.children.length > 0) {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        node.children.forEach((child, index) => {
          const childIsLast = index === node.children!.length - 1;
          renderNode(child, childPrefix, childIsLast, depth + 1);
        });
      }
    };
    
    // Start with root children (skip the root directory itself)
    if (tree.root.children) {
      tree.root.children.forEach((child, index) => {
        const isLast = index === tree.root.children!.length - 1;
        renderNode(child, '', isLast, 0);
      });
    }
    
    return lines.join('\n');
  }

  /**
   * Generate flat list view with filtering
   */
  static generateFlatList(
    tree: ProjectTree, 
    options: {
      sortBy?: 'name' | 'size' | 'complexity' | 'dependencies';
      filterType?: 'all' | 'files' | 'system' | 'entry' | 'orphan';
      showPath?: boolean;
    } = {}
  ): Array<{
    name: string;
    type: string;
    path: string;
    size?: number;
    complexity?: number;
    dependencies?: number;
    exports?: number;
    isCircular?: boolean;
  }> {
    const flatList: any[] = [];
    
    const collectNodes = (node: TreeNode): void => {
      if (node.type !== 'directory') {
        // Apply filter
        if (options.filterType && options.filterType !== 'all') {
          if (options.filterType === 'files' && ['system', 'entry', 'orphan'].includes(node.type)) return;
          if (options.filterType !== node.type) return;
        }
        
        flatList.push({
          name: options.showPath ? node.path : node.name,
          type: node.type,
          path: node.path,
          size: node.metadata?.size,
          complexity: node.metadata?.complexity,
          dependencies: node.metadata?.dependencies?.length || 0,
          exports: node.metadata?.exports?.length || 0,
          isCircular: node.metadata?.isCircular || false
        });
      }
      
      if (node.children) {
        node.children.forEach(collectNodes);
      }
    };
    
    collectNodes(tree.root);
    
    // Sort based on criteria
    const sortBy = options.sortBy || 'name';
    flatList.sort((a, b) => {
      switch (sortBy) {
        case 'size': return (b.size || 0) - (a.size || 0);
        case 'complexity': return (b.complexity || 0) - (a.complexity || 0);
        case 'dependencies': return (b.dependencies || 0) - (a.dependencies || 0);
        case 'name':
        default: return a.name.localeCompare(b.name);
      }
    });
    
    return flatList;
  }
}

export class TreeTool extends BaseTool {
  private gasClient: GASClient;

  public name = 'tree';
  public description = 'Project structure visualization with hierarchical tree views, dependency relationships, and file analysis. Provides ASCII tree, flat list, and statistics views with complexity metrics.';

  constructor(authManager?: any) {
    super(authManager);
    this.gasClient = new GASClient();
  }

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      viewMode: {
        type: 'string',
        enum: ['tree', 'flat', 'stats', 'dependencies'],
        description: 'Visualization mode for project structure',
        default: 'tree',
        examples: ['tree', 'flat', 'stats', 'dependencies']
      },
      showMetadata: {
        type: 'boolean',
        description: 'Include file metadata (size, complexity, dependencies) in tree view',
        default: true
      },
      filterType: {
        type: 'string',
        enum: ['all', 'files', 'system', 'entry', 'orphan'],
        description: 'Filter files by type in flat view',
        default: 'all',
        examples: ['all', 'files', 'system', 'entry', 'orphan']
      },
      sortBy: {
        type: 'string',
        enum: ['name', 'size', 'complexity', 'dependencies'],
        description: 'Sort criteria for flat view',
        default: 'name',
        examples: ['name', 'size', 'complexity', 'dependencies']
      },
      showPath: {
        type: 'boolean',
        description: 'Show full file paths instead of just names in flat view',
        default: false
      },
      includeSystem: {
        type: 'boolean',
        description: 'Include system files (CommonJS, __mcp_gas_run, etc.) in analysis',
        default: false
      },
      ...SchemaFragments.workingDir,
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    additionalProperties: false
  };

  async execute(params: any): Promise<any> {
    try {
      // Validate parameters
      const validatedParams = this.validateParams(params);
      
      // Get authentication
      const accessToken = await this.getAuthToken(params);
      
      // Get files from the project
      const projectFiles = await this.gasClient.getProjectContent(validatedParams.scriptId, accessToken);
      if (!projectFiles || projectFiles.length === 0) {
        throw new Error('No files found in project');
      }

      // Generate dependency analysis
      const dependencyGraph = GasDependencyAnalyzer.analyzeDependencies(projectFiles);
      
      // Filter system files if requested
      let filteredFiles = projectFiles;
      if (!validatedParams.includeSystem) {
        filteredFiles = projectFiles.filter(file => !dependencyGraph.systemFiles.includes(file.name));
        
        // Also filter system files from dependency graph
        for (const systemFile of dependencyGraph.systemFiles) {
          dependencyGraph.nodes.delete(systemFile);
        }
      }

      // Generate project tree
      const projectTree = GasTreeAnalyzer.generateProjectTree(filteredFiles, dependencyGraph);

      // Format response based on view mode
      return this.formatTreeResults(
        projectTree,
        validatedParams.viewMode,
        {
          showMetadata: validatedParams.showMetadata,
          filterType: validatedParams.filterType,
          sortBy: validatedParams.sortBy,
          showPath: validatedParams.showPath,
          includeSystem: validatedParams.includeSystem
        }
      );

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'project tree visualization',
        scriptId: params.scriptId,
        tool: 'gas_tree'
      });
    }
  }

  private validateParams(params: any) {
    const scriptId = this.validate.scriptId(params.scriptId, 'project tree visualization');
    
    return {
      scriptId,
      viewMode: params.viewMode || 'tree',
      showMetadata: params.showMetadata !== false,
      filterType: params.filterType || 'all',
      sortBy: params.sortBy || 'name',
      showPath: params.showPath === true,
      includeSystem: params.includeSystem === true
    };
  }

  private formatTreeResults(
    tree: ProjectTree,
    viewMode: string,
    options: {
      showMetadata: boolean;
      filterType: string;
      sortBy: string;
      showPath: boolean;
      includeSystem: boolean;
    }
  ) {
    const response: any = {
      status: 'success',
      viewMode: viewMode,
      overview: {
        totalFiles: tree.totalFiles,
        systemFiles: tree.systemFiles.length,
        entryPoints: tree.entryPoints.length,
        orphanedFiles: tree.orphanedFiles.length,
        circularDependencies: tree.circularDependencies.length
      },
      statistics: tree.statistics
    };

    switch (viewMode) {
      case 'tree':
        response.tree = {
          ascii: GasTreeAnalyzer.generateAsciiTree(tree, options.showMetadata),
          structure: this.formatTreeStructure(tree.root)
        };
        break;
      
      case 'flat':
        response.flatList = GasTreeAnalyzer.generateFlatList(tree, {
          sortBy: options.sortBy as any,
          filterType: options.filterType as any,
          showPath: options.showPath
        });
        break;
      
      case 'stats':
        response.detailedStatistics = this.formatDetailedStatistics(tree);
        break;
      
      case 'dependencies':
        response.dependencyAnalysis = {
          entryPoints: tree.entryPoints.map(name => ({
            name,
            type: 'entry',
            dependents: tree.root.children ? this.findNodeByPath(tree.root, name)?.metadata?.dependents || [] : []
          })),
          orphanedFiles: tree.orphanedFiles.map(name => ({
            name,
            type: 'orphan',
            dependencies: tree.root.children ? this.findNodeByPath(tree.root, name)?.metadata?.dependencies || [] : []
          })),
          circularDependencies: tree.circularDependencies.map(cycle => ({
            cycle: cycle,
            length: cycle.length - 1,
            files: cycle.slice(0, -1).map(name => ({
              name,
              complexity: tree.root.children ? this.findNodeByPath(tree.root, name)?.metadata?.complexity || 0 : 0
            }))
          }))
        };
        break;
      
      default:
        response.tree = {
          ascii: GasTreeAnalyzer.generateAsciiTree(tree, options.showMetadata),
          structure: this.formatTreeStructure(tree.root)
        };
        break;
    }

    // Add suggestions based on findings
    const suggestions: string[] = [];
    if (tree.circularDependencies.length > 0) {
      suggestions.push(`Found ${tree.circularDependencies.length} circular dependencies - consider refactoring`);
    }
    if (tree.orphanedFiles.length > 0) {
      suggestions.push(`Found ${tree.orphanedFiles.length} orphaned files - consider cleanup or integration`);
    }
    if (tree.statistics.averageComplexity > 50) {
      suggestions.push('High average complexity detected - consider breaking down complex files');
    }

    if (suggestions.length > 0) {
      response.suggestions = suggestions;
    }

    return response;
  }

  private formatTreeStructure(node: TreeNode): any {
    const formatted: any = {
      name: node.name,
      type: node.type,
      path: node.path
    };

    if (node.metadata && Object.keys(node.metadata).length > 0) {
      formatted.metadata = node.metadata;
    }

    if (node.children && node.children.length > 0) {
      formatted.children = node.children.map(child => this.formatTreeStructure(child));
    }

    return formatted;
  }

  private formatDetailedStatistics(tree: ProjectTree) {
    const stats = tree.statistics;
    
    // Calculate additional insights
    const complexityDistribution = this.calculateComplexityDistribution(tree.root);
    const dependencyDistribution = this.calculateDependencyDistribution(tree.root);
    
    return {
      fileMetrics: {
        totalFiles: tree.totalFiles,
        totalSize: stats.totalSize,
        averageSize: Math.round(stats.totalSize / tree.totalFiles),
        averageComplexity: Math.round(stats.averageComplexity * 100) / 100,
        maxDepth: stats.maxDepth
      },
      typeDistribution: stats.fileTypeDistribution,
      complexityDistribution: {
        low: complexityDistribution.low,      // 0-10
        medium: complexityDistribution.medium, // 11-30
        high: complexityDistribution.high,     // 31-70
        veryHigh: complexityDistribution.veryHigh // 71+
      },
      dependencyDistribution: {
        isolated: dependencyDistribution.isolated,     // 0 deps
        simple: dependencyDistribution.simple,         // 1-3 deps
        moderate: dependencyDistribution.moderate,     // 4-7 deps
        complex: dependencyDistribution.complex        // 8+ deps
      },
      qualityMetrics: {
        circularDependencyRatio: tree.circularDependencies.length / tree.totalFiles,
        orphanedFileRatio: tree.orphanedFiles.length / tree.totalFiles,
        systemFileRatio: tree.systemFiles.length / tree.totalFiles
      }
    };
  }

  private calculateComplexityDistribution(node: TreeNode): Record<string, number> {
    const distribution = { low: 0, medium: 0, high: 0, veryHigh: 0 };
    
    const collectComplexity = (n: TreeNode): void => {
      if (n.type !== 'directory' && n.metadata?.complexity) {
        const complexity = n.metadata.complexity;
        if (complexity <= 10) distribution.low++;
        else if (complexity <= 30) distribution.medium++;
        else if (complexity <= 70) distribution.high++;
        else distribution.veryHigh++;
      }
      
      if (n.children) {
        n.children.forEach(collectComplexity);
      }
    };
    
    collectComplexity(node);
    return distribution;
  }

  private calculateDependencyDistribution(node: TreeNode): Record<string, number> {
    const distribution = { isolated: 0, simple: 0, moderate: 0, complex: 0 };
    
    const collectDependencies = (n: TreeNode): void => {
      if (n.type !== 'directory' && n.metadata?.dependencies) {
        const depCount = n.metadata.dependencies.length;
        if (depCount === 0) distribution.isolated++;
        else if (depCount <= 3) distribution.simple++;
        else if (depCount <= 7) distribution.moderate++;
        else distribution.complex++;
      }
      
      if (n.children) {
        n.children.forEach(collectDependencies);
      }
    };
    
    collectDependencies(node);
    return distribution;
  }

  private findNodeByPath(root: TreeNode, path: string): TreeNode | null {
    const searchNode = (node: TreeNode): TreeNode | null => {
      if (node.path === path) return node;
      
      if (node.children) {
        for (const child of node.children) {
          const found = searchNode(child);
          if (found) return found;
        }
      }
      
      return null;
    };
    
    return searchNode(root);
  }
}
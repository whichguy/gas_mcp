/**
 * Dependency analysis tool for Google Apps Script projects
 * Analyzes CommonJS module dependencies and relationships
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { COMMON_TOOL_SCHEMAS } from '../utils/schemaPatterns.js';
import { GASErrorHandler } from '../utils/errorHandler.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { fileNameMatches } from '../api/pathParser.js';

export interface DependencyNode {
  name: string;
  type: 'internal' | 'external' | 'system';
  imports: string[];
  exports: string[];
  dependents: string[]; // Files that depend on this module
  dependencies: string[]; // Files this module depends on
  circular: string[]; // Circular dependencies detected
  size?: number;
  complexity?: number;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  totalFiles: number;
  totalDependencies: number;
  circularDependencies: string[][];
  orphanedFiles: string[];
  entryPoints: string[];
  systemFiles: string[];
}

export class GasDependencyAnalyzer {
  
  /**
   * Analyze CommonJS dependencies in project files
   */
  static analyzeDependencies(files: any[]): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    
    // First pass: extract imports and exports
    for (const file of files) {
      if (file.type !== 'SERVER_JS') continue;
      
      const node: DependencyNode = {
        name: file.name,
        type: this.getModuleType(file.name),
        imports: this.extractImports(file.source || ''),
        exports: this.extractExports(file.source || ''),
        dependents: [],
        dependencies: [],
        circular: [],
        size: (file.source || '').length,
        complexity: this.calculateComplexity(file.source || '')
      };
      
      nodes.set(file.name, node);
    }
    
    // Second pass: build dependency relationships
    for (const [fileName, node] of nodes.entries()) {
      for (const importPath of node.imports) {
        // Resolve import path to actual file name
        const resolvedName = this.resolveImportPath(importPath, Array.from(nodes.keys()));
        if (resolvedName && nodes.has(resolvedName)) {
          node.dependencies.push(resolvedName);
          nodes.get(resolvedName)!.dependents.push(fileName);
        }
      }
    }
    
    // Third pass: detect circular dependencies
    for (const [fileName, node] of nodes.entries()) {
      node.circular = this.findCircularDependencies(fileName, nodes, new Set(), []);
    }
    
    // Analyze graph structure
    const circularDependencies = this.findAllCircularDependencies(nodes);
    const orphanedFiles = this.findOrphanedFiles(nodes);
    const entryPoints = this.findEntryPoints(nodes);
    const systemFiles = Array.from(nodes.keys()).filter(name => 
      this.getModuleType(name) === 'system'
    );
    
    return {
      nodes,
      totalFiles: nodes.size,
      totalDependencies: Array.from(nodes.values()).reduce((sum, n) => sum + n.dependencies.length, 0),
      circularDependencies,
      orphanedFiles,
      entryPoints,
      systemFiles
    };
  }
  
  private static getModuleType(fileName: string): 'internal' | 'external' | 'system' {
    if (fileNameMatches(fileName, 'common-js/require') ||
        fileNameMatches(fileName, 'common-js/__mcp_exec') ||
        fileNameMatches(fileName, 'appsscript')) {
      return 'system';
    }
    
    // For now, all other files are internal (GAS projects don't have true external deps)
    return 'internal';
  }
  
  private static extractImports(content: string): string[] {
    const imports = new Set<string>();
    const requireRegex = /require\s*\(\s*['"](.*?)['"]\s*\)/g;
    let match;
    
    while ((match = requireRegex.exec(content)) !== null) {
      imports.add(match[1]);
    }
    
    return Array.from(imports);
  }
  
  private static extractExports(content: string): string[] {
    const exports = new Set<string>();
    
    // Look for module.exports.functionName = 
    const moduleExportsRegex = /module\.exports\.(\w+)\s*=/g;
    let match;
    while ((match = moduleExportsRegex.exec(content)) !== null) {
      exports.add(match[1]);
    }
    
    // Look for exports.functionName =
    const exportsRegex = /exports\.(\w+)\s*=/g;
    while ((match = exportsRegex.exec(content)) !== null) {
      exports.add(match[1]);
    }
    
    // Look for module.exports = { ... }
    const moduleExportsObjRegex = /module\.exports\s*=\s*{([^}]*)}/g;
    while ((match = moduleExportsObjRegex.exec(content)) !== null) {
      const objContent = match[1];
      const propertyRegex = /(\w+)\s*:/g;
      let propMatch;
      while ((propMatch = propertyRegex.exec(objContent)) !== null) {
        exports.add(propMatch[1]);
      }
    }
    
    return Array.from(exports);
  }
  
  private static resolveImportPath(importPath: string, availableFiles: string[]): string | null {
    // Direct match
    if (availableFiles.includes(importPath)) {
      return importPath;
    }
    
    // Try with common path variations
    const variations = [
      importPath,
      importPath.replace(/^\.\//, ''),
      importPath.replace(/^\//, ''),
      importPath.split('/').pop() || importPath
    ];
    
    for (const variation of variations) {
      if (availableFiles.includes(variation)) {
        return variation;
      }
    }
    
    return null;
  }
  
  private static calculateComplexity(content: string): number {
    // Simple complexity score based on:
    // - Number of functions
    // - Number of conditionals
    // - Number of loops
    // - File size
    
    const functions = (content.match(/function\s+\w+|=\s*function|\w+\s*=>\s*/g) || []).length;
    const conditionals = (content.match(/if\s*\(|switch\s*\(|\?\s*|else/g) || []).length;
    const loops = (content.match(/for\s*\(|while\s*\(|forEach|map\s*\(|filter\s*\(|reduce\s*\(/g) || []).length;
    const size = content.length;
    
    // Weighted complexity score
    return functions * 3 + conditionals * 2 + loops * 2 + Math.floor(size / 1000);
  }
  
  private static findCircularDependencies(
    fileName: string, 
    nodes: Map<string, DependencyNode>, 
    visited: Set<string>, 
    path: string[]
  ): string[] {
    if (path.includes(fileName)) {
      // Found circular dependency
      const circularStart = path.indexOf(fileName);
      return path.slice(circularStart).concat([fileName]);
    }
    
    if (visited.has(fileName)) {
      return [];
    }
    
    visited.add(fileName);
    const newPath = [...path, fileName];
    
    const node = nodes.get(fileName);
    if (!node) return [];
    
    for (const dependency of node.dependencies) {
      const circular = this.findCircularDependencies(dependency, nodes, visited, newPath);
      if (circular.length > 0) {
        return circular;
      }
    }
    
    return [];
  }
  
  private static findAllCircularDependencies(nodes: Map<string, DependencyNode>): string[][] {
    const allCircular: string[][] = [];
    const processed = new Set<string>();
    
    for (const [fileName] of nodes.entries()) {
      if (!processed.has(fileName)) {
        const circular = this.findCircularDependencies(fileName, nodes, new Set(), []);
        if (circular.length > 0) {
          // Mark all files in this circular dependency as processed
          circular.forEach(f => processed.add(f));
          allCircular.push(circular);
        }
      }
    }
    
    return allCircular;
  }
  
  private static findOrphanedFiles(nodes: Map<string, DependencyNode>): string[] {
    const orphaned: string[] = [];
    
    for (const [fileName, node] of nodes.entries()) {
      // A file is orphaned if it has no dependents and is not an entry point
      if (node.dependents.length === 0 && node.dependencies.length > 0) {
        orphaned.push(fileName);
      }
    }
    
    return orphaned;
  }
  
  private static findEntryPoints(nodes: Map<string, DependencyNode>): string[] {
    const entryPoints: string[] = [];
    
    for (const [fileName, node] of nodes.entries()) {
      // A file is an entry point if it has dependents but no dependencies,
      // or if it's a system/infrastructure file
      if ((node.dependents.length > 0 && node.dependencies.length === 0) || 
          node.type === 'system') {
        entryPoints.push(fileName);
      }
    }
    
    return entryPoints;
  }
}

export class DepsTool extends BaseTool {
  private gasClient: GASClient;

  public name = 'deps';
  public description = '[ANALYSIS:DEPS] Generate dependency graph for CommonJS modules — shows require() relationships, circular dependencies, and load order. WHEN: understanding module structure or debugging load order issues. AVOID: use grep/ripgrep to search for specific require() calls; deps for full dependency visualization. Example: deps({scriptId})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      totalFiles: { type: 'number', description: 'Total JavaScript files analyzed' },
      totalDependencies: { type: 'number', description: 'Total dependency relationships' },
      circularDependencies: { type: 'array', description: 'Circular dependency chains detected' },
      orphanedFiles: { type: 'array', description: 'Files with no dependents' },
      entryPoints: { type: 'array', description: 'Module entry point files' },
      systemFiles: { type: 'array', description: 'System infrastructure files' },
      modules: { type: 'array', description: 'Module details (name, imports, exports, complexity)' }
    }
  };

  constructor(authManager?: any) {
    super(authManager);
    this.gasClient = new GASClient();
  }

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      analysisType: {
        type: 'string',
        enum: ['full', 'summary', 'circular', 'orphaned', 'graph'],
        description: 'Type of dependency analysis to perform',
        default: 'full',
        examples: ['full', 'summary', 'circular', 'orphaned', 'graph']
      },
      includeSystem: {
        type: 'boolean',
        description: 'Include system files (CommonJS, __mcp_exec, etc.) in analysis',
        default: false
      },
      showComplexity: {
        type: 'boolean', 
        description: 'Include complexity analysis for each module',
        default: true
      },
      ...SchemaFragments.workingDir,
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmGuidance: {
      analysisTypes: 'full (default) | summary (top 20) | circular (cycles) | orphaned (unused) | graph (D3/Graphviz)',
      interpretation: 'dependents=who requires this (high=critical) | dependencies=what this requires (high=complex) | complexity=functions*3+conditionals*2+loops*2+size/1000',
      bestPractices: 'High complexity+many dependents=refactor priority | circular deps block dead code elimination | orphaned=may be unused',
      workflow: 'summary→identify high-impact→circular→fix cycles'
    }
  };

  public annotations = {
    title: 'Dependency Analysis',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
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

      // Analyze dependencies
      const dependencyGraph = GasDependencyAnalyzer.analyzeDependencies(projectFiles);
      
      // Filter system files if requested
      if (!validatedParams.includeSystem) {
        for (const systemFile of dependencyGraph.systemFiles) {
          dependencyGraph.nodes.delete(systemFile);
        }
      }

      // Format and return results based on analysis type
      return this.formatDependencyResults(
        dependencyGraph,
        validatedParams.analysisType,
        validatedParams.showComplexity
      );

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'dependency analysis',
        scriptId: params.scriptId,
        tool: 'deps'
      });
    }
  }

  private validateParams(params: any) {
    const scriptId = this.validate.scriptId(params.scriptId, 'dependency analysis');
    
    return {
      scriptId,
      analysisType: params.analysisType || 'full',
      includeSystem: params.includeSystem === true,
      showComplexity: params.showComplexity !== false
    };
  }

  private formatDependencyResults(
    graph: DependencyGraph,
    analysisType: string,
    showComplexity: boolean
  ) {
    const response: any = {
      status: 'success',
      analysisType,
      overview: {
        totalFiles: graph.nodes.size,
        totalDependencies: graph.totalDependencies,
        circularDependencies: graph.circularDependencies.length,
        orphanedFiles: graph.orphanedFiles.length,
        entryPoints: graph.entryPoints.length
      }
    };

    switch (analysisType) {
      case 'summary':
        response.summary = this.formatSummaryAnalysis(graph, showComplexity);
        break;
      
      case 'circular':
        response.circularDependencies = this.formatCircularDependencies(graph);
        break;
      
      case 'orphaned':
        response.orphanedFiles = this.formatOrphanedFiles(graph);
        break;
      
      case 'graph':
        response.dependencyGraph = this.formatDependencyGraph(graph);
        break;
      
      case 'full':
      default:
        response.modules = this.formatFullAnalysis(graph, showComplexity);
        response.circularDependencies = graph.circularDependencies;
        response.orphanedFiles = graph.orphanedFiles;
        response.entryPoints = graph.entryPoints;
        if (graph.systemFiles.length > 0) {
          response.systemFiles = graph.systemFiles;
        }
        break;
    }

    return response;
  }

  private formatSummaryAnalysis(graph: DependencyGraph, showComplexity: boolean) {
    const modules = Array.from(graph.nodes.values());

    const summary = {
      mostDependedOn: modules
        .sort((a, b) => b.dependents.length - a.dependents.length)
        .slice(0, 20)
        .map(m => ({ name: m.name, dependents: m.dependents.length })),

      mostDependencies: modules
        .sort((a, b) => b.dependencies.length - a.dependencies.length)
        .slice(0, 20)
        .map(m => ({ name: m.name, dependencies: m.dependencies.length })),

      largestFiles: modules
        .sort((a, b) => (b.size || 0) - (a.size || 0))
        .slice(0, 20)
        .map(m => ({ name: m.name, size: m.size }))
    };

    if (showComplexity) {
      (summary as any).mostComplex = modules
        .sort((a, b) => (b.complexity || 0) - (a.complexity || 0))
        .slice(0, 20)
        .map(m => ({ name: m.name, complexity: m.complexity }));
    }

    return summary;
  }

  private formatCircularDependencies(graph: DependencyGraph) {
    return graph.circularDependencies.map(cycle => ({
      cycle: cycle,
      length: cycle.length - 1, // Subtract 1 because last element repeats first
      impact: cycle.length - 1 // Simple impact metric
    }));
  }

  private formatOrphanedFiles(graph: DependencyGraph) {
    return graph.orphanedFiles.map(fileName => {
      const node = graph.nodes.get(fileName)!;
      return {
        name: fileName,
        dependencies: node.dependencies,
        size: node.size,
        complexity: node.complexity
      };
    });
  }

  private formatDependencyGraph(graph: DependencyGraph) {
    const nodes = Array.from(graph.nodes.values()).map(node => ({
      id: node.name,
      type: node.type,
      dependents: node.dependents.length,
      dependencies: node.dependencies.length,
      size: node.size,
      complexity: node.complexity
    }));

    const edges: any[] = [];
    for (const [fileName, node] of graph.nodes.entries()) {
      for (const dependency of node.dependencies) {
        edges.push({
          source: fileName,
          target: dependency,
          type: 'dependency'
        });
      }
    }

    return { nodes, edges };
  }

  private formatFullAnalysis(graph: DependencyGraph, showComplexity: boolean) {
    const modules: any[] = [];
    
    for (const [fileName, node] of graph.nodes.entries()) {
      const moduleInfo: any = {
        name: fileName,
        type: node.type,
        imports: node.imports,
        exports: node.exports,
        dependencies: node.dependencies,
        dependents: node.dependents,
        size: node.size
      };

      if (showComplexity) {
        moduleInfo.complexity = node.complexity;
      }

      if (node.circular.length > 0) {
        moduleInfo.circularDependency = node.circular;
      }

      modules.push(moduleInfo);
    }

    return modules.sort((a, b) => a.name.localeCompare(b.name));
  }
}
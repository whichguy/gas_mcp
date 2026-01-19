/**
 * GuidanceFragments - Reusable llmGuidance patterns + static decision context
 *
 * Like SchemaFragments but for guidance. Provides:
 * 1. Deduplicated guidance blocks (same content, no copy/paste)
 * 2. Static tool selection guidance (help LLM pick right tool)
 * 3. Error resolution matrix (help LLM recover from errors)
 *
 * Usage:
 *   import { GuidanceFragments } from '../utils/guidanceFragments.js';
 *
 *   public inputSchema = {
 *     type: 'object',
 *     properties: { ... },
 *     llmGuidance: {
 *       gitIntegration: GuidanceFragments.gitIntegration,
 *       errorRecovery: GuidanceFragments.errorRecovery,
 *       // ... other guidance
 *     }
 *   };
 */
export class GuidanceFragments {

  // ==========================================
  // TOOL SELECTION GUIDANCE (NEW)
  // ==========================================

  /**
   * Help LLM select the right tool for common operations
   */
  static readonly toolSelectionGuide = {
    readFile: {
      cat: 'Read with CommonJS unwrapping (see clean user code)',
      raw_cat: 'Read raw content (see system wrappers, _main, __defineModule__)',
      recommendation: 'Use cat for normal development, raw_cat for debugging CommonJS issues'
    },
    writeFile: {
      write: 'Auto-wrap with CommonJS (normal use)',
      raw_write: 'No wrapping (system files, templates)',
      edit: 'Exact string replacement (95% token savings vs write)',
      aider: 'Fuzzy string replacement (tolerates whitespace/formatting differences)',
      recommendation: 'edit/aider for small changes, write for new files or major rewrites'
    },
    searchContent: {
      ripgrep: 'PREFERRED: Multi-pattern, context, smart case, stats',
      grep: 'Simple single-pattern (when ripgrep is overkill)',
      recommendation: 'Always try ripgrep first'
    },
    findFiles: {
      find: 'Search by name/type/size patterns',
      ls: 'List all files in project (with optional directory filter)',
      recommendation: 'find for targeted search, ls for overview'
    }
  };

  /**
   * Error resolution matrix - help LLM recover from common errors
   */
  static readonly errorResolutions = {
    syncConflict: {
      cause: 'Local and remote files have diverged',
      check: 'rsync({operation:"plan", scriptId, direction:"pull"})',
      solutions: [
        'rsync to merge changes',
        'force:true to overwrite remote (loses remote changes)'
      ]
    },
    authExpired: {
      cause: 'OAuth token expired or revoked',
      check: 'auth({mode:"status"})',
      solution: 'auth({mode:"start"}) then retry original operation'
    },
    fileNotFound: {
      cause: 'File path may use wrong naming convention',
      check: 'ls({scriptId}) to see actual file names',
      note: 'Virtual names (.gitignore) differ from GAS names (.gitignore.gs)'
    },
    commonJsLoadError: {
      cause: 'Module not loading at startup when needed',
      check: 'Look for "[WARN] No X handlers found" in logs',
      solution: 'Add moduleOptions: { loadNow: true } for event handlers'
    },
    quotaExceeded: {
      cause: 'Google API rate limit hit',
      solution: 'Wait 30-60 seconds, then retry'
    },
    textNotFound: {
      cause: 'Exact text match failed in edit operation',
      check: 'cat file to verify exact text',
      solutions: [
        'Copy-paste exact text from cat output',
        'Use aider for fuzzy matching',
        'Check for invisible characters or line endings'
      ]
    },
    multipleMatches: {
      cause: 'Text appears multiple times in file',
      solution: 'Add index:N (0-based) OR include more surrounding context in oldText'
    }
  };

  // ==========================================
  // DEDUPLICATED GUIDANCE BLOCKS
  // ==========================================

  /**
   * Git integration guidance (used in 8+ write tools)
   * CRITICAL: Write tools do NOT auto-commit
   */
  static readonly gitIntegration = {
    CRITICAL: 'This tool does NOT auto-commit to git',
    behavior: 'File writes push to GAS but do NOT commit locally',
    workflowSignal: 'Response includes git.taskCompletionBlocked=true when uncommitted',
    taskCompletionRule: 'Task is NOT complete while git.uncommittedChanges.count > 0',
    requiredAction: 'git_feature({operation:"commit", scriptId, message:"..."})'
  };

  /**
   * Error recovery guidance (used in 6+ tools)
   */
  static readonly errorRecovery = {
    syncConflict: 'rsync first OR force:true (overwrites remote)',
    authExpired: 'auth({mode:"status"}) -> auth({mode:"start"}) if needed',
    fileLocked: 'Wait 30s (auto-unlock) OR check concurrent writes'
  };

  /**
   * CommonJS processing guidance (used in 10+ tools)
   */
  static readonly commonJsProcessing = {
    behavior: 'Auto-wraps SERVER_JS with CommonJS module system',
    rule: 'Never manually add _main() or __defineModule__',
    htmlJson: 'HTML and JSON files pass through unchanged'
  };

  /**
   * Module options guidance (used in write tools)
   */
  static readonly moduleOptions = {
    loadNow: 'true=eager startup (required for handlers), false=lazy on require(), omit=preserve existing',
    eventHandlerPattern: 'If code has module.exports.__events__, MUST use loadNow:true',
    troubleshooting: 'Log "[WARN] No X handlers found" means missing loadNow:true',
    hoistedFunctions: '[{name,params,jsdoc}] for Sheets custom function autocomplete'
  };

  /**
   * Search tool selection guidance (used in search tools)
   */
  static readonly searchToolHints = {
    ripgrep: 'PREFERRED for all searches: multi-pattern, context control, smart case, stats',
    grep: 'Simple single-pattern only (consider ripgrep instead)',
    sed: 'Find/replace with regex capture groups ($1, $2) - for transformations',
    find: 'File discovery by name/type/size patterns - not for content search'
  };

  /**
   * Edit tool token efficiency guidance
   */
  static readonly editTokenEfficiency = {
    savings: '95%+ vs write (4.5k file+25tok change: write=4.5k | edit=~40tok)',
    idealFor: 'Config changes, renames, typos, small bug fixes (max 20 ops)',
    avoid: 'New files (use write), major refactors (use write), fuzzy matching (use aider)'
  };

  /**
   * Force flag warning (used in tools with force parameter)
   */
  static readonly forceWarning = 'DANGEROUS: Skips sync validation. Use only when intentionally discarding remote changes.';

  /**
   * Anti-patterns for write operations
   */
  static readonly writeAntiPatterns = [
    'write for small edits -> use edit/aider (95% token savings)',
    'manual _main() wrapper -> let write auto-wrap',
    '__events__ without loadNow:true -> handlers won\'t register',
    'assuming auto-commit happened -> MUST call git_feature commit'
  ];

  /**
   * Anti-patterns for edit operations
   */
  static readonly editAntiPatterns = [
    'edit new file -> use write instead',
    'edit >20 operations -> split into multiple calls',
    'guess oldText -> cat first to verify exact content',
    'assuming auto-commit happened -> MUST call git_feature commit'
  ];

  /**
   * Anti-patterns for search operations
   */
  static readonly searchAntiPatterns = [
    'grep for multi-pattern -> use ripgrep instead',
    'grep >200 results needed -> use ripgrep with maxCount',
    'grep without file filter -> add path pattern for efficiency'
  ];

  // ==========================================
  // HELPER METHODS
  // ==========================================

  /**
   * Build standard llmGuidance for write tools
   */
  static buildWriteGuidance(toolSpecificHints: Record<string, any> = {}): Record<string, any> {
    return {
      gitIntegration: GuidanceFragments.gitIntegration,
      commonJs: GuidanceFragments.commonJsProcessing,
      moduleOptions: GuidanceFragments.moduleOptions,
      errorRecovery: GuidanceFragments.errorRecovery,
      antiPatterns: GuidanceFragments.writeAntiPatterns,
      ...toolSpecificHints
    };
  }

  /**
   * Build standard llmGuidance for edit tools (edit, aider, sed)
   */
  static buildEditGuidance(toolSpecificHints: Record<string, any> = {}): Record<string, any> {
    return {
      gitIntegration: GuidanceFragments.gitIntegration,
      tokenEfficiency: GuidanceFragments.editTokenEfficiency,
      errorRecovery: GuidanceFragments.errorRecovery,
      antiPatterns: GuidanceFragments.editAntiPatterns,
      ...toolSpecificHints
    };
  }

  /**
   * Build standard llmGuidance for search tools
   */
  static buildSearchGuidance(toolSpecificHints: Record<string, any> = {}): Record<string, any> {
    return {
      toolSelection: GuidanceFragments.searchToolHints,
      antiPatterns: GuidanceFragments.searchAntiPatterns,
      ...toolSpecificHints
    };
  }
}

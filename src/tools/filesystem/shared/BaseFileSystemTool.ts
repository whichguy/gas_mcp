import { BaseTool } from '../../base.js';
import { GASClient } from '../../../api/gasClient.js';
import { ProjectResolver } from '../../../utils/projectResolver.js';
import { LocalFileManager } from '../../../utils/localFileManager.js';
import { SessionAuthManager } from '../../../auth/sessionManager.js';

/**
 * Optional base class for filesystem tools
 *
 * Provides common dependencies used across all filesystem tools:
 * - GASClient: Google Apps Script API client
 * - ProjectResolver: Current project context resolution
 * - LocalFileManager: Local file caching and sync
 *
 * Tools can optionally extend this class to eliminate constructor duplication.
 * However, tools are also free to extend BaseTool directly (maintaining the
 * flat inheritance pattern seen across all 70+ tools in the codebase).
 *
 * @example
 * // Option 1: Extend BaseFileSystemTool (eliminates constructor duplication)
 * export class CatTool extends BaseFileSystemTool {
 *   public name = 'cat';
 *   // ... no constructor needed, uses inherited one
 * }
 *
 * @example
 * // Option 2: Extend BaseTool directly (flat inheritance pattern)
 * export class CatTool extends BaseTool {
 *   public name = 'cat';
 *   private gasClient: GASClient;
 *   constructor(sessionAuthManager?: SessionAuthManager) {
 *     super(sessionAuthManager);
 *     this.gasClient = new GASClient();
 *   }
 * }
 */
export abstract class BaseFileSystemTool extends BaseTool {
  protected gasClient: GASClient;
  protected projectResolver: ProjectResolver;
  protected localFileManager: LocalFileManager;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.projectResolver = new ProjectResolver();
    this.localFileManager = new LocalFileManager();
  }
}

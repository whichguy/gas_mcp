/**
 * Response hints for MCP tool results.
 * Provides contextual next-action guidance to LLMs.
 */

export interface ResponseHint {
  next?: string;
  related?: string[];
  warning?: string;
}

export function generateReadHints(path: string, moduleOptions?: any): ResponseHint {
  const hints: ResponseHint = {};
  if (moduleOptions?.loadNow) {
    hints.warning = 'loadNow:true — changes take effect immediately on save';
  }
  hints.next = `edit({scriptId, path: "${path}", ...}) to modify`;
  hints.related = ['deps to see imports', 'grep to find usage'];
  return hints;
}

export function generateSearchHints(matchCount: number, hasMore: boolean): ResponseHint {
  const hints: ResponseHint = {};
  if (matchCount === 0) {
    hints.next = 'Try broader pattern or different tool (ripgrep for regex)';
  } else if (hasMore) {
    hints.next = 'Add fileFilter or narrow pattern to reduce results';
  }
  if (matchCount > 50) {
    hints.warning = `${matchCount} matches — consider narrowing search`;
  }
  hints.related = ['cat to read matched files', 'edit to modify'];
  return hints;
}

export function generateExecHints(hadError: boolean): ResponseHint {
  const hints: ResponseHint = {};
  if (hadError) {
    hints.next = 'Check module name and function signature';
    hints.related = ['cat to inspect module source', 'cloud_logs for execution logs'];
  } else {
    hints.related = ['cloud_logs for full logs', 'exec_api for function calls with params'];
  }
  return hints;
}

export function generateDeployHints(environment: string): ResponseHint {
  const hints: ResponseHint = {};
  switch (environment) {
    case 'dev':
      hints.next = 'deploy({operation: "promote", environment: "staging"}) to promote';
      break;
    case 'staging':
      hints.next = 'deploy({operation: "promote", environment: "prod"}) to promote';
      break;
    case 'prod':
      hints.next = 'deploy({operation: "status"}) to verify';
      break;
  }
  hints.related = ['deploy({operation: "status"}) for current state'];
  return hints;
}

export function generateLsHints(itemCount: number, hasScriptId: boolean): ResponseHint {
  const hints: ResponseHint = {};
  if (!hasScriptId) {
    hints.next = 'cat({scriptId, path}) to read a file';
    hints.related = ['project_list for configured projects'];
  } else {
    hints.related = ['cat to read files', 'write to create files', 'deps for dependency graph'];
  }
  return hints;
}

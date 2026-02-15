import { McpGasConfigManager } from '../config/mcpGasConfig.js';

/**
 * MCP Resource: gas://projects
 * Returns list of configured GAS projects from gas-config.json.
 */
export async function listProjects(): Promise<{ uri: string; name: string; description?: string; mimeType: string }[]> {
  const config = await McpGasConfigManager.getConfig();
  const projects = config.projects || {};

  return Object.entries(projects).map(([key, proj]) => ({
    uri: `gas://project/${proj.scriptId}/status`,
    name: proj.name || key,
    description: proj.description || `GAS project ${proj.scriptId}`,
    mimeType: 'application/json'
  }));
}

/**
 * MCP Resource: gas://project/{scriptId}/status
 * Returns project health summary (auth, git, sync, locks).
 */
export async function readProjectStatus(scriptId: string): Promise<string> {
  const config = await McpGasConfigManager.getConfig();
  const projects = config.projects || {};

  // Find the project entry matching this scriptId
  const entry = Object.entries(projects).find(([, p]) => p.scriptId === scriptId);
  if (!entry) {
    return JSON.stringify({ error: `No project configured with scriptId: ${scriptId}` });
  }

  const [key, project] = entry;

  return JSON.stringify({
    projectName: project.name || key,
    scriptId: project.scriptId,
    description: project.description,
    currentProject: config.currentProject?.scriptId === scriptId ? config.currentProject : undefined,
    localRoot: config.localRoot?.rootPath
  }, null, 2);
}

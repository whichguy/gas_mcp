/**
 * Elicitation helper for MCP server (2025-11-25 spec).
 * Requests structured user input via the client.
 * Gracefully falls back when client doesn't support elicitation.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export class ElicitationHelper {
  constructor(private server: Server) {}

  /**
   * Ask user to confirm a destructive action.
   * Returns true if confirmed or if client doesn't support elicitation (fallback).
   */
  async confirmDestructiveAction(description: string): Promise<boolean> {
    try {
      const result = await (this.server as any).elicitInput({
        message: description,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', description: 'Proceed with this action?' }
          },
          required: ['confirm']
        }
      });
      return result.action === 'accept' && result.content?.confirm === true;
    } catch {
      // Client doesn't support elicitation — fall through to default behavior
      return true;
    }
  }

  /**
   * Ask user to select from a list of options.
   * Returns null if client doesn't support elicitation.
   */
  async selectFromOptions(message: string, options: string[]): Promise<string | null> {
    try {
      const result = await (this.server as any).elicitInput({
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            selection: { type: 'string', enum: options, description: 'Select an option' }
          },
          required: ['selection']
        }
      });
      return result.action === 'accept' ? result.content?.selection as string : null;
    } catch {
      return null;
    }
  }
}

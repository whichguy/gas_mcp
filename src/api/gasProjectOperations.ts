/**
 * Project Operations Module
 *
 * This module handles all project-level operations for Google Apps Script API:
 * - List projects
 * - Get project details
 * - Get project content (files)
 * - Get project metadata only
 * - Create new projects
 *
 * Extracted from gasClient.ts for better modularity and maintainability.
 */

import { GASAuthOperations } from './gasAuthOperations.js';
import { GASProject, GASFile } from './gasTypes.js';
import { sortFilesForExecution } from './pathParser.js';

/**
 * Project Operations class
 * Manages Google Apps Script project-level operations
 */
export class GASProjectOperations {
  private authOps: GASAuthOperations;

  constructor(authOps: GASAuthOperations) {
    this.authOps = authOps;
  }

  /**
   * List all accessible projects
   */
  async listProjects(pageSize: number = 10, accessToken?: string): Promise<GASProject[]> {
    return this.authOps.makeApiCall(async () => {
      console.error(`📋 Listing Apps Script projects via Drive API...`);

      const driveApi = this.authOps.getDriveApi();

      // Apps Script projects are Drive files with MIME type 'application/vnd.google-apps.script'
      const response = await driveApi.files.list({
        q: "mimeType='application/vnd.google-apps.script' and trashed=false",
        pageSize,
        fields: 'files(id,name,createdTime,modifiedTime,parents)'
      });

      const files = response.data.files || [];
      console.error(`📊 Found ${files.length} Apps Script projects`);

      return files.map((file: any) => ({
        scriptId: file.id,
        title: file.name,
        parentId: file.parents?.[0],
        createTime: file.createdTime,
        updateTime: file.modifiedTime
      }));
    }, accessToken);
  }

  /**
   * Get project details
   */
  async getProject(scriptId: string, accessToken?: string): Promise<GASProject> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.projects.get({
        scriptId
      });

      return {
        scriptId: response.data.scriptId,
        title: response.data.title,
        parentId: response.data.parentId,
        createTime: response.data.createTime,
        updateTime: response.data.updateTime
      };
    }, accessToken);
  }

  /**
   * Get project content (files)
   */
  async getProjectContent(scriptId: string, accessToken?: string): Promise<GASFile[]> {
    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.projects.getContent({
        scriptId
      });

      const files: GASFile[] = (response.data.files || []).map((file: any) => ({
        name: file.name,
        type: file.type,
        source: file.source,
        // ✅ NEW: Extract timestamp fields that API provides
        createTime: file.createTime,
        updateTime: file.updateTime,
        lastModifyUser: file.lastModifyUser ? {
          name: file.lastModifyUser.name,
          email: file.lastModifyUser.email
        } : undefined,
        functionSet: file.functionSet
      }));

      // Sort files by execution order
      return sortFilesForExecution(files);
    }, accessToken);
  }

  /**
   * Get project metadata only (no source code content)
   * ~100x faster than getProjectContent for sync verification
   */
  async getProjectMetadata(scriptId: string, accessToken?: string): Promise<GASFile[]> {
    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.projects.getContent({
        scriptId,
        // Exclude 'source' field for efficiency - only get metadata
        fields: 'files(name,type,createTime,updateTime,lastModifyUser)'
      });

      const files: GASFile[] = (response.data.files || []).map((file: any) => ({
        name: file.name,
        type: file.type,
        // No source field - metadata only
        createTime: file.createTime,
        updateTime: file.updateTime,
        lastModifyUser: file.lastModifyUser ? {
          name: file.lastModifyUser.name,
          email: file.lastModifyUser.email
        } : undefined
      }));

      return sortFilesForExecution(files);
    }, accessToken);
  }

  /**
   * Create new project
   */
  async createProject(title: string, parentId?: string, accessToken?: string): Promise<GASProject> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      const requestBody: any = {
        title
      };

      // Only include parentId if it's provided (avoid sending undefined)
      if (parentId) {
        requestBody.parentId = parentId;
      }

      console.error(`\n🔍 [PROJECT CREATE] ULTRA DEBUG - Request Details:`);
      console.error(`   📋 Parameters:`);
      console.error(`      - title: "${title}" (length: ${title.length})`);
      console.error(`      - parentId: ${parentId || 'undefined'}`);
      console.error(`      - accessToken: ${accessToken ? 'present (' + accessToken.substring(0, 20) + '...)' : 'undefined'}`);
      console.error(`   📦 Request Body:`);
      console.error(`      - Raw object:`, requestBody);
      console.error(`      - JSON serialized:`, JSON.stringify(requestBody));
      console.error(`      - JSON pretty:`, JSON.stringify(requestBody, null, 2));
      console.error(`      - Body byte length: ${JSON.stringify(requestBody).length}`);
      console.error(`   🌐 API Details:`);
      console.error(`      - Method: POST`);
      console.error(`      - URL: https://script.googleapis.com/v1/projects`);
      console.error(`      - Expected Content-Type: application/json`);
      console.error(`   🔑 Auth Context:`);
      console.error(`      - Client initialized: ${scriptApi ? 'YES' : 'NO'}`);
      console.error(`      - Using session auth: ${!accessToken}`);

      // Capture the raw request before it's sent
      const requestOptions = {
        requestBody
      };
      console.error(`   📋 Final googleapis request options:`, JSON.stringify(requestOptions, null, 2));

      const startTime = Date.now();
      try {
        console.error(`\n🚀 [PROJECT CREATE] MAXIMUM DETAIL - Sending API request...`);
        console.error(`   🌐 EXACT URL: https://script.googleapis.com/v1/projects`);
        console.error(`   📋 METHOD: POST`);
        console.error(`   📦 EXACT PAYLOAD: ${JSON.stringify(requestBody)}`);
        console.error(`   📏 PAYLOAD SIZE: ${JSON.stringify(requestBody).length} bytes`);
        console.error(`   🔑 AUTH HEADER: Bearer ${accessToken ? accessToken.substring(0, 30) + '...[REDACTED]' : '[SESSION_TOKEN]'}`);
        console.error(`   ⏰ REQUEST TIMESTAMP: ${new Date().toISOString()}`);
        console.error(`   🔍 GOOGLEAPIS OPTIONS:`, JSON.stringify(requestOptions, null, 2));
        const response = await scriptApi.projects.create(requestOptions);
        const duration = Date.now() - startTime;

        console.error(`\n✅ [PROJECT CREATE] SUCCESS Response Details:`);
        console.error(`   ⏰ RESPONSE TIME: ${duration}ms`);
        console.error(`   📈 HTTP STATUS: ${response.status}`);
        console.error(`   📋 STATUS TEXT: ${response.statusText}`);
        console.error(`   🌐 RESPONSE URL: ${response.config?.url || 'Unknown'}`);
        console.error(`   📦 RESPONSE HEADERS:`);
        Object.entries(response.headers || {}).forEach(([key, value]) => {
          console.error(`      ${key}: ${value}`);
        });
        console.error(`   📄 RESPONSE BODY:`, JSON.stringify(response.data, null, 2));
        console.error(`   📏 RESPONSE SIZE: ${JSON.stringify(response.data).length} bytes`);
        console.error(`   🔍 FULL RESPONSE CONFIG:`, JSON.stringify(response.config, null, 2));

        return {
          scriptId: response.data.scriptId,
          title: response.data.title,
          parentId: response.data.parentId,
          createTime: response.data.createTime,
          updateTime: response.data.updateTime
        };

      } catch (apiError: any) {
        const errorDuration = Date.now() - startTime;
        console.error(`\n❌ [PROJECT CREATE] MAXIMUM ERROR DETAIL Analysis:`);
        console.error(`   ⏰ ERROR AFTER: ${errorDuration}ms`);
        console.error(`   🔍 ERROR TYPE: ${apiError.constructor?.name}`);
        console.error(`   📋 ERROR MESSAGE: ${apiError.message}`);
        console.error(`   📈 HTTP STATUS: ${apiError.response?.status || apiError.status || 'Unknown'}`);
        console.error(`   📋 STATUS TEXT: ${apiError.response?.statusText || 'Unknown'}`);
        console.error(`   🌐 FAILED URL: ${apiError.config?.url || 'https://script.googleapis.com/v1/projects'}`);
        console.error(`   📋 FAILED METHOD: ${apiError.config?.method || 'POST'}`);

        console.error(`\n📤 ORIGINAL REQUEST DETAILS:`);
        console.error(`   🌐 URL: https://script.googleapis.com/v1/projects`);
        console.error(`   📋 METHOD: POST`);
        console.error(`   📦 SENT PAYLOAD: ${JSON.stringify(requestBody)}`);
        console.error(`   📏 SENT PAYLOAD SIZE: ${JSON.stringify(requestBody).length} bytes`);

        if (apiError.response) {
          console.error(`\n📥 ERROR RESPONSE DETAILS:`);
          console.error(`   📈 RESPONSE STATUS: ${apiError.response.status}`);
          console.error(`   📋 RESPONSE STATUS TEXT: ${apiError.response.statusText}`);
          console.error(`   📦 RESPONSE HEADERS:`);
          Object.entries(apiError.response.headers || {}).forEach(([key, value]) => {
            console.error(`      ${key}: ${value}`);
          });
          console.error(`   📄 RESPONSE BODY:`, JSON.stringify(apiError.response.data, null, 2));
          console.error(`   📏 RESPONSE SIZE: ${JSON.stringify(apiError.response.data || {}).length} bytes`);

          if (apiError.response.config) {
            console.error(`\n🔧 REQUEST CONFIG FROM ERROR:`);
            console.error(`   🌐 CONFIG URL: ${apiError.response.config.url}`);
            console.error(`   📋 CONFIG METHOD: ${apiError.response.config.method}`);
            console.error(`   📦 CONFIG HEADERS:`, JSON.stringify(apiError.response.config.headers, null, 2));
            console.error(`   📄 CONFIG DATA/BODY: ${apiError.response.config.body || apiError.response.config.data || 'None'}`);
            console.error(`   🔧 CONFIG PARAMS:`, JSON.stringify(apiError.response.config.params, null, 2));
          }
        }

        if (apiError.config && !apiError.response) {
          console.error(`\n🔧 ERROR CONFIG (No Response):`);
          console.error(`   🌐 CONFIG URL: ${apiError.config.url}`);
          console.error(`   📋 CONFIG METHOD: ${apiError.config.method}`);
          console.error(`   📦 CONFIG HEADERS:`, JSON.stringify(apiError.config.headers, null, 2));
          console.error(`   📄 CONFIG DATA: ${apiError.config.data || 'None'}`);
        }

        console.error(`\n🔍 COMPLETE ERROR OBJECT:`, JSON.stringify(apiError, null, 2));
        console.error(`\n📋 ERROR STACK TRACE:`);
        console.error(apiError.stack);

        // Re-throw the error to be handled by makeApiCall
        throw apiError;
      }
    }, accessToken);
  }
}

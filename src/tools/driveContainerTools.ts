/**
 * MCP Tools: Google Drive Container and Apps Script Integration
 * Three tools for managing Apps Script associations with Drive containers (Sheets, Docs, Forms, Sites)
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from './base.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { GASErrorHandler } from '../utils/errorHandler.js';
import { MCPValidator } from '../utils/validation.js';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

export interface DriveContainerSearchParams {
  fileName: string;
}

export interface ContainerBindParams {
  containerName: string;
  scriptName: string;
}

export interface ContainerScriptCreateParams {
  containerName: string;
  scriptName?: string;
  description?: string;
}

export interface ContainerMatch {
  fileId: string;
  fileName: string;
  containerType: 'spreadsheet' | 'document' | 'form' | 'site';
  hasScript: boolean;
  scriptId?: string;
  scriptUrl?: string;
  createdTime?: string;
  modifiedTime?: string;
}

export interface DriveSearchResult {
  success: boolean;
  matches: ContainerMatch[];
  totalFound: number;
  error?: string;
}

export interface BindScriptResult {
  success: boolean;
  scriptId?: string;
  containerId?: string;
  containerName?: string;
  scriptUrl?: string;
  error?: string;
}

export interface CreateScriptResult {
  success: boolean;
  scriptId?: string;
  scriptName?: string;
  containerId?: string;
  scriptUrl?: string;
  templateUsed?: string;
  error?: string;
}

// ============================================================================
// TOOL 1: GAS_FIND_DRIVE_SCRIPT
// ============================================================================

export class GASFindDriveScriptTool extends BaseTool {
  
  name = 'gas_find_drive_script';
  description = 'Find Drive containers (Sheets, Docs, Forms, Sites) and check Apps Script association status. Returns scriptId for integration with gas_run and other MCP functions.';
  inputSchema = {
    type: 'object',
    properties: {
      fileName: {
        type: 'string',
        description: 'Name of container file to search for (supports partial matches)'
      }
    },
    required: ['fileName']
  } as const;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.requiresAuthentication = true;
  }

  async execute(params: DriveContainerSearchParams): Promise<DriveSearchResult> {
    try {
      // Validate input parameters
      const validation = MCPValidator.validateParameter({
        field: 'fileName',
        value: params.fileName,
        required: true,
        type: 'string',
        minLength: 1
      });
      if (!validation.isValid) {
        throw new Error(`Invalid parameters: ${validation.errors.join(', ')}`);
      }

      const fileName = params.fileName.trim();
      if (!fileName) {
        throw new Error('fileName cannot be empty');
      }

      console.error(`🔍 Searching for Drive containers: "${fileName}"`);

      // Get access token
      const accessToken = await this.handleApiCall(
        () => this.requireAuthentication(),
        'Google Drive API authentication'
      );

      // Search for all supported container types
      const containerTypes = [
        { mimeType: 'application/vnd.google-apps.spreadsheet', type: 'spreadsheet' as const },
        { mimeType: 'application/vnd.google-apps.document', type: 'document' as const },
        { mimeType: 'application/vnd.google-apps.form', type: 'form' as const },
        { mimeType: 'application/vnd.google-apps.site', type: 'site' as const }
      ];

      const allMatches: ContainerMatch[] = [];

      // Search each container type
      for (const containerType of containerTypes) {
        const searchQuery = `name contains '${fileName.replace(/'/g, "\\'")}' and mimeType='${containerType.mimeType}' and trashed=false`;
        
        const searchResult = await this.handleApiCall(
          () => this.searchDriveFiles(searchQuery, accessToken),
          `${containerType.type} search`
        );

        // Process each match
        for (const file of searchResult.files || []) {
          const scriptId = await this.findAssociatedScript(file.id!, accessToken);
          
          const match: ContainerMatch = {
            fileId: file.id!,
            fileName: file.name!,
            containerType: containerType.type,
            hasScript: scriptId !== null,
            scriptId: scriptId || undefined,
            scriptUrl: scriptId ? `https://script.google.com/d/${scriptId}/edit` : undefined,
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime
          };

          allMatches.push(match);
        }
      }

      // Sort matches by name relevance and modification time
      allMatches.sort((a, b) => {
        // Exact matches first
        const aExact = a.fileName.toLowerCase() === fileName.toLowerCase();
        const bExact = b.fileName.toLowerCase() === fileName.toLowerCase();
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        
        // Then by modification time (newest first)
        const aTime = new Date(a.modifiedTime || 0).getTime();
        const bTime = new Date(b.modifiedTime || 0).getTime();
        return bTime - aTime;
      });

      console.error(`✅ Found ${allMatches.length} matching containers`);

      return {
        success: true,
        matches: allMatches,
        totalFound: allMatches.length
      };

    } catch (error) {
      const errorMessage = GASErrorHandler.extractErrorMessage(error);
      console.error(`❌ Drive container search failed: ${errorMessage}`);
      
      return {
        success: false,
        matches: [],
        totalFound: 0,
        error: errorMessage
      };
    }
  }

  /**
   * Search Google Drive for files matching the query
   */
  private async searchDriveFiles(query: string, accessToken: string): Promise<any> {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,createdTime,modifiedTime)&pageSize=100`;
    
    console.error(`[GOOGLE DRIVE API] Starting search request`);
    console.error(`   Timestamp: ${new Date().toISOString()}`);
    console.error(`   URL: ${url}`);
    console.error(`   Query: ${query}`);
    console.error(`   Auth: Token present (${accessToken.substring(0, 10)}...)`);
    
    const startTime = Date.now();
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const duration = Date.now() - startTime;
    const contentType = response.headers.get('content-type') || 'Unknown';
    console.error(`[GOOGLE DRIVE API] Search response received after ${duration}ms`);
    console.error(`   Status: ${response.status} ${response.statusText}`);
    console.error(`   URL: ${response.url}`);
    console.error(`   Content-Type: ${contentType}`);

    if (!response.ok) {
      let errorText = '';
      let errorHeaders: Record<string, string> = {};
      try {
        errorText = await response.text();
        response.headers.forEach((value, key) => {
          errorHeaders[key] = value;
        });
        console.error(`[GOOGLE DRIVE API ERROR] Search failed`);
        console.error(`   Status: ${response.status} ${response.statusText}`);
        console.error(`   Error body: ${errorText}`);
        console.error(`   Error headers:`, errorHeaders);
        console.error(`   Duration: ${duration}ms`);
      } catch (bodyError) {
        console.warn('Failed to read error response body:', bodyError);
      }
      
      const error = new Error(`Drive API search failed: ${response.status} ${response.statusText} - ${errorText}`);
      (error as any).statusCode = response.status;
      (error as any).statusText = response.statusText;
      (error as any).response = {
        status: response.status,
        statusText: response.statusText,
        headers: errorHeaders,
        url: response.url,
        body: errorText
      };
      throw error;
    }

    let result: any;
    if (contentType.includes('application/json')) {
      result = await response.json();
    } else {
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(`Unexpected response format from Drive API: ${contentType}`);
      }
    }
    
    console.error(`[GOOGLE DRIVE API SUCCESS] Search completed`);
    console.error(`   Files found: ${(result as any).files?.length || 0}`);
    console.error(`   Response size: ${JSON.stringify(result).length} characters`);
    console.error(`   Total duration: ${duration}ms`);
    
    return result;
  }

  /**
   * Find Apps Script project associated with a container
   */
  private async findAssociatedScript(containerId: string, accessToken: string): Promise<string | null> {
    try {
      // List all scripts and check for container bindings
      const scriptsUrl = 'https://script.googleapis.com/v1/projects?pageSize=100';
      
      const scriptsResponse = await fetch(scriptsUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!scriptsResponse.ok) {
        console.error(`Unable to list scripts: ${scriptsResponse.status}`);
        return null;
      }

      const contentType = scriptsResponse.headers.get('content-type') || 'Unknown';
      let scriptsData: any;
      if (contentType.includes('application/json')) {
        scriptsData = await scriptsResponse.json();
      } else {
        const text = await scriptsResponse.text();
        try {
          scriptsData = JSON.parse(text);
        } catch {
          console.error(`Unexpected response format from Scripts API: ${contentType}`);
          return null;
        }
      }
      
      if (scriptsData.projects) {
        for (const project of scriptsData.projects) {
          if (project.parentId === containerId) {
            return project.scriptId;
          }
        }
      }

      return null;

    } catch (error) {
      console.error(`Error checking for associated script: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }
}

// ============================================================================
// TOOL 2: GAS_BIND_SCRIPT
// ============================================================================

export class GASBindScriptTool extends BaseTool {
  
  name = 'gas_bind_script';
  description = 'Bind an existing Apps Script project to a Drive container. Returns scriptId for integration with gas_run and other MCP functions.';
  inputSchema = {
    type: 'object',
    properties: {
      containerName: {
        type: 'string',
        description: 'Name of container (Sheet/Doc/Form/Site) to bind to'
      },
      scriptName: {
        type: 'string',
        description: 'Name of existing Apps Script project to bind'
      }
    },
    required: ['containerName', 'scriptName']
  } as const;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.requiresAuthentication = true;
  }

  async execute(params: ContainerBindParams): Promise<BindScriptResult> {
    try {
      // Validate input parameters
      const containerNameValidation = MCPValidator.validateParameter({
        field: 'containerName',
        value: params.containerName,
        required: true,
        type: 'string',
        minLength: 1
      });
      const scriptNameValidation = MCPValidator.validateParameter({
        field: 'scriptName', 
        value: params.scriptName,
        required: true,
        type: 'string',
        minLength: 1
      });
      
      if (!containerNameValidation.isValid || !scriptNameValidation.isValid) {
        const errors = [...containerNameValidation.errors, ...scriptNameValidation.errors];
        throw new Error(`Invalid parameters: ${errors.join(', ')}`);
      }

      const containerName = params.containerName.trim();
      const scriptName = params.scriptName.trim();

      if (!containerName || !scriptName) {
        throw new Error('containerName and scriptName cannot be empty');
      }

      console.error(`Binding script "${scriptName}" to container "${containerName}"`);

      // Get access token
      const accessToken = await this.handleApiCall(
        () => this.requireAuthentication(),
        'Google Apps Script API authentication'
      );

      // Find the container
      const container = await this.findContainer(containerName, accessToken);
      if (!container) {
        throw new Error(`Container "${containerName}" not found`);
      }

      // Find the script
      const script = await this.findScript(scriptName, accessToken);
      if (!script) {
        throw new Error(`Script "${scriptName}" not found`);
      }

      // Bind the script to the container
      await this.bindScriptToContainer(script.scriptId, container.fileId, accessToken);
      
      console.error(`Successfully bound script to container`);

      return {
        success: true,
        scriptId: script.scriptId,
        containerId: container.fileId,
        containerName: container.fileName,
        scriptUrl: `https://script.google.com/d/${script.scriptId}/edit`
      };

    } catch (error) {
      const errorMessage = GASErrorHandler.extractErrorMessage(error);
      console.error(`Script binding failed: ${errorMessage}`);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Find a container by name
   */
  private async findContainer(containerName: string, accessToken: string): Promise<ContainerMatch | null> {
    const containerTypes = [
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.document', 
      'application/vnd.google-apps.form',
      'application/vnd.google-apps.site'
    ];

    for (const mimeType of containerTypes) {
      const searchQuery = `name='${containerName.replace(/'/g, "\\'")}' and mimeType='${mimeType}' and trashed=false`;
      
      // @ts-ignore - TypeScript incorrectly infers unknown type for Promise<any> return
      const searchResult: any = await this.searchDriveFiles(searchQuery, accessToken);
      
      if (searchResult.files && searchResult.files.length > 0) {
        const file = searchResult.files[0];
        const containerType = mimeType.includes('spreadsheet') ? 'spreadsheet' :
                             mimeType.includes('document') ? 'document' :
                             mimeType.includes('form') ? 'form' : 'site';
        
        return {
          fileId: file.id!,
          fileName: file.name!,
          containerType: containerType as any,
          hasScript: false // Will be updated after binding
        };
      }
    }

    return null;
  }

  /**
   * Find a script by name
   */
  private async findScript(scriptName: string, accessToken: string): Promise<{ scriptId: string; title: string } | null> {
    const scriptsUrl = 'https://script.googleapis.com/v1/projects?pageSize=100';
    
    const response = await fetch(scriptsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      let errorText = '';
      let errorHeaders: Record<string, string> = {};
      try {
        errorText = await response.text();
        response.headers.forEach((value, key) => {
          errorHeaders[key] = value;
        });
      } catch (bodyError) {
        console.warn('Failed to read error response body:', bodyError);
      }
      
      const error = new Error(`Failed to list scripts: ${response.status} ${response.statusText} - ${errorText}`);
      (error as any).statusCode = response.status;
      (error as any).statusText = response.statusText;
      (error as any).response = {
        status: response.status,
        statusText: response.statusText,
        headers: errorHeaders,
        url: response.url,
        body: errorText
      };
      throw error;
    }

    const contentType = response.headers.get('content-type') || 'Unknown';
    let data: any;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Unexpected response format from Scripts API: ${contentType}`);
      }
    }
    
    if (data.projects) {
      for (const project of data.projects) {
        if (project.title === scriptName) {
          return {
            scriptId: project.scriptId,
            title: project.title
          };
        }
      }
    }

    return null;
  }

  /**
   * Bind script to container
   */
  private async bindScriptToContainer(scriptId: string, containerId: string, accessToken: string): Promise<void> {
    // Update the script project to be bound to the container
    const updateUrl = `https://script.googleapis.com/v1/projects/${scriptId}`;
    
    const updateData = {
      parentId: containerId
    };

    const response = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    if (!response.ok) {
      let errorText = '';
      let errorHeaders: Record<string, string> = {};
      try {
        errorText = await response.text();
        response.headers.forEach((value, key) => {
          errorHeaders[key] = value;
        });
      } catch (bodyError) {
        console.warn('Failed to read error response body:', bodyError);
      }
      
      const error = new Error(`Failed to bind script: ${response.status} ${response.statusText} - ${errorText}`);
      (error as any).statusCode = response.status;
      (error as any).statusText = response.statusText;
      (error as any).response = {
        status: response.status,
        statusText: response.statusText,
        headers: errorHeaders,
        url: response.url,
        body: errorText
      };
      throw error;
    }
  }
}

// ============================================================================
// TOOL 3: GAS_CREATE_SCRIPT
// ============================================================================

export class GASCreateScriptTool extends BaseTool {
  
  name = 'gas_create_script';
  description = 'Create new Apps Script project and bind to a Drive container. Generates container-specific starter code. Returns scriptId for integration with gas_run and other MCP functions.';
  inputSchema = {
    type: 'object',
    properties: {
      containerName: {
        type: 'string',
        description: 'Name of container to bind the new script to'
      },
      scriptName: {
        type: 'string',
        description: 'Optional custom name for the new script (auto-generated if not provided)'
      },
      description: {
        type: 'string',
        description: 'Optional description for the new script'
      }
    },
    required: ['containerName']
  } as const;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.requiresAuthentication = true;
  }

  async execute(params: ContainerScriptCreateParams): Promise<CreateScriptResult> {
    try {
      // Validate input parameters
      const validation = MCPValidator.validateParameter({
        field: 'containerName',
        value: params.containerName,
        required: true,
        type: 'string',
        minLength: 1
      });
      if (!validation.isValid) {
        throw new Error(`Invalid parameters: ${validation.errors.join(', ')}`);
      }

      const containerName = params.containerName.trim();
      if (!containerName) {
        throw new Error('containerName cannot be empty');
      }

      console.error(`Creating new script for container "${containerName}"`);

      // Get access token
      const accessToken = await this.handleApiCall(
        () => this.requireAuthentication(),
        'Google Apps Script API authentication'
      );

      // Find the container
      const container = await this.findContainer(containerName, accessToken);
      if (!container) {
        throw new Error(`Container "${containerName}" not found`);
      }

      // Generate script name if not provided
      const scriptName = params.scriptName?.trim() || 
                        `${containerName} - ${this.getContainerTypeName(container.containerType)} Automation Script`;

      // Create the new script project
      const scriptProject = await this.createScriptProject(
        scriptName,
        params.description || `Automation script for ${container.containerType} "${containerName}"`,
        container,
        accessToken
      );

      console.error(`Created script project: ${scriptProject.scriptId}`);

      return {
        success: true,
        scriptId: scriptProject.scriptId,
        scriptName: scriptProject.title,
        containerId: container.fileId,
        scriptUrl: `https://script.google.com/d/${scriptProject.scriptId}/edit`,
        templateUsed: container.containerType
      };

    } catch (error) {
      const errorMessage = GASErrorHandler.extractErrorMessage(error);
      console.error(`Script creation failed: ${errorMessage}`);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Find a container by name
   */
  private async findContainer(containerName: string, accessToken: string): Promise<ContainerMatch | null> {
    const containerTypes = [
      { mimeType: 'application/vnd.google-apps.spreadsheet', type: 'spreadsheet' as const },
      { mimeType: 'application/vnd.google-apps.document', type: 'document' as const },
      { mimeType: 'application/vnd.google-apps.form', type: 'form' as const },
      { mimeType: 'application/vnd.google-apps.site', type: 'site' as const }
    ];

    for (const containerType of containerTypes) {
      const searchQuery = `name='${containerName.replace(/'/g, "\\'")}' and mimeType='${containerType.mimeType}' and trashed=false`;
      
      // @ts-ignore - TypeScript incorrectly infers unknown type for Promise<any> return
      const searchResult: any = await this.searchDriveFiles(searchQuery, accessToken);
      
      if (searchResult.files && searchResult.files.length > 0) {
        const file = searchResult.files[0];
        
        return {
          fileId: file.id!,
          fileName: file.name!,
          containerType: containerType.type,
          hasScript: false
        };
      }
    }

    return null;
  }

  /**
   * Create a new Apps Script project
   */
  private async createScriptProject(
    title: string,
    description: string,
    container: ContainerMatch,
    accessToken: string
  ): Promise<{ scriptId: string; title: string }> {
    
    // Create the project
    const createUrl = 'https://script.googleapis.com/v1/projects';
    
    const projectData = {
      title,
      parentId: container.fileId
    };

    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(projectData)
    });

    if (!createResponse.ok) {
      let errorText = '';
      let errorHeaders: Record<string, string> = {};
      try {
        errorText = await createResponse.text();
        createResponse.headers.forEach((value, key) => {
          errorHeaders[key] = value;
        });
      } catch (bodyError) {
        console.warn('Failed to read error response body:', bodyError);
      }
      
      const error = new Error(`Failed to create script project: ${createResponse.status} ${createResponse.statusText} - ${errorText}`);
      (error as any).statusCode = createResponse.status;
      (error as any).statusText = createResponse.statusText;
      (error as any).response = {
        status: createResponse.status,
        statusText: createResponse.statusText,
        headers: errorHeaders,
        url: createResponse.url,
        body: errorText
      };
      throw error;
    }

    const contentType = createResponse.headers.get('content-type') || 'Unknown';
    let project: any;
    if (contentType.includes('application/json')) {
      project = await createResponse.json();
    } else {
      const text = await createResponse.text();
      try {
        project = JSON.parse(text);
      } catch {
        throw new Error(`Unexpected response format from Scripts API: ${contentType}`);
      }
    }

    // Update the project with starter code
    await this.addStarterCode(project.scriptId, container.containerType, accessToken);

    return {
      scriptId: project.scriptId,
      title: project.title
    };
  }

  /**
   * Add container-specific starter code to the script
   */
  private async addStarterCode(scriptId: string, containerType: string, accessToken: string): Promise<void> {
    const starterCode = this.generateStarterCode(containerType);
    
    const updateUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
    
    const contentData = {
      files: [
        {
          name: 'Code',
          type: 'SERVER_JS',
          source: starterCode
        }
      ]
    };

    const response = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contentData)
    });

    if (!response.ok) {
      let errorText = '';
      let errorHeaders: Record<string, string> = {};
      try {
        errorText = await response.text();
        response.headers.forEach((value, key) => {
          errorHeaders[key] = value;
        });
        console.warn(`Failed to add starter code: ${response.status} ${response.statusText} - ${errorText}`);
        console.warn(`Error headers:`, errorHeaders);
      } catch (bodyError) {
        console.warn(`Failed to add starter code: ${response.status} ${response.statusText}`);
        console.warn('Failed to read error response body:', bodyError);
      }
      // Don't throw error as project was created successfully
    }
  }

  /**
   * Generate container-specific starter code
   */
  private generateStarterCode(containerType: string): string {
    const timestamp = new Date().toISOString();
    
    switch (containerType) {
      case 'spreadsheet':
        return `/**
 * Google Sheets Automation Script
 * Generated: ${timestamp}
 * 
 * This script provides automation functions for Google Sheets.
 */

/**
 * Adds a custom menu to the spreadsheet when opened
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Automation')
    .addItem('Process Data', 'processData')
    .addItem('Generate Report', 'generateReport')
    .addItem('Clear Cache', 'clearCache')
    .addToUi();
}

/**
 * Example function to process spreadsheet data
 */
function processData() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  // Add your data processing logic here
  console.error('Processing', data.length, 'rows of data');
  
  // Example: Add timestamp to processed data
  const timestamp = new Date();
  sheet.getRange(1, sheet.getLastColumn() + 1).setValue('Processed At');
  sheet.getRange(2, sheet.getLastColumn()).setValue(timestamp);
  
  SpreadsheetApp.getUi().alert('Data processing completed!');
}

/**
 * Generate a summary report
 */
function generateReport() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  // Add your report generation logic here
  console.error('Generating report for', data.length, 'rows');
  
  SpreadsheetApp.getUi().alert('Report generated successfully!');
}

/**
 * Custom function that can be used in spreadsheet cells
 * Usage: =CUSTOM_PROCESS(A1:A10)
 */
function CUSTOM_PROCESS(range) {
  if (!range || !Array.isArray(range)) {
    return 'Invalid input';
  }
  
  // Add your custom function logic here
  return range.length;
}

/**
 * Clear any cached data
 */
function clearCache() {
  // Add cache clearing logic here
  console.error('Cache cleared');
  SpreadsheetApp.getUi().alert('Cache cleared!');
}`;

      case 'document':
        return `/**
 * Google Docs Automation Script
 * Generated: ${timestamp}
 * 
 * This script provides automation functions for Google Documents.
 */

/**
 * Adds a custom menu to the document when opened
 */
function onOpen() {
  const ui = DocumentApp.getUi();
  ui.createMenu('Document Automation')
    .addItem('Format Document', 'formatDocument')
    .addItem('Insert Template', 'insertTemplate')
    .addItem('Generate TOC', 'generateTableOfContents')
    .addToUi();
}

/**
 * Format the document with consistent styling
 */
function formatDocument() {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  
  // Set document-wide formatting
  const style = {};
  style[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  style[DocumentApp.Attribute.FONT_SIZE] = 11;
  style[DocumentApp.Attribute.LINE_SPACING] = 1.15;
  
  body.setAttributes(style);
  
  // Format headings
  const paragraphs = body.getParagraphs();
  paragraphs.forEach(paragraph => {
    const text = paragraph.getText();
    if (text.match(/^(Chapter|Section|Part)\\s+\\d+/i)) {
      paragraph.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    }
  });
  
  DocumentApp.getUi().alert('Document formatting completed!');
}

/**
 * Insert a template section
 */
function insertTemplate() {
  const doc = DocumentApp.getActiveDocument();
  const cursor = doc.getCursor();
  
  if (cursor) {
    const element = cursor.insertText('\\n\\n--- TEMPLATE SECTION ---\\n\\n');
    cursor.insertText('Date: ' + new Date().toLocaleDateString() + '\\n');
    cursor.insertText('Author: [Your Name]\\n');
    cursor.insertText('Content: [Add your content here]\\n\\n');
  } else {
    DocumentApp.getUi().alert('Please place your cursor where you want to insert the template');
  }
}

/**
 * Generate table of contents
 */
function generateTableOfContents() {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  
  // Find the first paragraph and insert TOC before it
  const firstParagraph = body.getParagraphs()[0];
  if (firstParagraph) {
    const tocParagraph = body.insertParagraph(0, 'Table of Contents');
    tocParagraph.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    
    // Insert actual TOC
    body.insertTableOfContents(1);
  }
  
  DocumentApp.getUi().alert('Table of contents generated!');
}`;

      case 'form':
        return `/**
 * Google Forms Automation Script
 * Generated: ${timestamp}
 * 
 * This script provides automation functions for Google Forms.
 */

/**
 * Triggered when a form response is submitted
 */
function onFormSubmit(e) {
  const form = FormApp.getActiveForm();
  const responses = e.response.getItemResponses();
  
  console.error('New form submission received');
  
  // Process the form response
  processFormResponse(responses);
  
  // Send confirmation email (if email was collected)
  sendConfirmationEmail(e.response);
  
  // Update summary spreadsheet
  updateSummarySheet(responses);
}

/**
 * Process form response data
 */
function processFormResponse(responses) {
  responses.forEach(response => {
    const question = response.getItem().getTitle();
    const answer = response.getResponse();
    
    console.error('Question:', question);
    console.error('Answer:', answer);
    
    // Add your response processing logic here
  });
}

/**
 * Send confirmation email to respondent
 */
function sendConfirmationEmail(formResponse) {
  // Get email from response (if email collection is enabled)
  const email = formResponse.getRespondentEmail();
  
  if (email) {
    const subject = 'Thank you for your submission';
    const body = \`Dear respondent,

Thank you for submitting the form. We have received your response and will review it shortly.

Best regards,
Form Administrator

Submitted on: \${new Date().toLocaleDateString()}\`;

    try {
      MailApp.sendEmail(email, subject, body);
      console.error('Confirmation email sent to:', email);
    } catch (error) {
      console.error('Failed to send confirmation email:', error);
    }
  }
}

/**
 * Update summary spreadsheet with form data
 */
function updateSummarySheet(responses) {
  try {
    // Create or get summary spreadsheet
    const form = FormApp.getActiveForm();
    const spreadsheet = SpreadsheetApp.openById(form.getDestinationId());
    const summarySheet = spreadsheet.getSheetByName('Summary') || 
                        spreadsheet.insertSheet('Summary');
    
    // Add summary data
    const timestamp = new Date();
    const responseCount = form.getResponses().length;
    
    // Update summary statistics
    summarySheet.getRange(1, 1).setValue('Total Responses');
    summarySheet.getRange(1, 2).setValue(responseCount);
    summarySheet.getRange(2, 1).setValue('Last Updated');
    summarySheet.getRange(2, 2).setValue(timestamp);
    
  } catch (error) {
    console.error('Failed to update summary sheet:', error);
  }
}

/**
 * Setup form triggers and configurations
 */
function setupFormAutomation() {
  const form = FormApp.getActiveForm();
  
  // Delete existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new form submit trigger
  ScriptApp.newTrigger('onFormSubmit')
    .onFormSubmit()
    .create();
    
  console.error('Form automation setup completed');
}`;

      case 'site':
        return `/**
 * Google Sites Automation Script
 * Generated: ${timestamp}
 * 
 * This script provides automation functions for Google Sites.
 */

/**
 * Update site content automatically
 */
function updateSiteContent() {
  // Note: Google Sites has limited direct API access
  // This script focuses on data management and integration
  
  console.error('Updating site-related data...');
  
  // Update site analytics
  updateSiteAnalytics();
  
  // Refresh content from external sources
  refreshExternalContent();
  
  // Generate site reports
  generateSiteReport();
}

/**
 * Update site analytics and usage data
 */
function updateSiteAnalytics() {
  try {
    // Create analytics spreadsheet if it doesn't exist
    const analyticsSheet = getOrCreateAnalyticsSheet();
    
    // Add current timestamp and basic metrics
    const row = analyticsSheet.getLastRow() + 1;
    const timestamp = new Date();
    
    analyticsSheet.getRange(row, 1).setValue(timestamp);
    analyticsSheet.getRange(row, 2).setValue('Site Update');
    analyticsSheet.getRange(row, 3).setValue('Automated check');
    
    console.error('Site analytics updated');
    
  } catch (error) {
    console.error('Failed to update site analytics:', error);
  }
}

/**
 * Refresh content from external sources
 */
function refreshExternalContent() {
  try {
    // Add logic to fetch and process external content
    // This could include RSS feeds, API data, etc.
    
    console.error('External content refreshed');
    
  } catch (error) {
    console.error('Failed to refresh external content:', error);
  }
}

/**
 * Generate site report
 */
function generateSiteReport() {
  try {
    const reportSheet = getOrCreateReportSheet();
    
    // Generate basic site report
    const timestamp = new Date();
    const row = reportSheet.getLastRow() + 1;
    
    reportSheet.getRange(row, 1).setValue(timestamp);
    reportSheet.getRange(row, 2).setValue('Site Status');
    reportSheet.getRange(row, 3).setValue('Active');
    reportSheet.getRange(row, 4).setValue('Automated report generated');
    
    console.error('Site report generated');
    
  } catch (error) {
    console.error('Failed to generate site report:', error);
  }
}

/**
 * Get or create analytics spreadsheet
 */
function getOrCreateAnalyticsSheet() {
  const fileName = 'Site Analytics - ' + new Date().getFullYear();
  
  // Try to find existing spreadsheet
  const files = DriveApp.getFilesByName(fileName);
  
  if (files.hasNext()) {
    const file = files.next();
    return SpreadsheetApp.openById(file.getId()).getActiveSheet();
  } else {
    // Create new spreadsheet
    const spreadsheet = SpreadsheetApp.create(fileName);
    const sheet = spreadsheet.getActiveSheet();
    
    // Set up headers
    sheet.getRange(1, 1).setValue('Timestamp');
    sheet.getRange(1, 2).setValue('Event Type');
    sheet.getRange(1, 3).setValue('Description');
    
    return sheet;
  }
}

/**
 * Get or create report spreadsheet
 */
function getOrCreateReportSheet() {
  const fileName = 'Site Reports - ' + new Date().getFullYear();
  
  // Try to find existing spreadsheet
  const files = DriveApp.getFilesByName(fileName);
  
  if (files.hasNext()) {
    const file = files.next();
    return SpreadsheetApp.openById(file.getId()).getActiveSheet();
  } else {
    // Create new spreadsheet
    const spreadsheet = SpreadsheetApp.create(fileName);
    const sheet = spreadsheet.getActiveSheet();
    
    // Set up headers
    sheet.getRange(1, 1).setValue('Date');
    sheet.getRange(1, 2).setValue('Report Type');
    sheet.getRange(1, 3).setValue('Status');
    sheet.getRange(1, 4).setValue('Notes');
    
    return sheet;
  }
}

/**
 * Schedule automated tasks
 */
function setupSiteAutomation() {
  // Delete existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'updateSiteContent') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create daily trigger for content updates
  ScriptApp.newTrigger('updateSiteContent')
    .timeBased()
    .everyDays(1)
    .atHour(9) // 9 AM
    .create();
    
  console.error('Site automation triggers setup completed');
}`;

      default:
        return `/**
 * Apps Script Automation
 * Generated: ${timestamp}
 * 
 * This script provides basic automation functions.
 */

function main() {
  console.error('Script created successfully!');
  console.error('Container type: ${containerType}');
  console.error('Generated at: ${timestamp}');
  
  // Add your automation logic here
}`;
    }
  }

  /**
   * Get human-readable container type name
   */
  private getContainerTypeName(containerType: string): string {
    switch (containerType) {
      case 'spreadsheet': return 'Spreadsheet';
      case 'document': return 'Document';
      case 'form': return 'Form';
      case 'site': return 'Site';
      default: return 'Container';
    }
  }
} 
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

      console.log(`🔍 Searching for Drive containers: "${fileName}"`);

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

      console.log(`✅ Found ${allMatches.length} matching containers`);

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
  private async searchDriveFiles(query: string, accessToken: string) {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,createdTime,modifiedTime)&pageSize=100`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive API search failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Find Apps Script project associated with a container
   */
  private async findAssociatedScript(containerId: string, accessToken: string): Promise<string | null> {
    try {
      // List all scripts and check for container bindings
      const scriptsUrl = 'https://script.googleapis.com/v1/projects?pageSize=100';
      
      const scriptsResponse = await fetch(scriptsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!scriptsResponse.ok) {
        console.log(`⚠️  Unable to list scripts: ${scriptsResponse.status}`);
        return null;
      }

      const scriptsData = await scriptsResponse.json();
      
      if (scriptsData.projects) {
        for (const project of scriptsData.projects) {
          if (project.parentId === containerId) {
            return project.scriptId;
          }
        }
      }

      return null;

    } catch (error) {
      console.log(`⚠️  Error checking for associated script: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

      console.log(`🔗 Binding script "${scriptName}" to container "${containerName}"`);

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
      
      console.log(`✅ Successfully bound script to container`);

      return {
        success: true,
        scriptId: script.scriptId,
        containerId: container.fileId,
        containerName: container.fileName,
        scriptUrl: `https://script.google.com/d/${script.scriptId}/edit`
      };

    } catch (error) {
      const errorMessage = GASErrorHandler.extractErrorMessage(error);
      console.error(`❌ Script binding failed: ${errorMessage}`);
      
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
      
      const searchResult = await this.searchDriveFiles(searchQuery, accessToken);
      
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
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list scripts: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to bind script: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  /**
   * Search Google Drive for files matching the query
   */
  private async searchDriveFiles(query: string, accessToken: string) {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)&pageSize=10`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive API search failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
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

      console.log(`🆕 Creating new script for container "${containerName}"`);

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

      console.log(`✅ Created script project: ${scriptProject.scriptId}`);

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
      console.error(`❌ Script creation failed: ${errorMessage}`);
      
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
      
      const searchResult = await this.searchDriveFiles(searchQuery, accessToken);
      
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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(projectData)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create script project: ${createResponse.status} ${createResponse.statusText} - ${errorText}`);
    }

    const project = await createResponse.json();

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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contentData)
    });

    if (!response.ok) {
      console.warn(`⚠️  Failed to add starter code: ${response.status}`);
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
  console.log('Processing', data.length, 'rows of data');
  
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
  console.log('Generating report for', data.length, 'rows');
  
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
  console.log('Cache cleared');
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
  
  console.log('New form submission received');
  
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
    
    console.log('Question:', question);
    console.log('Answer:', answer);
    
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
      console.log('Confirmation email sent to:', email);
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
    
  console.log('Form automation setup completed');
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
  
  console.log('Updating site-related data...');
  
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
    
    console.log('Site analytics updated');
    
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
    
    console.log('External content refreshed');
    
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
    
    console.log('Site report generated');
    
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
    
  console.log('Site automation triggers setup completed');
}`;

      default:
        return `/**
 * Apps Script Automation
 * Generated: ${timestamp}
 * 
 * This script provides basic automation functions.
 */

function main() {
  console.log('Script created successfully!');
  console.log('Container type: ${containerType}');
  console.log('Generated at: ${timestamp}');
  
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

  /**
   * Search Google Drive for files matching the query
   */
  private async searchDriveFiles(query: string, accessToken: string) {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)&pageSize=10`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive API search failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  }
} 
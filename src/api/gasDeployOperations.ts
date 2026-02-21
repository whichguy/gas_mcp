/**
 * Deployment Operations Module
 *
 * This module handles all deployment-related operations for Google Apps Script API:
 * - List and get deployments
 * - Create versions and deployments
 * - HEAD deployment management
 * - URL construction utilities
 * - Update content for HEAD deployment
 *
 * Extracted from gasClient.ts for better modularity and maintainability.
 */

import { GASAuthOperations } from './gasAuthOperations.js';
import { GASDeployment, DeploymentOptions, GASFile } from './gasTypes.js';
import { convertToBearerCompatibleUrl } from '../utils/urlParser.js';

/**
 * Deployment Operations class
 * Manages Google Apps Script deployment-level operations
 */
export class GASDeployOperations {
  private authOps: GASAuthOperations;

  constructor(authOps: GASAuthOperations) {
    this.authOps = authOps;
  }

  /**
   * List deployments for a project with enriched details
   * Automatically calls getDeployment for each deployment to include full entry points
   */
  async listDeployments(scriptId: string, accessToken?: string): Promise<GASDeployment[]> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      console.error(`📋 Listing deployments for script: ${scriptId}`);

      // Get basic deployment list
      const response = await scriptApi.projects.deployments.list({
        scriptId
      });

      const basicDeployments = response.data.deployments || [];
      console.error(`🔍 Found ${basicDeployments.length} deployments, enriching in parallel...`);

      // Enrich all deployments in parallel (was sequential N+1 pattern)
      const enrichedDeployments = await Promise.all(
        basicDeployments.map(async (basicDeployment: any) => {
          try {
            return await this.getDeployment(
              scriptId,
              basicDeployment.deploymentId,
              accessToken
            );
          } catch (enrichError: any) {
            console.error(`⚠️  Failed to enrich deployment ${basicDeployment.deploymentId}: ${enrichError.message}`);
            // Fallback to basic deployment info if detailed fetch fails
            return {
              deploymentId: basicDeployment.deploymentId,
              versionNumber: basicDeployment.versionNumber,
              description: basicDeployment.description,
              manifestFileName: basicDeployment.manifestFileName,
              updateTime: basicDeployment.updateTime,
              deploymentConfig: basicDeployment.deploymentConfig,
              entryPoints: basicDeployment.entryPoints
            } as GASDeployment;
          }
        })
      );

      console.error(`✅ Enriched ${enrichedDeployments.length} deployments`);

      // Log summary of web app URLs found
      const webAppCount = enrichedDeployments.filter(d =>
        d.entryPoints?.some((ep: any) => ep.entryPointType === 'WEB_APP' && ep.webApp?.url)
      ).length;
      console.error(`🌐 Found ${webAppCount} deployments with web app URLs`);

      return enrichedDeployments;
    }, accessToken);
  }

  /**
   * Get detailed information about a specific deployment
   * This includes full entry points with web app URLs that are not returned by listDeployments
   */
  async getDeployment(scriptId: string, deploymentId: string, accessToken?: string): Promise<GASDeployment> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      console.error(`🔍 Fetching deployment details: ${deploymentId}`);

      const response = await scriptApi.projects.deployments.get({
        scriptId,
        deploymentId
      });

      console.error(`📦 Deployment details response:`, JSON.stringify(response.data, null, 2));

      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Convert web app URL to gas_run format if present
      if (response.data.entryPoints) {
        console.error(`🔍 Entry points found in deployment:`, JSON.stringify(response.data.entryPoints, null, 2));

        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          const originalUrl = webAppEntry.webApp.url;
          console.error(`🌐 Web App URL found from API: ${originalUrl}`);
          console.error(`🔧 Converting to gas_run URL format...`);
          deployment.webAppUrl = this.constructGasRunUrlFromWebApp(originalUrl);
          console.error(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.error(`🔧 Web App entry point found but no URL`);
        } else {
          console.error(`⚠️  No Web App entry point found`);
        }
      } else {
        console.error(`⚠️  No entry points found in deployment response`);
      }

      return deployment;
    }, accessToken);
  }

  /**
   * Create a version of the project
   */
  async createVersion(scriptId: string, description?: string, accessToken?: string): Promise<any> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.projects.versions.create({
        scriptId,
        requestBody: {
          description: description || 'Version created for deployment'
        }
      });

      return {
        scriptId: response.data.scriptId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        createTime: response.data.createTime
      };
    }, accessToken);
  }

  /**
   * Create a deployment
   */
  async createDeployment(
    scriptId: string,
    description: string,
    options: DeploymentOptions = {},
    versionNumber?: number,
    accessToken?: string
  ): Promise<GASDeployment> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();

      // If no version number provided, create a new version
      let targetVersion = versionNumber;
      if (!targetVersion) {
        console.error('📦 No version specified, creating new version...');
        const version = await this.createVersion(scriptId, `Version for ${description}`, accessToken);
        targetVersion = version.versionNumber;
        console.error(`✅ Created version ${targetVersion}`);
      }

      // Default to API Executable if no entry point type specified
      const entryPointType = options.entryPointType || 'EXECUTION_API';
      const accessLevel = options.accessLevel || 'MYSELF';

      // Build deployment request according to DeploymentConfig schema
      const requestBody: any = {
        versionNumber: targetVersion,
        description,
        manifestFileName: 'appsscript'
      };

      // Log deployment type for debugging
      if (entryPointType === 'WEB_APP') {
        const webAppConfig = options.webAppConfig || {
          access: accessLevel,
          executeAs: 'USER_DEPLOYING'
        };
        console.error(`🌐 Creating Web App deployment with access: ${webAppConfig.access}, executeAs: ${webAppConfig.executeAs}`);
      } else if (entryPointType === 'EXECUTION_API') {
        console.error(`⚙️ Creating API Executable deployment with access: ${accessLevel}`);
      }

      // Note: Entry points are configured automatically by the API based on the app manifest
      // and cannot be specified directly in the deployment creation request

      console.error(`🔧 Creating ${entryPointType} deployment`);
      console.error(`📋 Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await scriptApi.projects.deployments.create({
        scriptId,
        requestBody
      });

      console.error(`📦 Full API Response:`, JSON.stringify(response, null, 2));
      console.error(`📦 Response Data:`, JSON.stringify(response.data, null, 2));
      console.error(`📦 Response Status:`, response.status);
      console.error(`📦 Response Headers:`, JSON.stringify(response.headers, null, 2));

      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber || targetVersion,
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Convert web app URL to gas_run format if present
      if (response.data.entryPoints) {
        console.error(`🔍 Entry points found:`, JSON.stringify(response.data.entryPoints, null, 2));

        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          const originalUrl = webAppEntry.webApp.url;
          console.error(`🌐 Web App URL detected from API: ${originalUrl}`);
          console.error(`🔧 Converting to gas_run URL format...`);
          deployment.webAppUrl = this.constructGasRunUrlFromWebApp(originalUrl);
          console.error(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.error(`🔧 Web App entry point found but no URL`);
        }
      }

      return deployment;
    }, accessToken);
  }

  /**
   * Construct web app URL based on deployment type
   * HEAD deployments (versionNumber=null/0) use /dev
   * Versioned deployments use /exec
   */
  constructWebAppUrl(deploymentId: string, isHeadDeployment: boolean = false): string {
    const urlSuffix = isHeadDeployment ? 'dev' : 'exec';
    return `https://script.google.com/macros/s/${deploymentId}/${urlSuffix}`;
  }

  /**
   * Construct gas_run URL following explicit flow:
   * 1. Get deployment details via API
   * 2. Find the web app entry point
   * 3. Get the actual URL endpoint from that web app
   * 4. Swap /exec to /dev
   */
  async constructGasRunUrl(scriptId: string, accessToken?: string): Promise<string> {
    const startTime = Date.now();
    console.error(`\n🚀 [GAS_URL_CONSTRUCTION] Starting URL construction for script: ${scriptId}`);
    console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
    console.error(`   🔑 Auth Token: ${accessToken ? `Present (${accessToken.substring(0, 10)}...)` : 'Not provided'}`);

    try {
      // ========== STEP 1: GET BASIC DEPLOYMENT LIST ==========
      console.error(`\n📋 [STEP 1] Getting basic deployment list for script: ${scriptId}`);
      const step1StartTime = Date.now();

      await this.authOps.initializeClient(accessToken);
      const scriptApi = this.authOps.getScriptApi();
      console.error(`   ✅ API client initialized successfully`);

      const response = await scriptApi.projects.deployments.list({
        scriptId
      });

      const basicDeployments = response.data.deployments || [];
      const step1Duration = Date.now() - step1StartTime;

      console.error(`   📊 API Response received in ${step1Duration}ms`);
      console.error(`   📦 Found ${basicDeployments.length} total deployments`);

      if (basicDeployments.length === 0) {
        console.error(`   ⚠️  No deployments found - will use fallback URL`);
      } else {
        console.error(`   📋 Deployment IDs found:`);
        basicDeployments.forEach((dep: any, index: number) => {
          console.error(`      ${index + 1}. ${dep.deploymentId} (version: ${dep.versionNumber || 'HEAD'})`);
        });
      }

      // ========== STEP 2 & 3: GET DETAILED DEPLOYMENT INFO AND FIND WEB APP ==========
      console.error(`\n🔍 [STEP 2+3] Checking each deployment for web app entry points`);

      for (let i = 0; i < basicDeployments.length; i++) {
        const basicDeployment = basicDeployments[i];
        const step2StartTime = Date.now();

        console.error(`\n   📦 [DEPLOYMENT ${i + 1}/${basicDeployments.length}] Examining: ${basicDeployment.deploymentId}`);
        console.error(`      📋 Description: ${basicDeployment.description || 'No description'}`);
        console.error(`      🔢 Version: ${basicDeployment.versionNumber || 'HEAD'}`);
        console.error(`      📅 Updated: ${basicDeployment.updateTime || 'Unknown'}`);

        try {
          console.error(`      🌐 Getting detailed deployment information...`);

          // Get detailed deployment info including entry points
          const detailResponse = await scriptApi.projects.deployments.get({
            scriptId,
            deploymentId: basicDeployment.deploymentId
          });

          const step2Duration = Date.now() - step2StartTime;
          console.error(`      ✅ Deployment details retrieved in ${step2Duration}ms`);

          // Step 3: Find the web app entry point
          if (detailResponse.data.entryPoints) {
            const entryPoints = detailResponse.data.entryPoints;
            console.error(`      📋 Found ${entryPoints.length} entry point(s):`);

            entryPoints.forEach((ep: any, epIndex: number) => {
              console.error(`         ${epIndex + 1}. Type: ${ep.entryPointType}`);
              if (ep.entryPointType === 'WEB_APP' && (ep as any).webApp?.url) {
                console.error(`            🌐 Web App URL: ${(ep as any).webApp.url}`);
              }
            });

            const webAppEntry = entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');

            if (webAppEntry?.webApp?.url) {
              const originalUrl = webAppEntry.webApp.url;
              console.error(`      ✅ [SUCCESS] Found WEB_APP entry point with URL!`);
              console.error(`         📍 Original URL: ${originalUrl}`);

              // ========== STEP 4: SWAP /exec TO /dev ==========
              console.error(`\n🔧 [STEP 4] Converting URL for gas_run format`);
              console.error(`   📝 Rule: Replace '/exec' with '/dev' for development endpoint`);

              const gasRunUrl = originalUrl.replace('/exec', '/dev');
              const totalDuration = Date.now() - startTime;

              if (gasRunUrl !== originalUrl) {
                console.error(`   ✅ [SUCCESS] URL conversion completed`);
                console.error(`      📍 Original:  ${originalUrl}`);
                console.error(`      🔄 Converted: ${gasRunUrl}`);
                console.error(`      🎯 Change: Replaced '/exec' → '/dev'`);
              } else {
                console.error(`   ℹ️  URL already in correct format (no /exec found)`);
                console.error(`      📍 Final URL: ${gasRunUrl}`);
              }

              console.error(`\n🎉 [CONSTRUCTION_COMPLETE] Gas_run URL ready!`);
              console.error(`   🔗 Final URL: ${gasRunUrl}`);
              console.error(`   ⏱️  Total time: ${totalDuration}ms`);
              console.error(`   📊 Deployments checked: ${i + 1}/${basicDeployments.length}`);
              console.error(`   🎯 Source: Deployment ${basicDeployment.deploymentId}`);

              return gasRunUrl;

            } else if (webAppEntry) {
              console.error(`      ⚠️  WEB_APP entry point found but missing URL property`);
              console.error(`         🔍 Entry point data:`, JSON.stringify(webAppEntry, null, 10));
            } else {
              console.error(`      ❌ No WEB_APP entry point found in this deployment`);
              console.error(`         📋 Available types: ${entryPoints.map((ep: any) => ep.entryPointType).join(', ')}`);
            }
          } else {
            console.error(`      ❌ No entry points found in deployment response`);
            console.error(`         📋 Response structure:`, JSON.stringify(detailResponse.data, null, 6));
          }

        } catch (detailError: any) {
          const step2Duration = Date.now() - step2StartTime;
          console.error(`      ❌ Failed to get deployment details (${step2Duration}ms)`);
          console.error(`         💬 Error: ${detailError.message}`);
          console.error(`         🔍 Error type: ${detailError.name || 'Unknown'}`);
          if (detailError.code) {
            console.error(`         🔢 Error code: ${detailError.code}`);
          }
        }

        console.error(`      ⏭️  Moving to next deployment...`);
      }

      // ========== FALLBACK: STANDARD FORMAT ==========
      console.error(`\n📋 [FALLBACK] No web app deployments found with URLs`);
      console.error(`   📊 Summary: Checked ${basicDeployments.length} deployments, none had web app URLs`);
      console.error(`   🔄 Using standard gas_run URL format as fallback`);

      const fallbackUrl = `https://script.google.com/macros/s/${scriptId}/dev`;
      const totalDuration = Date.now() - startTime;

      console.error(`\n🎯 [FALLBACK_COMPLETE] Standard format gas_run URL ready!`);
      console.error(`   🔗 Fallback URL: ${fallbackUrl}`);
      console.error(`   ⏱️  Total time: ${totalDuration}ms`);
      console.error(`   📝 Note: This uses scriptId directly (no custom domain)`);

      return fallbackUrl;

    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      console.error(`\n❌ [CONSTRUCTION_ERROR] URL construction failed`);
      console.error(`   ⏱️  Duration: ${totalDuration}ms`);
      console.error(`   💬 Error message: ${error.message}`);
      console.error(`   🔍 Error type: ${error.name || 'Unknown'}`);
      console.error(`   📋 Error details:`, error);

      if (error.code) {
        console.error(`   🔢 Error code: ${error.code}`);
      }
      if (error.status) {
        console.error(`   📊 HTTP status: ${error.status}`);
      }

      console.error(`\n🛡️  [ERROR_FALLBACK] Using emergency fallback URL`);
      const fallbackUrl = `https://script.google.com/macros/s/${scriptId}/dev`;

      console.error(`\n🎯 [ERROR_FALLBACK_COMPLETE] Emergency gas_run URL ready!`);
      console.error(`   🔗 Emergency URL: ${fallbackUrl}`);
      console.error(`   ⏱️  Total time: ${totalDuration}ms`);
      console.error(`   📝 Note: Error fallback - uses scriptId directly`);

      return fallbackUrl;
    }
  }

  /**
   * Construct gas_run URL from existing web app URL - synchronous version
   *
   * CRITICAL FIX: Converts domain-specific URLs to standard format to avoid authentication issues
   *
   * Converts from: https://script.google.com/a/macros/[DOMAIN]/s/[DEPLOYMENT_ID]/exec
   * To:           https://script.google.com/macros/s/[DEPLOYMENT_ID]/dev
   *
   * Domain-specific URLs (/a/macros/[DOMAIN]/) trigger Google Workspace authentication
   * that doesn't accept Bearer tokens from programmatic requests. Standard URLs work
   * with OAuth Bearer token authentication.
   */
  constructGasRunUrlFromWebApp(webAppUrl: string): string {
    console.error(`🔧 [URL_CONVERSION] Converting web app URL for Bearer token compatibility: ${webAppUrl}`);

    // Use shared URL parser utility (with trailing slash support and unified regex)
    const standardUrl = convertToBearerCompatibleUrl(webAppUrl);

    if (standardUrl === webAppUrl) {
      console.error(`⚠️ [URL_CONVERSION] URL conversion unchanged, may be unexpected format: ${webAppUrl}`);
    } else {
      const isDomainSpecific = webAppUrl.includes('/a/macros/');
      const conversionInfo = {
        originalUrl: webAppUrl,
        convertedUrl: standardUrl,
        conversionType: isDomainSpecific ? 'Domain-specific → Standard (Bearer token compatible)' : 'Standard → Standard (HEAD deployment)',
        authenticationCompatible: true,
        bearerTokenSupported: true,
        note: isDomainSpecific
          ? 'Domain-specific URLs work for Workspace users, standard URLs work with Bearer tokens'
          : 'Standard format URL for HEAD deployment access'
      };

      console.error(`✅ [URL_CONVERSION] Conversion details:\n${JSON.stringify(conversionInfo, null, 2)}`);
    }

    return standardUrl;
  }

  /**
   * Check if a deployment is a HEAD deployment
   * HEAD deployments have versionNumber=null, undefined, or 0
   */
  isHeadDeployment(deployment: GASDeployment): boolean {
    return deployment.versionNumber === null ||
           deployment.versionNumber === undefined ||
           deployment.versionNumber === 0;
  }

  /**
   * Check for existing HEAD deployment (versionNumber is null/undefined)
   * HEAD deployments automatically serve the latest saved content
   */
  async findHeadDeployment(scriptId: string, accessToken?: string): Promise<GASDeployment | null> {
    console.error(`🔍 Checking for existing HEAD deployment in script: ${scriptId}`);

    const deployments = await this.listDeployments(scriptId, accessToken);

    // Find deployment with null/undefined versionNumber (HEAD deployment)
    const headDeployment = deployments.find(deployment =>
      deployment.versionNumber === null ||
      deployment.versionNumber === undefined ||
      deployment.versionNumber === 0
    );

    if (headDeployment) {
      console.error(`✅ Found existing HEAD deployment: ${headDeployment.deploymentId}`);
      console.error(`   Description: ${headDeployment.description}`);
      console.error(`   Updated: ${headDeployment.updateTime}`);
      return headDeployment;
    } else {
      console.error(`📭 No HEAD deployment found`);
      return null;
    }
  }

  /**
   * Create a HEAD deployment (serves latest content automatically)
   * HEAD deployments have versionNumber=null and use /dev URLs
   */
  async createHeadDeployment(
    scriptId: string,
    description: string = 'HEAD deployment - serves latest content',
    options: DeploymentOptions = {},
    accessToken?: string
  ): Promise<GASDeployment> {
    console.error(`🚀 Creating HEAD deployment for script: ${scriptId}`);

    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();

      // Default to Web App for HEAD deployments
      const entryPointType = options.entryPointType || 'WEB_APP';
      const accessLevel = options.accessLevel || 'MYSELF';

      // Build HEAD deployment request (NO versionNumber = HEAD deployment)
      const requestBody: any = {
        description,
        manifestFileName: 'appsscript'
        // Note: Omitting versionNumber makes this a HEAD deployment
      };

      // Log deployment configuration
      if (entryPointType === 'WEB_APP') {
        const webAppConfig = options.webAppConfig || {
          access: accessLevel,
          executeAs: 'USER_ACCESSING'
        };
        console.error(`🌐 Creating HEAD Web App deployment`);
        console.error(`   Access: ${webAppConfig.access}`);
        console.error(`   Execute As: ${webAppConfig.executeAs}`);
        console.error(`   Serves: Latest saved content automatically (no redeployment needed)`);
        console.error(`   URL Type: /dev (testing endpoint)`);
      }

      console.error(`🔧 Creating HEAD deployment (versionNumber=null for latest content)`);
      console.error(`📋 Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await scriptApi.projects.deployments.create({
        scriptId,
        requestBody
      });

      console.error(`📦 HEAD deployment created successfully`);
      console.error(`📦 Response Data:`, JSON.stringify(response.data, null, 2));

      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber, // Should be null for HEAD
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Convert web app URL to gas_run format for HEAD deployments
      if (response.data.entryPoints) {
        console.error(`🔍 HEAD deployment entry points:`, JSON.stringify(response.data.entryPoints, null, 2));

        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          const originalUrl = webAppEntry.webApp.url;
          console.error(`🌐 HEAD Web App URL from API: ${originalUrl}`);
          console.error(`🔧 Converting to gas_run URL format for HEAD deployment...`);
          deployment.webAppUrl = this.constructGasRunUrlFromWebApp(originalUrl);
          console.error(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.error(`🔧 Web App entry point found but no URL`);
        }
        console.error(`🔄 This URL will serve the latest content automatically`);
      }

      return deployment;
    }, accessToken);
  }

  /**
   * Ensure HEAD deployment exists - check for existing, create if needed
   * Returns the HEAD deployment with a constant URL for development
   */
  async ensureHeadDeployment(
    scriptId: string,
    description: string = 'Development HEAD deployment',
    options: DeploymentOptions = {},
    accessToken?: string
  ): Promise<{ deployment: GASDeployment; wasCreated: boolean; webAppUrl?: string }> {
    console.error(`🎯 Ensuring HEAD deployment exists for script: ${scriptId}`);

    // Check for existing HEAD deployment
    const existingHead = await this.findHeadDeployment(scriptId, accessToken);

    if (existingHead) {
      console.error(`✅ Using existing HEAD deployment: ${existingHead.deploymentId}`);

      // Convert web app URL to gas_run format for HEAD deployments
      let webAppUrl = existingHead.webAppUrl;
      if (existingHead.entryPoints) {
        const webAppEntry = existingHead.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          // Convert existing URL to gas_run format
          webAppUrl = this.constructGasRunUrlFromWebApp(webAppEntry.webApp.url);
          console.error(`🔧 Using gas_run URL format for HEAD: ${webAppUrl}`);
        }
      }

      return {
        deployment: existingHead,
        wasCreated: false,
        webAppUrl
      };
    }

    // Create new HEAD deployment
    console.error(`🚀 Creating new HEAD deployment...`);
    const newHeadDeployment = await this.createHeadDeployment(scriptId, description, options, accessToken);

    console.error(`✅ HEAD deployment created successfully`);
    console.error(`🌐 Constant URL: ${newHeadDeployment.webAppUrl}`);
    console.error(`🔄 Updates: Use updateProjectContent() to push code changes`);

    return {
      deployment: newHeadDeployment,
      wasCreated: true,
      webAppUrl: newHeadDeployment.webAppUrl
    };
  }

  /**
   * Delete a deployment
   */
  async deleteDeployment(scriptId: string, deploymentId: string, accessToken?: string): Promise<any> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      await scriptApi.projects.deployments.delete({
        scriptId,
        deploymentId
      });

      console.error(`✅ Deployment ${deploymentId} deleted successfully`);
      return { success: true, deploymentId };
    }, accessToken);
  }

  /**
   * Update an existing deployment
   */
  async updateDeployment(
    scriptId: string,
    deploymentId: string,
    updates: any,
    accessToken?: string
  ): Promise<GASDeployment> {
    await this.authOps.initializeClient(accessToken);

    console.error(`🔄 Updating deployment ${deploymentId} in script ${scriptId}`);
    console.error(`   Updates:`, JSON.stringify(updates, null, 2));

    return this.authOps.makeApiCall(async () => {
      // Build the update request body — GAS REST API expects UpdateDeploymentRequest
      const deploymentConfig: any = {
        manifestFileName: 'appsscript',
      };

      if (updates.versionNumber != null) {
        deploymentConfig.versionNumber = updates.versionNumber;
      }

      if (updates.description != null) {
        deploymentConfig.description = updates.description;
      }

      const requestBody: any = { deploymentConfig };

      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.projects.deployments.update({
        scriptId,
        deploymentId,
        requestBody
      });

      // Extract web app URL if present
      let webAppUrl: string | undefined;
      if (response.data.entryPoints) {
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          webAppUrl = webAppEntry.webApp.url;
        }
      }

      console.error(`✅ Deployment updated successfully`);

      return {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        updateTime: response.data.updateTime,
        webAppUrl
      };
    }, accessToken);
  }

  /**
   * Get details for a specific version
   */
  async getVersion(scriptId: string, versionNumber: number, accessToken?: string): Promise<any> {
    await this.authOps.initializeClient(accessToken);

    console.error(`📋 Getting version ${versionNumber} details for script ${scriptId}`);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.projects.versions.get({
        scriptId,
        versionNumber
      });

      console.error(`✅ Retrieved version ${versionNumber} details`);
      return response.data;
    }, accessToken);
  }

  /**
   * List all versions for a project
   */
  async listVersions(
    scriptId: string,
    pageSize: number = 50,
    pageToken?: string,
    accessToken?: string
  ): Promise<any> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const params: any = {
        scriptId,
        pageSize
      };

      if (pageToken) {
        params.pageToken = pageToken;
      }

      console.error(`📋 Listing versions for script ${scriptId}`);

      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.projects.versions.list(params);

      console.error(`✅ Found ${response.data.versions?.length || 0} versions`);

      return {
        versions: response.data.versions || [],
        nextPageToken: response.data.nextPageToken
      };
    }, accessToken);
  }

  /**
   * Update script content for HEAD deployment
   * This is optimized for frequent updates during development
   */
  async updateContentForHeadDeployment(
    scriptId: string,
    files: GASFile[],
    accessToken?: string,
    updateProjectContentFn?: (scriptId: string, files: GASFile[], accessToken?: string) => Promise<GASFile[]>
  ): Promise<{
    files: GASFile[];
    headDeploymentUrl?: string;
    message: string;
  }> {
    console.error(`📝 Updating content for HEAD deployment in script: ${scriptId}`);
    console.error(`📊 Files to update: ${files.length}`);

    // Update the script content
    if (!updateProjectContentFn) {
      throw new Error('updateProjectContentFn must be provided to updateContentForHeadDeployment');
    }
    const updatedFiles = await updateProjectContentFn(scriptId, files, accessToken);

    // Check if HEAD deployment exists to get the URL
    const headDeployment = await this.findHeadDeployment(scriptId, accessToken);
    let headDeploymentUrl = headDeployment?.webAppUrl;

    if (headDeployment && !headDeploymentUrl && headDeployment.entryPoints) {
      const webAppEntry = headDeployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
      if (webAppEntry?.webApp?.url) {
        headDeploymentUrl = webAppEntry.webApp.url;
      }
    }

    const message = headDeployment
      ? `Content updated successfully. HEAD deployment will serve new content automatically at: ${headDeploymentUrl}`
      : `Content updated successfully. No HEAD deployment found - create one with ensureHeadDeployment()`;

    console.error(`✅ ${message}`);

    return {
      files: updatedFiles,
      headDeploymentUrl,
      message
    };
  }
}

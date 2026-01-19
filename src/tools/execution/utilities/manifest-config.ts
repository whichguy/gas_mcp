/**
 * Manifest Configuration Utilities
 *
 * Handles Google Apps Script manifest (appsscript.json) configuration
 * for web app and API executable deployments.
 */

import { GASClient } from '../../../api/gasClient.js';
import { findManifestFile, isManifestFile } from '../../../utils/fileHelpers.js';

/**
 * Helper function to ensure manifest has proper entry point configuration
 * Configures web app or API executable entry points with proper access levels
 *
 * @param gasClient GAS API client instance
 * @param scriptId Script project ID
 * @param entryPointType Type of deployment entry point
 * @param accessLevel Access level for the deployment
 * @param accessToken Optional OAuth access token
 */
export async function ensureManifestEntryPoints(
  gasClient: GASClient,
  scriptId: string,
  entryPointType: 'WEB_APP' | 'EXECUTION_API',
  accessLevel: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS',
  accessToken?: string
): Promise<void> {
  try {
    console.error(`Ensuring manifest configured for ${entryPointType} deployment...`);

    // Get current project content
    const files = await gasClient.getProjectContent(scriptId, accessToken);

    // Find manifest file
    const manifestFile = findManifestFile(files);

    let manifest: any;
    let manifestFileName = 'appsscript'; // Always use 'appsscript' to prevent .json.json issues

    if (!manifestFile || !manifestFile.source) {
      console.error('No manifest file found, creating new appsscript file...');
      manifest = {};
    } else {
      console.error(`Found existing manifest: ${manifestFile.name}`);
      try {
        manifest = JSON.parse(manifestFile.source);
        console.error('Parsed existing manifest successfully');
      } catch (parseError) {
        console.warn('Failed to parse existing manifest, starting fresh...');
        manifest = {};
      }

      // If we found a manifest file, we'll standardize on 'appsscript' filename
      if (isManifestFile(manifestFile.name)) {
        console.error('Will use standard "appsscript" filename to prevent duplicates');
      }
    }

    // Always ensure base properties are set
    manifest.timeZone = manifest.timeZone || 'America/Los_Angeles';
    manifest.dependencies = manifest.dependencies || {};
    manifest.exceptionLogging = manifest.exceptionLogging || 'STACKDRIVER';
    manifest.runtimeVersion = manifest.runtimeVersion || 'V8';

    let needsUpdate = false;

    if (entryPointType === 'WEB_APP') {
      console.error('Configuring manifest for WEB_APP deployment only...');

      // Force web app configuration
      if (!manifest.webapp || manifest.webapp.access !== accessLevel) {
        manifest.webapp = {
          access: accessLevel,
          executeAs: 'USER_ACCESSING'
        };
        needsUpdate = true;
        console.error(`Set webapp configuration: access=${accessLevel}, executeAs=USER_ACCESSING`);
      }

      // CRITICAL: Remove executionApi to prevent library deployment confusion
      if (manifest.executionApi) {
        delete manifest.executionApi;
        needsUpdate = true;
        console.error('Removed executionApi configuration to force web app deployment');
      }

      // Remove library configuration if present
      if (manifest.library) {
        delete manifest.library;
        needsUpdate = true;
        console.error('Removed library configuration to force web app deployment');
      }

    } else if (entryPointType === 'EXECUTION_API') {
      console.error('Configuring manifest for EXECUTION_API deployment...');

      // Ensure executionApi entry point exists for API Executable deployments
      if (!manifest.executionApi || manifest.executionApi.access !== accessLevel) {
        manifest.executionApi = {
          access: accessLevel
        };
        needsUpdate = true;
        console.error(`Set executionApi configuration: access=${accessLevel}`);
      }
    }

    // Update manifest if needed
    if (needsUpdate) {
      const manifestContent = JSON.stringify(manifest, null, 2);

      try {
        // Always use 'appsscript' filename to prevent .json.json double extensions
        console.error(`Updating manifest file: ${manifestFileName}`);
        await gasClient.updateFile(scriptId, manifestFileName, manifestContent, undefined, accessToken);
        console.error(`Updated manifest (${manifestFileName}) with proper entry points for ${entryPointType}`);
        console.error(`Final manifest:`, manifestContent);
      } catch (updateError: any) {
        console.error(`Failed to update manifest: ${updateError.message}`);
        // Don't try alternatives to prevent creating duplicate manifest files
        console.error('Manifest update failed, but deployment can still proceed');
      }
    } else {
      console.error(`Manifest already has proper ${entryPointType} configuration`);
    }

  } catch (error: any) {
    console.error('Failed to update manifest entry points:', error.message);
    // Don't throw error as deployment can still proceed, but log it as error
  }
}

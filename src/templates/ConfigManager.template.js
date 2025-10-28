function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  log = globalThis.__getModuleLogFunction?.(module) || (() => {})
) {
  /**
   * Hierarchical configuration management for Google Apps Script
   * 
   * Supports 5-level priority hierarchy:
   *   1. User+Doc (most specific)
   *   2. Document
   *   3. User-global
   *   4. Domain
   *   5. Script (most general)
   * 
   * Key variants prevent namespace collision:
   *   • DATA     - Application/user data storage
   *   • OVERRIDE - Policy enforcement (admin-forced values)
   *   • DELETE   - One-time purge trigger (self-destructs)
   * 
   * @example
   * const ConfigManager = require('gas-properties/ConfigManager');
   * const config = new ConfigManager('MY_APP');
   * config.set('API_KEY', 'sk-abc123');
   * const key = config.get('API_KEY');
   */
  class ConfigManager {
    /**
     * @param {string} moduleName - Namespace for keys (e.g., 'CLAUDE_CHAT')
     * @param {Object} options - Optional dependency injection for testing
     */
    constructor(moduleName, options = {}) {
      this.module = moduleName;

      // Get document ID if available (container-bound scripts)
      // For standalone scripts, this will be null
      try {
        this.docId = SpreadsheetApp.getActiveSpreadsheet().getId();
      } catch (e) {
        this.docId = null; // Standalone script - no active spreadsheet
      }

      this._cache = null;
      this._cacheTime = 0;
      this.CACHE_TTL = 60000;  // 1 minute

      // Dependency injection for testing
      this.userProps = options.userProps || PropertiesService.getUserProperties();
      this.docProps = options.docProps || PropertiesService.getDocumentProperties();
      this.scriptProps = options.scriptProps || PropertiesService.getScriptProperties();
    }
    
    // ===== PUBLIC API =====
    
    /**
     * Get value with hierarchical fallback
     * Priority: User+Doc → Doc → User → Domain → Script
     * 
     * @param {string} key - Configuration key
     * @param {*} defaultValue - Value to return if key not found (default: null)
     * @returns {string|null} Value or defaultValue if not found
     */
    get(key, defaultValue = null) {
      this._ensureCache();
      
      const layers = [
        { name: 'userDoc', props: this._cache.userDoc, priority: 1 },
        { name: 'doc', props: this._cache.doc, priority: 2 },
        { name: 'userGlobal', props: this._cache.userGlobal, priority: 3 },
        { name: 'domain', props: this._cache.domain, priority: 4 },
        { name: 'script', props: this._cache.script, priority: 5 }
      ];
      
      // Phase 1: Check for DELETE triggers and execute
      for (const layer of layers) {
        const deleteKey = this._getDeleteKey(key);
        if (layer.props[deleteKey]) {
          this._executePurge(key, layer.priority);
          this._invalidateCache();
          this._ensureCache();  // Reload after purge
          break;  // Only execute highest priority DELETE
        }
      }
      
      // Phase 2: Look for OVERRIDE (policy enforcement)
      for (const layer of layers) {
        const overrideKey = this._getOverrideKey(key);
        if (overrideKey in layer.props) {
          return layer.props[overrideKey];
        }
      }
      
      // Phase 3: Look for DATA (normal values)
      for (const layer of layers) {
        const dataKey = this._getDataKey(key);
        if (dataKey in layer.props) {
          return layer.props[dataKey];
        }
      }
      
      return defaultValue;
    }
    
    /**
     * Set value at specified scope
     * 
     * @param {string} key - Configuration key
     * @param {string} value - Value to store
     * @param {string} scope - One of: userDoc, document, user, domain, script
     */
    set(key, value, scope = 'userDoc') {
      this._validatePrivacyScope(key, scope);
      
      const layer = this._getLayerInfo(scope);
      const dataKey = this._getDataKey(key);
      const fullKey = `${layer.prefix}${dataKey}`;
      
      layer.props.setProperty(fullKey, value);
      this._invalidateCache();
    }
    
    // Scope-specific setters for convenience
    setUserDoc(key, value) { this.set(key, value, 'userDoc'); }
    setDocument(key, value) { this.set(key, value, 'document'); }
    setUser(key, value) { this.set(key, value, 'user'); }
    setDomain(key, value) { this.set(key, value, 'domain'); }
    setScript(key, value) { this.set(key, value, 'script'); }
    
    /**
     * Set policy override at scope
     * Base layers (script, domain) can enforce values over user preferences
     * 
     * @param {string} key - Configuration key
     * @param {string} value - Enforced value
     * @param {string} scope - One of: document, domain, script
     */
    setOverride(key, value, scope) {
      if (scope === 'userDoc' || scope === 'user') {
        throw new Error('OVERRIDE not allowed at user scopes (use document/domain/script)');
      }
      
      const layer = this._getLayerInfo(scope);
      const overrideKey = this._getOverrideKey(key);
      const fullKey = `${layer.prefix}${overrideKey}`;
      
      layer.props.setProperty(fullKey, value);
      this._invalidateCache();
    }
    
    // Override shortcuts
    setDocumentOverride(key, value) { this.setOverride(key, value, 'document'); }
    setDomainOverride(key, value) { this.setOverride(key, value, 'domain'); }
    setScriptOverride(key, value) { this.setOverride(key, value, 'script'); }
    
    /**
     * One-time purge: Delete key at scope + all higher priority scopes
     * DELETE trigger self-destructs after execution
     * 
     * @param {string} key - Configuration key
     * @param {string} scope - One of: userDoc, document, user, domain, script
     */
    setDeleteTrigger(key, scope) {
      const scopePriority = this._getScopePriority(scope);
      this._executePurge(key, scopePriority);
      this._invalidateCache();
    }
    
    // Delete trigger shortcuts
    setUserDocDelete(key) { this.setDeleteTrigger(key, 'userDoc'); }
    setDocumentDelete(key) { this.setDeleteTrigger(key, 'document'); }
    setUserDelete(key) { this.setDeleteTrigger(key, 'user'); }
    setDomainDelete(key) { this.setDeleteTrigger(key, 'domain'); }
    setScriptDelete(key) { this.setDeleteTrigger(key, 'script'); }
    
    /**
     * Delete key from scope (cascade upward)
     * Alias for setDeleteTrigger with clearer semantics
     * 
     * @param {string} key - Configuration key
     * @param {string} scope - Starting scope for cascade delete (default: script = all)
     */
    delete(key, scope = 'script') {
      const scopePriority = this._getScopePriority(scope);
      this._executePurge(key, scopePriority);
      this._invalidateCache();
    }
    
    /**
     * Get all keys for this module across all scopes
     * 
     * @returns {Object} Keys grouped by scope
     */
    getAllKeys() {
      this._ensureCache();
      
      return {
        userDoc: Object.keys(this._cache.userDoc),
        doc: Object.keys(this._cache.doc),
        userGlobal: Object.keys(this._cache.userGlobal),
        domain: Object.keys(this._cache.domain),
        script: Object.keys(this._cache.script)
      };
    }
    
    /**
     * Check if key is overridden by policy
     * 
     * @param {string} key - Configuration key
     * @returns {boolean} True if OVERRIDE exists at any level
     */
    isOverridden(key) {
      this._ensureCache();
      
      const layers = [
        this._cache.userDoc,
        this._cache.doc,
        this._cache.userGlobal,
        this._cache.domain,
        this._cache.script
      ];
      
      const overrideKey = this._getOverrideKey(key);
      
      for (const layer of layers) {
        if (overrideKey in layer) {
          return true;
        }
      }
      
      return false;
    }
    
    /**
     * Get which scope enforces override for key
     * 
     * @param {string} key - Configuration key
     * @returns {string|null} Scope name or null if not overridden
     */
    getEnforcementSource(key) {
      this._ensureCache();
      
      const layers = [
        { name: 'userDoc', props: this._cache.userDoc },
        { name: 'document', props: this._cache.doc },
        { name: 'user', props: this._cache.userGlobal },
        { name: 'domain', props: this._cache.domain },
        { name: 'script', props: this._cache.script }
      ];
      
      const overrideKey = this._getOverrideKey(key);
      
      for (const layer of layers) {
        if (overrideKey in layer.props) {
          return layer.name;
        }
      }
      
      return null;
    }
    
    // ===== INTERNAL METHODS =====
    
    /**
     * Ensure cache is valid, refresh if expired
     * Bulk loads all properties (3 API calls instead of 9+)
     * @private
     */
    _ensureCache() {
      if (!this._cache || Date.now() - this._cacheTime > this.CACHE_TTL) {
        // Bulk load all properties (handle null for standalone scripts)
        const userProps = this.userProps ? this.userProps.getProperties() : {};
        const docProps = this.docProps ? this.docProps.getProperties() : {};
        const scriptProps = this.scriptProps ? this.scriptProps.getProperties() : {};

        this._cache = {
          userDoc: this._filterByPrefix(userProps, `${this.docId}_${this.module}_`),
          userGlobal: this._filterByPrefix(userProps, `${this.module}_`, true),
          doc: this._filterByPrefix(docProps, `${this.module}_`),
          domain: this._filterByPrefix(scriptProps, `DOMAIN_${this.module}_`),
          script: this._filterByPrefix(scriptProps, `${this.module}_`, true)
        };
        this._cacheTime = Date.now();
      }
    }
    
    /**
     * Invalidate cache (called on writes)
     * @private
     */
    _invalidateCache() {
      this._cache = null;
      this._cacheTime = 0;
    }
    
    /**
     * Filter properties by prefix, return local keys
     * @private
     */
    _filterByPrefix(props, prefix, excludeDomain = false) {
      const filtered = {};
      
      for (const key in props) {
        // For script scope, exclude DOMAIN_ prefixed keys
        if (excludeDomain && key.startsWith(`DOMAIN_${this.module}_`)) {
          continue;
        }
        
        if (key.startsWith(prefix)) {
          const localKey = key.substring(prefix.length);
          filtered[localKey] = props[key];
        }
      }
      
      return filtered;
    }
    
    /**
     * Execute purge: delete key at scope + all higher priority scopes
     * @private
     */
    _executePurge(key, scopePriority) {
      const scopes = ['userDoc', 'document', 'user', 'domain', 'script'];
      
      // Delete from priority 1 through scopePriority
      for (let i = 0; i < scopePriority; i++) {
        const scope = scopes[i];
        this._deleteKeyFromLayer(key, scope);
      }
    }
    
    /**
     * Delete all variants of key from specific layer
     * @private
     */
    _deleteKeyFromLayer(key, scope) {
      const layer = this._getLayerInfo(scope);
      
      const dataKey = `${layer.prefix}${this._getDataKey(key)}`;
      const overrideKey = `${layer.prefix}${this._getOverrideKey(key)}`;
      const deleteKey = `${layer.prefix}${this._getDeleteKey(key)}`;
      
      layer.props.deleteProperty(dataKey);
      layer.props.deleteProperty(overrideKey);
      layer.props.deleteProperty(deleteKey);
    }
    
    /**
     * Get layer metadata (props service and prefix)
     * @private
     */
    _getLayerInfo(scope) {
      const layers = {
        userDoc: { 
          props: this.userProps, 
          prefix: `${this.docId}_${this.module}_` 
        },
        document: { 
          props: this.docProps, 
          prefix: `${this.module}_` 
        },
        user: { 
          props: this.userProps, 
          prefix: `${this.module}_` 
        },
        domain: { 
          props: this.scriptProps, 
          prefix: `DOMAIN_${this.module}_` 
        },
        script: { 
          props: this.scriptProps, 
          prefix: `${this.module}_` 
        }
      };
      
      return layers[scope];
    }
    
    /**
     * Get scope priority (1 = highest, 5 = lowest)
     * @private
     */
    _getScopePriority(scope) {
      const priorities = {
        userDoc: 1,
        document: 2,
        user: 3,
        domain: 4,
        script: 5
      };
      
      return priorities[scope];
    }
    
    /**
     * Get DATA variant key
     * @private
     */
    _getDataKey(key) {
      return `DATA_${key}`;
    }
    
    /**
     * Get OVERRIDE variant key
     * @private
     */
    _getOverrideKey(key) {
      return `OVERRIDE_${key}`;
    }
    
    /**
     * Get DELETE variant key
     * @private
     */
    _getDeleteKey(key) {
      return `DELETE_${key}`;
    }
    
    /**
     * Validate privacy scope for sensitive keys
     * @private
     */
    _validatePrivacyScope(key, scope) {
      if (ConfigManager.PRIVATE_KEYS.includes(key)) {
        if (scope !== 'userDoc' && scope !== 'user') {
          throw new Error(
            `${key} cannot be stored in ${scope} scope (privacy violation). ` +
            `Use userDoc or user scope only.`
          );
        }
      }
    }
  }

  // Privacy-protected keys (never stored in shared scopes)
  ConfigManager.PRIVATE_KEYS = ['THREAD', 'THINKING_QUEUE'];

  // Export as CommonJS module
  module.exports = ConfigManager;
}

__defineModule__(_main);
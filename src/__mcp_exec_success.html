<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gas Debugger Console</title>
  <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --bg-primary: #1e1e1e;
      --bg-secondary: #252526;
      --bg-tertiary: #2d2d30;
      --text-primary: #cccccc;
      --text-secondary: #858585;
      --border-color: #3e3e42;
      --accent-blue: #0e639c;
      --success-green: #4ec9b0;
      --error-red: #f48771;
      --warning-yellow: #ce9178;
      --type-number: #b5cea8;
      --type-string: #ce9178;
      --type-boolean: #569cd6;
      --type-null: #808080;
      --type-undefined: #808080;
      --type-function: #dcdcaa;
      --type-object: #4ec9b0;
      --type-array: #4fc1ff;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .header h1 {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      flex-shrink: 0;
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      overflow: hidden;
    }

    .info-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-secondary);
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .info-label {
      font-weight: 500;
      color: var(--text-secondary);
    }

    .info-value {
      color: var(--text-primary);
      font-family: 'Consolas', 'Monaco', monospace;
    }

    .copyable {
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }

    .copyable:hover {
      background: var(--bg-primary);
      color: var(--accent-blue);
    }

    .copyable:hover::after {
      content: 'Click to copy';
      position: absolute;
      top: -24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      white-space: nowrap;
      border: 1px solid var(--border-color);
      z-index: 1000;
      pointer-events: none;
    }

    .copyable.copied {
      background: var(--success-green);
      color: white;
    }

    .copyable.copied::after {
      content: 'Copied!' !important;
      background: var(--success-green);
    }

    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 320px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel {
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }

    .panel:last-child {
      flex: 1;
      overflow-y: auto;
    }

    .panel h3 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
      padding: 12px 16px;
      margin: 0;
      background: var(--bg-tertiary);
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .panel-content {
      padding: 8px;
    }

    .panel-content.collapsed {
      display: none;
    }

    .expand-icon {
      font-size: 10px;
      display: inline-block;
      transition: transform 0.2s;
    }

    .expand-icon.collapsed {
      transform: rotate(-90deg);
    }

    .panel-btn {
      background: var(--accent-blue);
      border: none;
      color: white;
      cursor: pointer;
      border-radius: 3px;
      font-size: 10px;
      padding: 2px 8px;
    }

    .panel-btn:hover {
      opacity: 0.9;
    }

    .filter-container {
      padding: 8px;
      display: flex;
      gap: 4px;
      align-items: center;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .filter-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-family: 'Consolas', 'Monaco', monospace;
    }

    .filter-input:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .filter-toggle {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .filter-toggle.active {
      background: var(--accent-blue);
      color: white;
      border-color: var(--accent-blue);
    }

    .filter-clear {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 14px;
      padding: 4px;
      display: flex;
      align-items: center;
      transition: color 0.2s;
    }

    .filter-clear:hover {
      color: var(--text-primary);
    }

    .state-tree-item {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      margin: 2px 0;
    }

    .state-tree-header {
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }

    .state-tree-header:hover {
      background: #3a3a3c;
    }

    .tree-expand-icon {
      font-size: 10px;
      color: var(--text-secondary);
      transition: transform 0.2s;
      flex-shrink: 0;
    }

    .tree-expand-icon.expanded {
      transform: rotate(90deg);
    }

    .tree-expand-icon.leaf {
      opacity: 0;
    }

    .state-emoji {
      font-size: 11px;
      opacity: 0.5;
      margin-left: auto;
      padding-left: 8px;
      flex-shrink: 0;
    }

    .state-key {
      color: var(--success-green);
      font-weight: 500;
      flex-shrink: 0;
      order: -1;
    }

    .state-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-left: 8px;
    }

    .state-value.number {
      color: var(--type-number);
    }

    .state-value.string {
      color: var(--type-string);
    }

    .state-value.boolean {
      color: var(--type-boolean);
    }

    .state-value.null {
      color: var(--type-null);
    }

    .state-value.undefined {
      color: var(--type-undefined);
    }

    .state-value.function {
      color: var(--type-function);
    }

    .state-value.object {
      color: var(--type-object);
    }

    .state-value.array {
      color: var(--type-array);
    }

    .state-tree-children {
      margin-left: 20px;
      margin-top: 2px;
      display: none;
    }

    .state-tree-children.expanded {
      display: block;
    }

    .state-path {
      color: var(--text-secondary);
      font-size: 10px;
      margin-left: 4px;
    }

    .console-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .tab-bar {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      gap: 0;
      padding: 0 16px;
    }

    .tab {
      padding: 8px 16px;
      font-size: 13px;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    .tab.active {
      color: var(--text-primary);
      border-bottom-color: var(--accent-blue);
    }

    .tab:hover:not(.active) {
      color: var(--text-primary);
    }

    .tab-content {
      display: none;
      flex: 1;
      overflow-y: auto;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
      padding: 16px;
      line-height: 1.6;
    }

    .tab-content.active {
      display: block;
    }

    .output-container {
      margin-bottom: 16px;
      padding: 12px;
      background: var(--bg-tertiary);
      border-radius: 6px;
      border-left: 3px solid transparent;
    }

    .output-container.success {
      border-left-color: var(--success-green);
    }

    .output-container.error {
      border-left-color: var(--error-red);
    }

    .output-container.info {
      border-left-color: var(--accent-blue);
    }

    .output-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .replay-btn {
      margin-left: auto;
      background: transparent;
      border: none;
      color: var(--accent-blue);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 14px;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .replay-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    .timestamp {
      color: var(--text-secondary);
      font-size: 11px;
      flex-shrink: 0;
    }

    .output-message {
      margin-bottom: 6px;
      line-height: 1.5;
    }

    .output-message.success {
      color: var(--success-green);
    }

    .output-message.error {
      color: var(--error-red);
    }

    .output-message.info {
      color: var(--accent-blue);
    }

    .timing-info {
      color: var(--text-secondary);
      font-size: 11px;
      font-style: italic;
    }

    .log-toggle {
      color: var(--accent-blue);
      cursor: pointer;
      user-select: none;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      padding: 4px 8px;
      background: var(--bg-secondary);
      border-radius: 4px;
      transition: background 0.2s;
    }

    .log-toggle:hover {
      background: var(--bg-primary);
    }

    .log-arrow {
      font-size: 10px;
      transition: transform 0.2s;
      display: inline-block;
    }

    .log-arrow.expanded {
      transform: rotate(90deg);
    }

    .server-logs {
      margin-top: 8px;
      padding: 10px;
      background: var(--bg-primary);
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 11px;
      white-space: pre-wrap;
      border: 1px solid var(--border-color);
    }

    .server-logs.hidden {
      display: none;
    }

    .input-area {
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      padding: 12px 16px;
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .input-field {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 8px 12px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
    }

    .input-field:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .execute-btn {
      background: var(--accent-blue);
      border: none;
      color: white;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .execute-btn:hover {
      opacity: 0.9;
    }

    .process-item {
      background: var(--bg-tertiary);
      padding: 8px 12px;
      margin-bottom: 6px;
      border-radius: 4px;
      font-size: 12px;
    }

    .process-status {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }

    .process-status.completed {
      background: var(--success-green);
    }

    .process-status.failed {
      background: var(--error-red);
    }

    .scroll-hint {
      position: fixed;
      bottom: 80px;
      right: 40px;
      background: var(--accent-blue);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      z-index: 1000;
    }

    .scroll-hint.visible {
      opacity: 0.9;
      pointer-events: auto;
    }

    .highlight-match {
      background: rgba(255, 255, 0, 0.3);
      padding: 0 2px;
      border-radius: 2px;
    }

    .logs-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .logs-select {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      outline: none;
    }

    .logs-select:hover {
      border-color: var(--accent-blue);
    }

    .logs-select:focus {
      border-color: var(--accent-blue);
    }

    .logs-status {
      color: var(--text-secondary);
      font-size: 11px;
      margin-left: auto;
    }

    #logsContent {
      padding: 16px;
      overflow-y: auto;
      max-height: calc(100% - 60px);
    }

    .log-entry {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      margin-bottom: 12px;
      padding: 10px 12px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      border-left: 3px solid var(--border-color);
      line-height: 1.5;
    }

    .log-entry.info {
      border-left-color: var(--accent-blue);
    }

    .log-entry.warning {
      border-left-color: var(--warning-yellow);
    }

    .log-entry.error {
      border-left-color: var(--error-red);
    }

    .log-entry.success {
      border-left-color: var(--success-green);
    }

    .log-timestamp {
      color: var(--text-secondary);
      font-size: 10px;
      margin-bottom: 4px;
    }

    .log-function {
      color: var(--success-green);
      font-weight: 500;
      margin-bottom: 4px;
    }

    .log-message {
      color: var(--text-primary);
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .log-empty {
      color: var(--text-secondary);
      text-align: center;
      padding: 40px 20px;
      font-size: 13px;
    }

    /* Environment Badge in Header */
    .env-badge-container {
      position: relative;
      margin-left: 8px;
    }

    .env-badge {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }

    .env-badge:hover {
      background: var(--bg-primary);
      border-color: var(--accent-blue);
    }

    .env-badge-icon {
      font-size: 8px;
    }

    .env-badge.dev { border-left: 3px solid var(--warning-yellow); }
    .env-badge.dev .env-badge-icon { color: var(--warning-yellow); }

    .env-badge.staging { border-left: 3px solid var(--accent-blue); }
    .env-badge.staging .env-badge-icon { color: var(--accent-blue); }

    .env-badge.prod { border-left: 3px solid var(--success-green); }
    .env-badge.prod .env-badge-icon { color: var(--success-green); }

    .env-badge-arrow {
      font-size: 8px;
      opacity: 0.5;
    }

    /* Environment Dropdown */
    .env-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      min-width: 320px;
      z-index: 1000;
      overflow: hidden;
    }

    .env-dropdown.hidden {
      display: none;
    }

    .env-dropdown-header {
      padding: 10px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-secondary);
    }

    .env-dropdown-item {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
    }

    .env-dropdown-item:last-of-type {
      border-bottom: none;
    }

    .env-dropdown-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .env-dot {
      font-size: 8px;
    }

    .dev-dot { color: var(--warning-yellow); }
    .staging-dot { color: var(--accent-blue); }
    .prod-dot { color: var(--success-green); }

    .env-current-marker {
      color: var(--success-green);
      font-size: 10px;
      margin-left: auto;
    }

    .env-dropdown-url {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .env-link {
      flex: 1;
      font-size: 10px;
      color: var(--accent-blue);
      text-decoration: none;
      font-family: 'Consolas', monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .env-link:hover {
      text-decoration: underline;
    }

    .env-copy-btn {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
    }

    .env-copy-btn:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .env-promote-btn {
      background: var(--accent-blue);
      border: none;
      color: white;
      padding: 4px 12px;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
      width: 100%;
      margin-top: 4px;
    }

    .env-promote-btn:hover {
      opacity: 0.9;
    }

    .env-dropdown-footer {
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border-top: 1px solid var(--border-color);
    }

    .env-full-mgmt-btn {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 6px 12px;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
      width: 100%;
    }

    .env-full-mgmt-btn:hover {
      background: var(--bg-primary);
      border-color: var(--accent-blue);
    }

    /* Deployments Tab */
    .deployments-container {
      padding: 16px;
    }

    .deployments-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .deployments-header h2 {
      font-size: 18px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .deployment-card {
      background: var(--bg-tertiary);
      border-radius: 6px;
      margin-bottom: 16px;
      overflow: hidden;
      border-left: 4px solid var(--border-color);
    }

    .deployment-card[data-env="dev"] {
      border-left-color: var(--warning-yellow);
    }

    .deployment-card[data-env="staging"] {
      border-left-color: var(--accent-blue);
    }

    .deployment-card[data-env="prod"] {
      border-left-color: var(--success-green);
    }

    .deployment-card-header {
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .deployment-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 3px;
      color: white;
    }

    .dev-badge { background: var(--warning-yellow); }
    .staging-badge { background: var(--accent-blue); }
    .prod-badge { background: var(--success-green); }

    .deployment-current {
      font-size: 11px;
      color: var(--success-green);
      font-weight: 500;
    }

    .deployment-card-body {
      padding: 16px;
    }

    .deployment-url-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .deployment-url-row label {
      font-size: 11px;
      color: var(--text-secondary);
      font-weight: 600;
    }

    .deployment-url {
      flex: 1;
      font-size: 12px;
      font-family: 'Consolas', monospace;
      color: var(--accent-blue);
      text-decoration: none;
    }

    .deployment-url:hover {
      text-decoration: underline;
    }

    .copy-url-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 4px 10px;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
    }

    .copy-url-btn:hover {
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .deployment-info {
      font-size: 11px;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    .deployment-card-footer {
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
    }

    .promote-action-btn {
      background: var(--accent-blue);
      border: none;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      width: 100%;
    }

    .promote-action-btn:hover {
      opacity: 0.9;
    }

    .promote-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Gas Debugger Console</h1>
    <div class="header-info">
      <div class="info-item copyable" id="scriptNameInfo" title="Click to copy script name">
        <span class="info-label">Script:</span>
        <span class="info-value" id="scriptName">Loading...</span>
      </div>
      <div class="info-item copyable" id="scriptIdInfo" title="Click to copy script ID">
        <span class="info-label">ID:</span>
        <span class="info-value" id="scriptId">Loading...</span>
      </div>
      <div class="info-item">
        <span class="info-label">Session:</span>
        <span class="info-value" id="sessionTime">Just now</span>
      </div>

      <!-- Environment Badge with Dropdown -->
      <div class="env-badge-container">
        <button class="env-badge" id="envBadge" title="Click for deployment URLs">
          <span class="env-badge-icon">●</span>
          <span class="env-badge-text">Loading...</span>
          <span class="env-badge-arrow">▾</span>
        </button>

        <div class="env-dropdown hidden" id="envDropdown">
          <div class="env-dropdown-header">Deployments</div>

          <div class="env-dropdown-item" data-env="dev">
            <div class="env-dropdown-label">
              <span class="env-dot dev-dot">●</span> DEV
              <span class="env-current-marker" style="display:none">← current</span>
            </div>
            <div class="env-dropdown-url">
              <a href="#" target="_blank" class="env-link">Loading...</a>
              <button class="env-copy-btn" title="Copy URL">📋</button>
            </div>
          </div>

          <div class="env-dropdown-item" data-env="staging">
            <div class="env-dropdown-label">
              <span class="env-dot staging-dot">●</span> STAGING
              <span class="env-current-marker" style="display:none">← current</span>
            </div>
            <div class="env-dropdown-url">
              <a href="#" target="_blank" class="env-link">Not deployed</a>
              <button class="env-copy-btn" title="Copy URL">📋</button>
            </div>
            <button class="env-promote-btn" data-from="dev" data-to="staging">
              Promote from Dev →
            </button>
          </div>

          <div class="env-dropdown-item" data-env="prod">
            <div class="env-dropdown-label">
              <span class="env-dot prod-dot">●</span> PROD
              <span class="env-current-marker" style="display:none">← current</span>
            </div>
            <div class="env-dropdown-url">
              <a href="#" target="_blank" class="env-link">Not deployed</a>
              <button class="env-copy-btn" title="Copy URL">📋</button>
            </div>
            <button class="env-promote-btn" data-from="staging" data-to="prod">
              Promote from Staging →
            </button>
          </div>

          <div class="env-dropdown-footer">
            <button class="env-full-mgmt-btn" data-tab="deployments">
              ⚙️ Full Management
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="main-container">
    <div class="sidebar">
      <div class="panel">
        <h3>
          <span class="expand-icon">▼</span>Client State
          <button class="panel-btn" id="clearStateBtn" style="margin-left: auto;">Clear</button>
        </h3>
        <div class="filter-container">
          <input type="text" class="filter-input" id="stateFilter" placeholder="Filter...">
          <button class="filter-toggle" id="filterToggle" title="Toggle search mode">Names</button>
          <button class="filter-clear" id="filterClear" title="Clear filter">✕</button>
        </div>
        <div class="panel-content" id="clientStatePanel">
          <div style="color: var(--text-secondary); font-size: 11px; padding: 8px;">No variables stored</div>
        </div>
      </div>

      <div class="panel">
        <h3>
          <span class="expand-icon">▼</span>Recent Processes
          <button class="panel-btn" id="refreshProcessesBtn" style="margin-left: auto;">Refresh</button>
        </h3>
        <div class="panel-content" id="processesPanel">
          <div id="processesList"></div>
        </div>
      </div>
    </div>

    <div class="console-area">
      <div class="tab-bar">
        <button class="tab active" data-tab="console">Console</button>
        <button class="tab" data-tab="logs">Logs</button>
        <button class="tab" data-tab="deployments">Deployments</button>
      </div>

      <div class="tab-content active" id="console"></div>
      <div class="tab-content" id="logs">
        <div class="logs-controls">
          <select id="logsTimeRange" class="logs-select">
            <option value="15">Last 15 minutes</option>
            <option value="60">Last 1 hour</option>
            <option value="360">Last 6 hours</option>
            <option value="1800">Last 30 hours</option>
            <option value="0">All logs</option>
          </select>
          <button class="panel-btn" id="refreshLogsBtn">Refresh</button>
          <span class="logs-status" id="logsStatus"></span>
        </div>
        <div id="logsContent"></div>
      </div>

      <div class="tab-content" id="deployments">
        <div class="deployments-container">
          <div class="deployments-header">
            <h2>Deployment Management</h2>
            <button class="panel-btn" id="refreshDeploymentsTab">Refresh</button>
          </div>

          <div class="deployment-card" data-env="dev">
            <div class="deployment-card-header">
              <span class="deployment-badge dev-badge">DEV</span>
              <span class="deployment-current" style="display:none">Current Environment</span>
            </div>
            <div class="deployment-card-body">
              <div class="deployment-url-row">
                <label>URL:</label>
                <a href="#" target="_blank" class="deployment-url">Loading...</a>
                <button class="copy-url-btn">Copy</button>
              </div>
              <div class="deployment-info">
                <p>HEAD deployment - always reflects latest code</p>
              </div>
            </div>
            <div class="deployment-card-footer">
              <button class="promote-action-btn" data-to="staging">
                Promote to Staging →
              </button>
            </div>
          </div>

          <div class="deployment-card" data-env="staging">
            <div class="deployment-card-header">
              <span class="deployment-badge staging-badge">STAGING</span>
              <span class="deployment-current" style="display:none">Current Environment</span>
            </div>
            <div class="deployment-card-body">
              <div class="deployment-url-row">
                <label>URL:</label>
                <a href="#" target="_blank" class="deployment-url">Not deployed</a>
                <button class="copy-url-btn">Copy</button>
              </div>
              <div class="deployment-info">
                <p>Versioned deployment - snapshot for testing</p>
              </div>
            </div>
            <div class="deployment-card-footer">
              <button class="promote-action-btn" data-to="prod">
                Promote to Production →
              </button>
            </div>
          </div>

          <div class="deployment-card" data-env="prod">
            <div class="deployment-card-header">
              <span class="deployment-badge prod-badge">PROD</span>
              <span class="deployment-current" style="display:none">Current Environment</span>
            </div>
            <div class="deployment-card-body">
              <div class="deployment-url-row">
                <label>URL:</label>
                <a href="#" target="_blank" class="deployment-url">Not deployed</a>
                <button class="copy-url-btn">Copy</button>
              </div>
              <div class="deployment-info">
                <p>Production deployment - stable release</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="input-area">
        <input
          type="text"
          class="input-field"
          id="codeInput"
          placeholder="Execute javascript statement, use run('code') for server execution"
        >
        <button class="execute-btn" id="executeBtn">Execute</button>
      </div>
    </div>
  </div>

  <div class="scroll-hint" id="scrollHint">New output ↓</div>

  <script>
    window.StateRenderer = {
      filterText: '',
      filterMode: 'names', // 'names' or 'values'

      getTypeEmoji: function(value) {
        const type = typeof value;
        if (value === null) return '⊘';
        if (value === undefined) return '∅';
        if (Array.isArray(value)) return '[]';
        if (type === 'object') {
          if (value instanceof Map) return 'ᴍ';
          if (value instanceof Set) return 'ꜱ';
          if (value instanceof Date) return 'ᴛ';
          return '{}';
        }
        if (type === 'string') return '""';
        if (type === 'number') return '#';
        if (type === 'boolean') return value ? '✓' : '✗';
        if (type === 'function') return 'ƒ';
        return '?';
      },

      getTypeClass: function(value) {
        const type = typeof value;
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (Array.isArray(value)) return 'array';
        if (type === 'object') return 'object';
        return type;
      },

      formatValue: function(value, maxLength = 40) {
        const type = typeof value;
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (type === 'string') return '"' + (value.length > maxLength ? value.substring(0, maxLength) + '...' : value) + '"';
        if (type === 'function') return 'ƒ()';
        if (Array.isArray(value)) return '[' + value.length + ']';
        if (type === 'object') {
          const keys = Object.keys(value);
          return '{' + keys.length + '}';
        }
        return String(value);
      },

      isExpandable: function(value) {
        return value !== null && value !== undefined && (typeof value === 'object' || Array.isArray(value));
      },

      matchesFilter: function(key, value, path = []) {
        if (!this.filterText) return { matches: true, path: null };

        const searchText = this.filterText.toLowerCase();
        const fullPath = [...path, key];

        // Search in names
        if (this.filterMode === 'names') {
          if (key.toLowerCase().includes(searchText)) {
            return { matches: true, path: fullPath, matchedAt: 'key' };
          }
        } else {
          // Search in values
          const valueStr = this.formatValue(value).toLowerCase();
          if (valueStr.includes(searchText)) {
            return { matches: true, path: fullPath, matchedAt: 'value' };
          }
        }

        // Search in nested objects
        if (this.isExpandable(value)) {
          const entries = Array.isArray(value)
            ? value.map((v, i) => [String(i), v])
            : Object.entries(value);

          for (const [nestedKey, nestedValue] of entries) {
            const nestedResult = this.matchesFilter(nestedKey, nestedValue, fullPath);
            if (nestedResult.matches) {
              return nestedResult;
            }
          }
        }

        return { matches: false, path: null };
      },

      highlightMatch: function(text) {
        if (!this.filterText) return text;
        const searchText = this.filterText;
        const regex = new RegExp('(' + searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return text.replace(regex, '<span class="highlight-match">$1</span>');
      },

      renderTreeItem: function(key, value, path = [], forceShow = false) {
        const filterResult = this.matchesFilter(key, value, path.slice(0, -1));

        if (!forceShow && !filterResult.matches) {
          return null;
        }

        const $item = $('<div class="state-tree-item">');
        const $header = $('<div class="state-tree-header">');

        const isExpandable = this.isExpandable(value);
        const expandIcon = isExpandable ? '▶' : '·';
        const $expandIcon = $('<span class="tree-expand-icon' + (isExpandable ? '' : ' leaf') + '">').text(expandIcon);

        const emoji = this.getTypeEmoji(value);
        const $emoji = $('<span class="state-emoji">').text(emoji);

        const displayKey = this.filterMode === 'names' ? this.highlightMatch(key) : key;
        const $key = $('<span class="state-key">').html(displayKey);

        const typeClass = this.getTypeClass(value);
        const displayValue = this.formatValue(value);
        const highlightedValue = this.filterMode === 'values' ? this.highlightMatch(displayValue) : displayValue;
        const $value = $('<span class="state-value ' + typeClass + '">').html(highlightedValue);

        $header.append($expandIcon, $key, $value, $emoji);

        // Add path if this is a nested match
        if (filterResult.path && filterResult.path.length > 1 && this.filterText) {
          const pathStr = filterResult.path.slice(0, -1).join(' › ');
          const $path = $('<span class="state-path">').text('(' + pathStr + ')');
          $header.append($path);
        }

        $item.append($header);

        if (isExpandable) {
          const $children = $('<div class="state-tree-children">');
          const entries = Array.isArray(value)
            ? value.map((v, i) => [String(i), v])
            : Object.entries(value);

          entries.forEach(([childKey, childValue]) => {
            const childPath = [...path, childKey];
            const $child = this.renderTreeItem(childKey, childValue, childPath, filterResult.matches);
            if ($child) {
              $children.append($child);
            }
          });

          $item.append($children);

          $header.on('click', function(e) {
            e.stopPropagation();
            $expandIcon.toggleClass('expanded');
            $children.toggleClass('expanded');
          });
        }

        return $item;
      },

      render: function(storage) {
        const $panel = $('#clientStatePanel');
        const keys = Object.keys(storage);

        if (keys.length === 0) {
          $panel.html('<div style="color: var(--text-secondary); font-size: 11px; padding: 8px;">No variables stored</div>');
          return;
        }

        $panel.empty();

        let hasVisibleItems = false;
        keys.forEach((key) => {
          const value = storage[key];
          const $item = this.renderTreeItem(key, value, [key], false);
          if ($item) {
            $panel.append($item);
            hasVisibleItems = true;
          }
        });

        if (!hasVisibleItems && this.filterText) {
          $panel.html('<div style="color: var(--text-secondary); font-size: 11px; padding: 8px;">No matches found</div>');
        }
      }
    };

    window.clientState = {
      storage: {},

      set: function(key, value) {
        this.storage[key] = value;
        window.StateRenderer.render(this.storage);
      },

      get: function(key) {
        return this.storage[key];
      },

      delete: function(key) {
        delete this.storage[key];
        window.StateRenderer.render(this.storage);
      },

      clear: function() {
        this.storage = {};
        window.StateRenderer.render(this.storage);
      },

      run: function(serverCode, clientCommand) {
        const startTime = performance.now();

        return new Promise((resolve, reject) => {
          if (!google || !google.script || !google.script.run) {
            const clientTime = (performance.now() - startTime).toFixed(2);
            window.UI.addOutput('Cannot execute: google.script.run not available', 'error', null, 'client: ' + clientTime + 'ms');
            reject(new Error('google.script.run not available'));
            return;
          }

          google.script.run
            .withSuccessHandler(function(response) {
              const clientTime = (performance.now() - startTime).toFixed(2);
              const serverTime = response.execution_time_ms || 0;
              const timing = 'client: ' + clientTime + 'ms, server: ' + serverTime + 'ms';

              // Check if execution succeeded (not just HTTP call)
              if (!response || response.success !== true) {
                const errorMsg = response ? (response.error || response.message || String(response.result) || JSON.stringify(response)) : 'No response';
                window.UI.addOutput(
                  'Error: ' + errorMsg,
                  'error',
                  response ? response.logger_output : null,
                  timing
                );
                reject(new Error(errorMsg));
                return;
              }

              // Execution succeeded - display result without "SUCCESS" text
              const displayResult = typeof response.result === 'object'
                ? JSON.stringify(response.result, null, 2)
                : String(response.result);

              window.UI.addOutput(
                displayResult,
                'success',
                response.logger_output,
                timing
              );

              // Mark result as already displayed to prevent duplicate output
              const wrappedResult = { __runHandled: true, value: response.result };
              resolve(wrappedResult);
            })
            .withFailureHandler(function(error) {
              const clientTime = (performance.now() - startTime).toFixed(2);
              window.UI.addOutput('Execution failed: ' + error.message, 'error', null, 'client: ' + clientTime + 'ms');
              reject(error);
            })
            .invoke(serverCode);
        });
      },

      inspectAndUpdate: function(statement, result) {
        const assignmentMatch = statement.trim().match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/);

        if (assignmentMatch && result !== undefined) {
          const varName = assignmentMatch[1];

          if (!statement.includes('==') && !statement.includes('!=')) {
            clientState.storage[varName] = result;
            window.StateRenderer.render(this.storage);
          }
        }
      }
    };

    window.UI = {
      addOutput: function(message, type, serverLogs, timing, command) {
        const $console = $('#console');

        // Echo the command if provided (like a REPL prompt)
        if (command && command.trim()) {
          const $commandEcho = $('<div style="color: var(--text-secondary); font-family: Consolas, Monaco, monospace; font-size: 13px; margin-bottom: 8px; padding: 4px 8px; background: var(--bg-secondary); border-radius: 3px; display: flex; align-items: center; gap: 8px;">');
          const $commandText = $('<span>').text('> ' + command);
          const $replayBtn = $('<button class="replay-btn" style="margin-left: auto;" title="Re-run this command">↻</button>');
          $replayBtn.on('click', function() {
            $('#codeInput').val(command);
            window.CodeExecutor.execute();
          });
          $commandEcho.append($commandText, $replayBtn);
          $console.append($commandEcho);
        }

        const now = new Date();
        const timestamp = '[' + now.getHours().toString().padStart(2, '0') + ':' +
                         now.getMinutes().toString().padStart(2, '0') + ':' +
                         now.getSeconds().toString().padStart(2, '0') + ' ' +
                         (now.getHours() >= 12 ? 'PM' : 'AM') + ']';

        const $container = $('<div>').addClass('output-container ' + type);

        const $header = $('<div class="output-header">' +
          '<span class="timestamp">' + timestamp + '</span>' +
          '</div>');

        const $message = $('<div class="output-message ' + type + '">').text(message);

        const $timing = $('<div class="timing-info">').text(timing || '');

        $container.append($header);
        $container.append($message);
        if (timing) {
          $container.append($timing);
        }

        if (serverLogs && serverLogs.trim()) {
          const logId = 'logs-' + Date.now();

          const $toggle = $('<div class="log-toggle" data-target="' + logId + '">' +
            '<span class="log-arrow">▶</span>' +
            '<span>Server logs</span>' +
            '</div>');

          const $logContent = $('<div class="server-logs hidden" id="' + logId + '">').text(serverLogs);

          $toggle.on('click', function() {
            const targetId = $(this).data('target');
            const $content = $('#' + targetId);
            const $arrow = $(this).find('.log-arrow');

            $content.toggleClass('hidden');
            $arrow.toggleClass('expanded');
          });

          $container.append($toggle);
          $container.append($logContent);
        }

        $console.append($container);

        const isAtBottom = $console[0].scrollHeight - $console.scrollTop() <= $console.outerHeight() + 100;

        if (isAtBottom) {
          $console.scrollTop($console[0].scrollHeight);
        } else {
          $('#scrollHint').addClass('visible');
          setTimeout(function() {
            $('#scrollHint').removeClass('visible');
          }, 2000);
        }
      }
    };

    window.DataLoader = {
      loadScriptInfo: function() {
        if (!google || !google.script || !google.script.run) {
          console.error('google.script.run not available');
          return;
        }

        google.script.run
          .withSuccessHandler(function(info) {
            if (info && info.scriptId) {
              $('#scriptId').text(info.scriptId);
              $('#scriptName').text(info.projectName || 'Unknown');
            }
          })
          .withFailureHandler(function(error) {
            console.error('Failed to load script info:', error);
            $('#scriptId').text('Error loading');
            $('#scriptName').text('Error loading');
          })
          .getScriptInfo();
      },

      loadProcesses: function() {
        const $processes = $('#processesList');
        $processes.html('<div style="padding: 8px; color: var(--text-secondary); font-size: 11px;">Loading processes...</div>');

        if (!google || !google.script || !google.script.run) {
          $processes.html('<div style="padding: 8px; color: var(--error-red); font-size: 11px;">google.script.run not available</div>');
          return;
        }

        google.script.run
          .withSuccessHandler(function(response) {
            if (!response || !response.success) {
              $processes.html('<div style="padding: 8px; color: var(--error-red); font-size: 11px;">' + (response ? response.error : 'Failed to load processes') + '</div>');
              return;
            }

            const processes = response.processes || [];
            if (processes.length === 0) {
              $processes.html('<div style="padding: 8px; color: var(--text-secondary); font-size: 11px;">No recent processes</div>');
              return;
            }

            $processes.empty();
            processes.forEach(function(proc) {
              const $item = $('<div class="process-item">');
              const statusClass = proc.status === 'COMPLETED' ? 'completed' : 'failed';
              const $status = $('<span class="process-status ' + statusClass + '">');
              const time = new Date(proc.startTime).toLocaleTimeString();
              const duration = proc.duration ? ' (' + proc.duration + 'ms)' : '';
              const $text = $('<span>').text(proc.functionName + ' - ' + time + duration);
              $item.append($status, $text);
              $processes.append($item);
            });
          })
          .withFailureHandler(function(error) {
            $processes.html('<div style="padding: 8px; color: var(--error-red); font-size: 11px;">Error: ' + error.message + '</div>');
          })
          .getRecentProcesses();
      },

      loadLogs: function(minutes) {
        const $content = $('#logsContent');
        const $status = $('#logsStatus');

        $content.html('<div class="log-empty">Loading logs...</div>');
        $status.text('Loading...');

        if (!google || !google.script || !google.script.run) {
          $content.html('<div class="log-empty">google.script.run not available</div>');
          $status.text('');
          return;
        }

        google.script.run
          .withSuccessHandler(function(response) {
            if (!response || !response.success) {
              $content.html('<div class="log-empty">' + (response ? response.error : 'Failed to load logs') + '</div>');
              $status.text('Error');
              return;
            }

            const logs = response.logs || [];
            const timeRange = minutes === 0 ? 'all' : minutes + ' min';
            $status.text(logs.length + ' entries (' + timeRange + ')');

            if (logs.length === 0) {
              $content.html('<div class="log-empty">No logs found for the selected time range</div>');
              return;
            }

            $content.empty();
            logs.forEach(function(log) {
              const $entry = $('<div class="log-entry ' + (log.severity || 'info').toLowerCase() + '">');

              if (log.timestamp) {
                const $timestamp = $('<div class="log-timestamp">').text(new Date(log.timestamp).toLocaleString());
                $entry.append($timestamp);
              }

              if (log.functionName) {
                const $function = $('<div class="log-function">').text('Function: ' + log.functionName);
                $entry.append($function);
              }

              const $message = $('<div class="log-message">').text(log.message || log.textPayload || JSON.stringify(log));
              $entry.append($message);

              $content.append($entry);
            });
          })
          .withFailureHandler(function(error) {
            $content.html('<div class="log-empty">Error: ' + error.message + '</div>');
            $status.text('Error');
          })
          .getScriptLogs(minutes);
      }
    };

    window.CodeExecutor = {
      commandHistory: [],
      historyIndex: -1,

      execute: async function() {
        const $input = $('#codeInput');
        const code = $input.val().trim();

        if (!code) return;

        // Add to history
        window.CodeExecutor.commandHistory.push(code);
        window.CodeExecutor.historyIndex = window.CodeExecutor.commandHistory.length;

        const startTime = performance.now();

        try {
          let codeToExecute = code;
          let hasRunCall = code.includes('run(');

          // For run() calls in assignments, we need special handling
          // to ensure the variable gets the resolved value, not the Promise
          if (hasRunCall && /^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*run\(/.test(code)) {
            // Assignment like: z = run("code")
            // Extract variable name and run call
            const match = code.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/);
            if (match) {
              const varName = match[1];
              const runCall = match[2];
              // Echo the command BEFORE executing (REPL style)
              const $console = $('#console');
              const $commandEcho = $('<div style="color: var(--text-secondary); font-family: Consolas, Monaco, monospace; font-size: 13px; margin-bottom: 8px; padding: 4px 8px; background: var(--bg-secondary); border-radius: 3px; display: flex; align-items: center; gap: 8px;">');
              const $commandText = $('<span>').text('> ' + code);
              const $replayBtn = $('<button class="replay-btn" style="margin-left: auto;" title="Re-run this command">↻</button>');
              $replayBtn.on('click', function() {
                $('#codeInput').val(code);
                window.CodeExecutor.execute();
              });
              $commandEcho.append($commandText, $replayBtn);
              $console.append($commandEcho);

              // Execute run(), await it, then assign to variable
              codeToExecute = `const __temp = await (${runCall}); clientState.set('${varName}', __temp.__runHandled ? __temp.value : __temp); return __temp;`;
            } else {
              codeToExecute = code;
            }
          } else {
            // Normal expression evaluation
            try {
              new Function('return ' + code);
              codeToExecute = 'return ' + code;
            } catch (e) {
              codeToExecute = code;
            }
          }

          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const fn = new AsyncFunction('clientState', 'run', codeToExecute);
          const boundRun = function(serverCode) {
            return clientState.run(serverCode, code);
          };
          const result = await fn(clientState, boundRun);

          const clientTime = (performance.now() - startTime).toFixed(2);

          if (result && typeof result.then === 'function') {
            return;
          }

          // Check if run() already handled output
          if (result && result.__runHandled) {
            // For run() assignments, we already handled clientState.set() above
            // For direct run() calls, we still need to inspect
            if (!hasRunCall || !/^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*run\(/.test(code)) {
              clientState.inspectAndUpdate(code, result.value);
            }
            return;  // Skip duplicate output
          }

          clientState.inspectAndUpdate(code, result);

          if (result !== undefined) {
            const displayResult = typeof result === 'object'
              ? JSON.stringify(result, null, 2)
              : String(result);
            window.UI.addOutput(displayResult, 'success', null, 'client: ' + clientTime + 'ms', code);
          } else {
            window.UI.addOutput('(undefined)', 'success', null, 'client: ' + clientTime + 'ms', code);
          }
        } catch (error) {
          const clientTime = (performance.now() - startTime).toFixed(2);
          window.UI.addOutput(error.message, 'error', null, 'client: ' + clientTime + 'ms', code);
        }

        $input.val('');
      }
    };

    window.DeploymentManager = {
      currentEnv: 'unknown',
      urls: { dev: null, staging: null, prod: null },

      init: function() {
        this.loadDeploymentInfo();
        this.setupEventHandlers();
      },

      loadDeploymentInfo: function() {
        if (!google || !google.script || !google.script.run) {
          console.error('google.script.run not available');
          return;
        }

        // Load URLs
        google.script.run
          .withSuccessHandler(function(urls) {
            window.DeploymentManager.urls = urls;
            window.DeploymentManager.updateUI();
          })
          .withFailureHandler(function(error) {
            console.error('Failed to load deployment URLs:', error);
          })
          .getDeploymentUrls();

        // Load current environment
        google.script.run
          .withSuccessHandler(function(envType) {
            window.DeploymentManager.currentEnv = envType;
            window.DeploymentManager.updateUI();
          })
          .withFailureHandler(function(error) {
            console.error('Failed to load current environment:', error);
          })
          .getCurrentDeploymentType();
      },

      updateUI: function() {
        const { currentEnv, urls } = this;

        // Update header badge
        const $badge = $('#envBadge');
        $badge.removeClass('dev staging prod').addClass(currentEnv);
        $badge.find('.env-badge-text').text(currentEnv.toUpperCase());

        // Update dropdown and tab
        ['dev', 'staging', 'prod'].forEach(env => {
          const url = urls[env] || 'Not deployed';
          const isCurrent = env === currentEnv;

          // Update dropdown
          const $dropdownItem = $(`.env-dropdown-item[data-env="${env}"]`);
          $dropdownItem.find('.env-link').attr('href', url).text(url);
          $dropdownItem.find('.env-current-marker').toggle(isCurrent);

          // Update tab
          const $card = $(`.deployment-card[data-env="${env}"]`);
          $card.find('.deployment-url').attr('href', url).text(url);
          $card.find('.deployment-current').toggle(isCurrent);
        });
      },

      setupEventHandlers: function() {
        // Toggle dropdown
        $('#envBadge').on('click', function(e) {
          e.stopPropagation();
          $('#envDropdown').toggleClass('hidden');
        });

        // Close dropdown when clicking outside
        $(document).on('click', function() {
          $('#envDropdown').addClass('hidden');
        });

        $('#envDropdown').on('click', function(e) {
          e.stopPropagation();
        });

        // Copy URL buttons
        $('.env-copy-btn, .copy-url-btn').on('click', function() {
          const url = $(this).siblings('.env-link, .deployment-url').attr('href');
          navigator.clipboard.writeText(url).then(() => {
            const $btn = $(this);
            const originalText = $btn.text();
            $btn.text('✓');
            setTimeout(() => $btn.text(originalText), 1500);
          });
        });

        // Promote buttons (dropdown)
        $('.env-promote-btn').on('click', function() {
          const toEnv = $(this).data('to');
          window.DeploymentManager.promoteDeployment(toEnv);
        });

        // Promote buttons (tab)
        $('.promote-action-btn').on('click', function() {
          const toEnv = $(this).data('to');
          window.DeploymentManager.promoteDeployment(toEnv);
        });

        // Full management button
        $('.env-full-mgmt-btn').on('click', function() {
          $('.tab').removeClass('active');
          $('.tab[data-tab="deployments"]').addClass('active');
          $('.tab-content').removeClass('active');
          $('#deployments').addClass('active');
          $('#envDropdown').addClass('hidden');
        });

        // Refresh button
        $('#refreshDeploymentsTab').on('click', function() {
          window.DeploymentManager.loadDeploymentInfo();
        });
      },

      promoteDeployment: function(toEnv) {
        let description = '';

        if (toEnv === 'staging') {
          description = prompt('Enter version description for staging promotion:');
          if (!description) return; // User cancelled
        } else {
          if (!confirm(`Promote staging to production?\n\nThis will update the production deployment.`)) {
            return;
          }
        }

        // Show loading state
        window.UI.addOutput('Promoting to ' + toEnv + '...', 'info');

        google.script.run
          .withSuccessHandler(function(result) {
            if (result.success) {
              window.UI.addOutput(
                '✅ ' + result.message + (result.version ? ' (v' + result.version + ')' : ''),
                'success'
              );
              window.DeploymentManager.loadDeploymentInfo(); // Refresh
            } else {
              window.UI.addOutput('❌ Promotion failed: ' + result.error, 'error');
            }
          })
          .withFailureHandler(function(error) {
            window.UI.addOutput('❌ Promotion failed: ' + error.message, 'error');
          })
          .promoteDeployment(toEnv, description);
      }
    };

    $(document).ready(function() {
      // Load script info
      window.DataLoader.loadScriptInfo();

      // Setup session time counter
      const sessionStart = new Date();
      setInterval(function() {
        const elapsed = Math.floor((new Date() - sessionStart) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        if (minutes > 0) {
          $('#sessionTime').text(minutes + 'm ' + seconds + 's');
        } else {
          $('#sessionTime').text(seconds + 's');
        }
      }, 1000);

      // Click-to-copy functionality
      $('.copyable').on('click', function() {
        const $elem = $(this);
        const textToCopy = $elem.find('.info-value').text();

        if (!textToCopy || textToCopy === 'Loading...' || textToCopy === 'Error loading') {
          return;
        }

        // Copy to clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textToCopy).then(function() {
            $elem.addClass('copied');
            setTimeout(function() {
              $elem.removeClass('copied');
            }, 1500);
          }).catch(function(err) {
            console.error('Copy failed:', err);
          });
        } else {
          // Fallback for older browsers
          const textarea = document.createElement('textarea');
          textarea.value = textToCopy;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            $elem.addClass('copied');
            setTimeout(function() {
              $elem.removeClass('copied');
            }, 1500);
          } catch (err) {
            console.error('Copy failed:', err);
          }
          document.body.removeChild(textarea);
        }
      });

      // Logs controls
      $('#logsTimeRange').on('change', function() {
        const minutes = parseInt($(this).val());
        window.DataLoader.loadLogs(minutes);
      });

      $('#refreshLogsBtn').on('click', function() {
        const minutes = parseInt($('#logsTimeRange').val());
        window.DataLoader.loadLogs(minutes);
      });

      // Auto-refresh logs when Logs tab is active
      let logsRefreshInterval = null;
      $('.tab').on('click', function() {
        const tab = $(this).data('tab');
        if (tab === 'logs') {
          const minutes = parseInt($('#logsTimeRange').val());
          window.DataLoader.loadLogs(minutes);
          // Auto-refresh every 10 seconds
          if (logsRefreshInterval) clearInterval(logsRefreshInterval);
          logsRefreshInterval = setInterval(function() {
            if ($('.tab[data-tab="logs"]').hasClass('active')) {
              window.DataLoader.loadLogs(parseInt($('#logsTimeRange').val()));
            }
          }, 10000);
        } else {
          if (logsRefreshInterval) {
            clearInterval(logsRefreshInterval);
            logsRefreshInterval = null;
          }
        }
      });

      // Auto-refresh processes every 30 seconds
      setInterval(function() {
        if ($('#processesPanel').is(':visible') && !$('#processesPanel').hasClass('collapsed')) {
          window.DataLoader.loadProcesses();
        }
      }, 30000);

      $('#executeBtn').on('click', window.CodeExecutor.execute);

      $('#codeInput').on('keypress', function(e) {
        if (e.which === 13) {
          window.CodeExecutor.execute();
        }
      });

      // Command history navigation with arrow keys
      $('#codeInput').on('keydown', function(e) {
        const $input = $(this);
        const history = window.CodeExecutor.commandHistory;

        if (e.which === 38) {  // Arrow Up
          e.preventDefault();
          if (window.CodeExecutor.historyIndex > 0) {
            window.CodeExecutor.historyIndex--;
            $input.val(history[window.CodeExecutor.historyIndex]);
          }
        } else if (e.which === 40) {  // Arrow Down
          e.preventDefault();
          if (window.CodeExecutor.historyIndex < history.length - 1) {
            window.CodeExecutor.historyIndex++;
            $input.val(history[window.CodeExecutor.historyIndex]);
          } else if (window.CodeExecutor.historyIndex === history.length - 1) {
            window.CodeExecutor.historyIndex = history.length;
            $input.val('');
          }
        }
      });

      // Filter functionality
      $('#stateFilter').on('input', function() {
        window.StateRenderer.filterText = $(this).val();
        window.StateRenderer.render(clientState.storage);
      });

      $('#filterToggle').on('click', function() {
        const $btn = $(this);
        if (window.StateRenderer.filterMode === 'names') {
          window.StateRenderer.filterMode = 'values';
          $btn.text('Values').addClass('active');
        } else {
          window.StateRenderer.filterMode = 'names';
          $btn.text('Names').removeClass('active');
        }
        window.StateRenderer.render(clientState.storage);
      });

      $('#filterClear').on('click', function() {
        $('#stateFilter').val('');
        window.StateRenderer.filterText = '';
        window.StateRenderer.render(clientState.storage);
      });

      $('.tab').on('click', function() {
        const tab = $(this).data('tab');
        $('.tab').removeClass('active');
        $('.tab-content').removeClass('active');
        $(this).addClass('active');
        $('#' + tab).addClass('active');
      });

      $('.panel h3').on('click', function() {
        const $icon = $(this).find('.expand-icon');
        const $content = $(this).next('.panel-content, .filter-container').nextAll('.panel-content').first();

        $icon.toggleClass('collapsed');
        $content.toggleClass('collapsed');
      });

      $('#clearStateBtn').on('click', function(e) {
        e.stopPropagation();
        if (confirm('Clear all client state variables?')) {
          clientState.clear();
        }
      });

      $('#refreshProcessesBtn').on('click', function(e) {
        e.stopPropagation();
        window.DataLoader.loadProcesses();
      });

      $('#scrollHint').on('click', function() {
        const $console = $('#console');
        $console.scrollTop($console[0].scrollHeight);
        $('#scrollHint').removeClass('visible');
      });

      window.DataLoader.loadProcesses();
      window.DeploymentManager.init();
      window.UI.addOutput('Debugger initialized', 'info');
    });
  </script>
</body>
</html>
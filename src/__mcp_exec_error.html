<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Failed - <?= projectName ?></title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
  <style>
    body {
      background: linear-gradient(135deg, #1a1a1a 0%, #2d1f1f 100%);
      color: #f0f0f0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .error-container {
      max-width: 800px;
      background: #2a2a2a;
      border: 2px solid #dc3545;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 10px 40px rgba(220, 53, 69, 0.3);
    }

    .error-header {
      text-align: center;
      margin-bottom: 30px;
    }

    .error-icon {
      font-size: 64px;
      color: #dc3545;
      margin-bottom: 20px;
    }

    .error-title {
      color: #ff6b6b;
      font-size: 32px;
      font-weight: 600;
      margin-bottom: 10px;
    }

    .error-subtitle {
      color: #aaa;
      font-size: 16px;
    }

    .error-details {
      background: #1e1e1e;
      border-left: 4px solid #dc3545;
      padding: 20px;
      border-radius: 6px;
      margin: 20px 0;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 14px;
    }

    .error-message {
      color: #ff6b6b;
      font-weight: 600;
      margin-bottom: 10px;
    }

    .error-context {
      color: #888;
      margin-bottom: 5px;
    }

    .troubleshooting {
      margin-top: 30px;
    }

    .troubleshooting h5 {
      color: #ffa500;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .troubleshooting-step {
      background: #1e1e1e;
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 10px;
      border-left: 3px solid #ffa500;
    }

    .step-number {
      display: inline-block;
      width: 24px;
      height: 24px;
      background: #ffa500;
      color: #1e1e1e;
      border-radius: 50%;
      text-align: center;
      line-height: 24px;
      font-weight: 600;
      font-size: 12px;
      margin-right: 10px;
    }

    .action-buttons {
      display: flex;
      gap: 15px;
      margin-top: 30px;
      justify-content: center;
    }

    .btn-custom {
      padding: 12px 30px;
      font-size: 16px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .logger-output {
      background: #1a1a1a;
      padding: 15px;
      border-radius: 6px;
      max-height: 200px;
      overflow-y: auto;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      color: #888;
      margin-top: 20px;
    }

    .collapsible-header {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #aaa;
      margin-top: 20px;
      padding: 10px;
      background: #1e1e1e;
      border-radius: 6px;
    }

    .collapsible-header:hover {
      background: #2a2a2a;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-header">
      <div class="error-icon">
        <i class="bi bi-exclamation-triangle-fill"></i>
      </div>
      <h1 class="error-title">Authorization Failed</h1>
      <p class="error-subtitle"><?= projectName ?></p>
    </div>

    <div class="error-details">
      <div class="error-message">
        <i class="bi bi-x-circle"></i> <?= errorMessage ?>
      </div>
      <div class="error-context">Context: <?= errorContext ?></div>
      <? if (errorDetails) { ?>
        <div class="error-context">Details: <?= errorDetails ?></div>
      <? } ?>
    </div>

    <div class="troubleshooting">
      <h5>
        <i class="bi bi-tools"></i>
        Troubleshooting Steps
      </h5>

      <div class="troubleshooting-step">
        <span class="step-number">1</span>
        <strong>Verify HEAD deployment exists</strong>
        <p style="margin: 5px 0 0 34px; color: #888;">
          Check that you have a HEAD deployment in the Apps Script project.
          The /dev URL requires an active HEAD deployment.
        </p>
      </div>

      <div class="troubleshooting-step">
        <span class="step-number">2</span>
        <strong>Check execution permissions</strong>
        <p style="margin: 5px 0 0 34px; color: #888;">
          Ensure the script has proper authorization scopes and you've granted
          permissions for the required Google services.
        </p>
      </div>

      <div class="troubleshooting-step">
        <span class="step-number">3</span>
        <strong>Review error logs</strong>
        <p style="margin: 5px 0 0 34px; color: #888;">
          Check the execution logs in Apps Script for detailed error messages.
          Click "View Logs" below to open the Apps Script logs viewer.
        </p>
      </div>

      <div class="troubleshooting-step">
        <span class="step-number">4</span>
        <strong>Verify script configuration</strong>
        <p style="margin: 5px 0 0 34px; color: #888;">
          Ensure the __mcp_exec function exists and validateDevMode() passes.
        </p>
      </div>
    </div>

    <? if (loggerOutput) { ?>
      <div class="collapsible-header" onclick="toggleLogger()">
        <i class="bi bi-chevron-right" id="loggerChevron"></i>
        <span>Show Logger Output</span>
      </div>
      <div class="logger-output" id="loggerOutput" style="display: none;">
        <?= loggerOutput ?>
      </div>
    <? } ?>

    <div class="action-buttons">
      <button class="btn btn-danger btn-custom" onclick="retryAuth()">
        <i class="bi bi-arrow-clockwise"></i>
        Retry Authorization
      </button>
      <button class="btn btn-secondary btn-custom" onclick="openScriptEditor()">
        <i class="bi bi-code-slash"></i>
        Open Script Editor
      </button>
      <button class="btn btn-outline-light btn-custom" onclick="viewLogs()">
        <i class="bi bi-file-text"></i>
        View Logs
      </button>
    </div>
  </div>

  <script>
    const scriptId = "<?= scriptId ?>";

    const retryAuth = () => {
      window.location.reload();
    };

    const openScriptEditor = () => {
      window.open(`https://script.google.com/d/${scriptId}/edit`, '_blank');
    };

    const viewLogs = () => {
      window.open(`https://script.google.com/home/executions?project=${scriptId}`, '_blank');
    };

    const toggleLogger = () => {
      const output = document.getElementById('loggerOutput');
      const chevron = document.getElementById('loggerChevron');

      if (output.style.display === 'none') {
        output.style.display = 'block';
        chevron.classList.remove('bi-chevron-right');
        chevron.classList.add('bi-chevron-down');
      } else {
        output.style.display = 'none';
        chevron.classList.remove('bi-chevron-down');
        chevron.classList.add('bi-chevron-right');
      }
    };
  </script>
</body>
</html>

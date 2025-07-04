/**
 * Button Component Utilities
 * Provides functions for creating and rendering button components
 */

/**
 * Create a button configuration object
 * @param {string} text - Button display text
 * @param {string} action - JavaScript action to execute on click
 * @param {string} type - Button type ('primary', 'secondary', 'danger', etc.)
 * @returns {Object} Button configuration object
 */
function createButton(text, action, type = 'primary') {
  return {
    text: text,
    action: action,
    type: type,
    id: `btn_${text.toLowerCase().replace(/\s+/g, '_')}`,
    className: `btn btn-${type}`
  };
}

/**
 * Render an array of buttons to HTML
 * @param {Array} buttons - Array of button configuration objects
 * @returns {string} HTML string containing rendered buttons
 */
function renderButtons(buttons) {
  if (!buttons || !Array.isArray(buttons)) {
    return '';
  }
  
  const buttonHtml = buttons.map(button => {
    return `<button id="${button.id}" class="${button.className}" onclick="${button.action}">${button.text}</button>`;
  }).join('\n');
  
  return `<div class="button-group">\n${buttonHtml}\n</div>`;
}

/**
 * Create a styled button with CSS classes
 * @param {string} text - Button text
 * @param {string} action - Click action
 * @param {string} type - Button style type
 * @param {Object} options - Additional options (disabled, size, etc.)
 * @returns {Object} Enhanced button configuration
 */
function createStyledButton(text, action, type = 'primary', options = {}) {
  const button = createButton(text, action, type);
  
  // Apply additional options
  if (options.disabled) {
    button.disabled = true;
    button.className += ' disabled';
  }
  
  if (options.size) {
    button.className += ` btn-${options.size}`;
  }
  
  if (options.icon) {
    button.icon = options.icon;
    button.text = `${options.icon} ${text}`;
  }
  
  return button;
}

/**
 * Generate button CSS styles
 * @returns {string} CSS styles for buttons
 */
function getButtonStyles() {
  return `
    <style>
      .button-group {
        display: flex;
        gap: 10px;
        margin: 10px 0;
      }
      
      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.3s, transform 0.1s;
      }
      
      .btn:hover {
        transform: translateY(-1px);
      }
      
      .btn-primary {
        background-color: #007bff;
        color: white;
      }
      
      .btn-primary:hover {
        background-color: #0056b3;
      }
      
      .btn-secondary {
        background-color: #6c757d;
        color: white;
      }
      
      .btn-secondary:hover {
        background-color: #545b62;
      }
      
      .btn-danger {
        background-color: #dc3545;
        color: white;
      }
      
      .btn-danger:hover {
        background-color: #c82333;
      }
      
      .btn.disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none !important;
      }
      
      .btn-sm {
        padding: 4px 8px;
        font-size: 12px;
      }
      
      .btn-lg {
        padding: 12px 24px;
        font-size: 16px;
      }
    </style>
  `;
}
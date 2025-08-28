import TurndownService from 'turndown';
import { marked } from 'marked';

/**
 * Transform Markdown to HTML for storage in GAS
 * Google Apps Script doesn't support .md files, so we convert to HTML
 */
export function transformMarkdownToHTML(content: string, filename: string): { content: string; filename: string } {
  // Convert markdown to HTML
  const html = marked(content);
  
  // Wrap in basic HTML structure with metadata
  const wrappedHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="original-filename" content="${filename}">
  <meta name="file-type" content="markdown-to-html">
  <title>${filename.replace('.md', '')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; padding: 20px; max-width: 900px; margin: 0 auto; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
    blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 20px; color: #666; }
  </style>
</head>
<body>
${html}
</body>
</html>`;

  return {
    content: wrappedHTML,
    filename: filename.replace('.md', '.html')
  };
}

/**
 * Transform HTML back to Markdown when pulling from GAS
 */
export function transformHTMLToMarkdown(content: string, filename: string): { content: string; filename: string } {
  // Check if this is a converted markdown file
  if (!content.includes('file-type" content="markdown-to-html"')) {
    // Not a converted markdown file, return as-is
    return { content, filename };
  }

  // Extract the body content
  const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    return { content, filename };
  }

  // Convert HTML back to Markdown
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  });

  // Configure turndown for better code block handling
  turndown.addRule('fencedCodeBlock', {
    filter: function (node: any) {
      return node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE';
    },
    replacement: function (content: string, node: any) {
      const codeNode = node.firstChild as HTMLElement;
      const lang = codeNode.className.replace('language-', '') || '';
      return '\n```' + lang + '\n' + codeNode.textContent + '\n```\n';
    }
  });

  const markdown = turndown.turndown(bodyMatch[1].trim());

  return {
    content: markdown,
    filename: filename.replace('.html', '.md')
  };
}

/**
 * Transform dotfiles to GAS-compatible modules
 * e.g., .gitignore -> _gitignore.gs with content as exported string
 */
export function transformDotfileToModule(content: string, filename: string): { content: string; filename: string } {
  // Replace leading dot with underscore for GAS compatibility
  const gasFilename = filename.replace(/^\./, '_') + '.gs';
  
  // Escape the content for JavaScript string
  const escapedContent = content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  // Wrap content as a CommonJS module that exports the original content
  const moduleContent = `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  /**
   * Original file: ${filename}
   * This is a dotfile converted to GAS-compatible format
   * The original content is preserved as a string export
   */
  
  const content = \`${escapedContent}\`;
  
  module.exports = {
    filename: '${filename}',
    type: 'dotfile',
    content: content,
    
    // Helper to write back to disk with original filename
    getOriginalContent: function() {
      return content;
    },
    
    // Helper to get original filename
    getOriginalFilename: function() {
      return '${filename}';
    }
  };
}

__defineModule__(_main);`;

  return {
    content: moduleContent,
    filename: gasFilename
  };
}

/**
 * Transform GAS module back to dotfile
 */
export function transformModuleToDotfile(content: string, filename: string): { content: string; filename: string } | null {
  // Check if this is a transformed dotfile
  if (!filename.startsWith('_') || !filename.endsWith('.gs')) {
    return null;
  }

  // Check if content indicates it's a transformed dotfile
  if (!content.includes('type: \'dotfile\'')) {
    return null;
  }

  // Extract the original content from the module
  const contentMatch = content.match(/const content = `([\s\S]*?)`;/);
  if (!contentMatch) {
    return null;
  }

  // Unescape the content
  const unescapedContent = contentMatch[1]
    .replace(/\\\$/g, '$')
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\');

  // Restore original filename (replace leading underscore with dot, remove .gs)
  const originalFilename = '.' + filename.slice(1, -3);

  return {
    content: unescapedContent,
    filename: originalFilename
  };
}

/**
 * Wrap JavaScript content as CommonJS module for GAS
 */
export function wrapAsCommonJSModule(content: string, filename: string): string {
  // Check if already wrapped
  if (content.includes('function _main(') && content.includes('__defineModule__(_main)')) {
    return content;
  }

  // Extract the base name for module documentation
  const moduleName = filename.replace(/\.(gs|js)$/, '');

  return `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  /**
   * Module: ${moduleName}
   * Auto-wrapped for GAS CommonJS compatibility
   */
  
${content.split('\n').map(line => '  ' + line).join('\n')}
}

__defineModule__(_main);`;
}

/**
 * Unwrap CommonJS module to get original content
 */
export function unwrapCommonJSModule(content: string): string {
  // Check if this is a wrapped module
  if (!content.includes('function _main(') || !content.includes('__defineModule__(_main)')) {
    return content;
  }

  // Extract content between function declaration and closing brace
  const match = content.match(/function _main\([^)]*\)\s*{([\s\S]*?)}\s*\n\s*__defineModule__\(_main\);?/);
  if (!match) {
    return content;
  }

  // Remove the module wrapper and de-indent
  const wrappedContent = match[1];
  
  // Remove module documentation comments if present
  const cleanContent = wrappedContent
    .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*\n/, '')
    .split('\n')
    .map(line => line.replace(/^  /, '')) // Remove 2-space indent
    .join('\n')
    .trim();

  return cleanContent;
}

/**
 * Check if a file needs transformation based on its name
 */
export function needsTransformation(filename: string): boolean {
  // Markdown files
  if (filename.endsWith('.md')) return true;
  
  // Dotfiles
  if (filename.startsWith('.')) return true;
  
  // Already transformed files
  if (filename.startsWith('_') && filename.endsWith('.gs')) return true;
  if (filename.endsWith('.html') && filename.toLowerCase().includes('readme')) return true;
  
  return false;
}

/**
 * Transform a file for GAS storage
 */
export function transformForGAS(content: string, filename: string): { content: string; filename: string } {
  // Handle markdown files
  if (filename.endsWith('.md')) {
    return transformMarkdownToHTML(content, filename);
  }
  
  // Handle dotfiles
  if (filename.startsWith('.')) {
    return transformDotfileToModule(content, filename);
  }
  
  // Handle regular JS files - ensure they have CommonJS wrapper
  if (filename.endsWith('.js') || filename.endsWith('.gs')) {
    return {
      content: wrapAsCommonJSModule(content, filename),
      filename: filename.endsWith('.js') ? filename.replace('.js', '.gs') : filename
    };
  }
  
  // No transformation needed
  return { content, filename };
}

/**
 * Transform a file from GAS storage back to original format
 */
export function transformFromGAS(content: string, filename: string): { content: string; filename: string } {
  // Check for transformed dotfiles
  const dotfileResult = transformModuleToDotfile(content, filename);
  if (dotfileResult) {
    return dotfileResult;
  }
  
  // Check for markdown HTML files
  if (filename.endsWith('.html') && content.includes('file-type" content="markdown-to-html"')) {
    return transformHTMLToMarkdown(content, filename);
  }
  
  // Unwrap CommonJS modules for local storage
  if (filename.endsWith('.gs')) {
    return {
      content: unwrapCommonJSModule(content),
      filename: filename.replace('.gs', '.js')
    };
  }
  
  // No transformation needed
  return { content, filename };
}

/**
 * Get the GAS-compatible filename for a given local filename
 */
export function getGASFilename(localFilename: string): string {
  if (localFilename.endsWith('.md')) {
    return localFilename.replace('.md', '.html');
  }
  if (localFilename.startsWith('.')) {
    return localFilename.replace(/^\./, '_') + '.gs';
  }
  if (localFilename.endsWith('.js')) {
    return localFilename.replace('.js', '.gs');
  }
  return localFilename;
}

/**
 * Get the local filename for a given GAS filename
 */
export function getLocalFilename(gasFilename: string): string {
  // Check for transformed dotfiles
  if (gasFilename.startsWith('_') && gasFilename.endsWith('.gs')) {
    // Could be a dotfile
    return '.' + gasFilename.slice(1, -3);
  }
  
  // Check for markdown HTML files
  if (gasFilename.endsWith('.html') && gasFilename.toLowerCase().includes('readme')) {
    return gasFilename.replace('.html', '.md');
  }
  
  // Regular GS to JS conversion
  if (gasFilename.endsWith('.gs')) {
    return gasFilename.replace('.gs', '.js');
  }
  
  return gasFilename;
}
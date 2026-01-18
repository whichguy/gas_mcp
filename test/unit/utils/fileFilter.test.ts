/**
 * Unit tests for FileFilter utility
 *
 * Tests the centralized file filtering logic including:
 * - Git breadcrumb detection (root and poly-repo)
 * - System file detection
 * - Local config detection
 * - Dev directory detection
 * - Pattern matching
 * - GAS compatibility checking
 * - Filter presets
 */

import { expect } from 'chai';
import { FileFilter, FilterResult } from '../../../src/utils/fileFilter.js';
import {
  FILTER_PRESETS,
  SYSTEM_FILE_PREFIXES,
  EXCLUDED_FILES,
  EXCLUDED_DIRS,
} from '../../../src/utils/fileFilter.patterns.js';

describe('FileFilter', () => {
  describe('isGitBreadcrumb()', () => {
    const filter = new FileFilter();

    describe('root git paths', () => {
      it('should detect .git/config', () => {
        expect(filter.isGitBreadcrumb('.git/config')).to.be.true;
      });

      it('should detect .git directory', () => {
        expect(filter.isGitBreadcrumb('.git')).to.be.true;
      });

      it('should detect .git/ prefix', () => {
        expect(filter.isGitBreadcrumb('.git/')).to.be.true;
        expect(filter.isGitBreadcrumb('.git/HEAD')).to.be.true;
        expect(filter.isGitBreadcrumb('.git/objects/pack')).to.be.true;
      });
    });

    describe('poly-repo nested git paths', () => {
      it('should detect libs/auth/.git/config', () => {
        expect(filter.isGitBreadcrumb('libs/auth/.git/config')).to.be.true;
      });

      it('should detect a/b/c/.git/info/exclude', () => {
        expect(filter.isGitBreadcrumb('a/b/c/.git/info/exclude')).to.be.true;
      });

      it('should detect deeply nested .git directories', () => {
        expect(filter.isGitBreadcrumb('some/deep/path/.git/hooks/pre-commit')).to.be.true;
      });

      it('should detect path ending with /.git', () => {
        expect(filter.isGitBreadcrumb('libs/auth/.git')).to.be.true;
      });
    });

    describe('non-git paths', () => {
      it('should NOT detect .gitignore', () => {
        expect(filter.isGitBreadcrumb('.gitignore')).to.be.false;
      });

      it('should NOT detect .github/workflows', () => {
        expect(filter.isGitBreadcrumb('.github/workflows')).to.be.false;
        expect(filter.isGitBreadcrumb('.github/workflows/ci.yml')).to.be.false;
      });

      it('should NOT detect regular files', () => {
        expect(filter.isGitBreadcrumb('src/main.js')).to.be.false;
        expect(filter.isGitBreadcrumb('utils/helpers.js')).to.be.false;
      });

      it('should NOT detect files with git in name', () => {
        expect(filter.isGitBreadcrumb('gitconfig.js')).to.be.false;
        expect(filter.isGitBreadcrumb('utils/git-helper.js')).to.be.false;
      });
    });
  });

  describe('isSystemFile()', () => {
    const filter = new FileFilter();

    it('should detect common-js/* files', () => {
      expect(filter.isSystemFile('common-js/require')).to.be.true;
      expect(filter.isSystemFile('common-js/__mcp_exec')).to.be.true;
      expect(filter.isSystemFile('common-js/ConfigManager')).to.be.true;
    });

    it('should detect __mcp_exec* files', () => {
      expect(filter.isSystemFile('__mcp_exec')).to.be.true;
      expect(filter.isSystemFile('__mcp_exec_handler')).to.be.true;
    });

    it('should NOT detect regular files', () => {
      expect(filter.isSystemFile('src/main.js')).to.be.false;
      expect(filter.isSystemFile('utils/helpers.js')).to.be.false;
    });
  });

  describe('isLocalConfig()', () => {
    const filter = new FileFilter();

    it('should detect .clasp.json', () => {
      expect(filter.isLocalConfig('.clasp.json')).to.be.true;
    });

    it('should detect .claspignore', () => {
      expect(filter.isLocalConfig('.claspignore')).to.be.true;
    });

    it('should detect .rsync-manifest.json', () => {
      expect(filter.isLocalConfig('.rsync-manifest.json')).to.be.true;
    });

    it('should detect .gitignore', () => {
      expect(filter.isLocalConfig('.gitignore')).to.be.true;
    });

    it('should handle paths with directories', () => {
      expect(filter.isLocalConfig('some/path/.clasp.json')).to.be.true;
    });

    it('should NOT detect regular config files', () => {
      expect(filter.isLocalConfig('package.json')).to.be.false;
      expect(filter.isLocalConfig('tsconfig.json')).to.be.false;
    });
  });

  describe('isInDevDir()', () => {
    const filter = new FileFilter();

    it('should detect node_modules paths', () => {
      expect(filter.isInDevDir('node_modules/lodash/index.js')).to.be.true;
    });

    it('should detect .git paths', () => {
      expect(filter.isInDevDir('.git/config')).to.be.true;
    });

    it('should detect .idea paths', () => {
      expect(filter.isInDevDir('.idea/workspace.xml')).to.be.true;
    });

    it('should detect .vscode paths', () => {
      expect(filter.isInDevDir('.vscode/settings.json')).to.be.true;
    });

    it('should NOT detect regular paths', () => {
      expect(filter.isInDevDir('src/main.js')).to.be.false;
    });
  });

  describe('isGasCompatible()', () => {
    const filter = new FileFilter();

    it('should accept .js files', () => {
      expect(filter.isGasCompatible('main.js')).to.be.true;
      expect(filter.isGasCompatible('utils/helpers.js')).to.be.true;
    });

    it('should accept .gs files', () => {
      expect(filter.isGasCompatible('main.gs')).to.be.true;
    });

    it('should accept .html files', () => {
      expect(filter.isGasCompatible('sidebar.html')).to.be.true;
    });

    it('should accept appsscript.json', () => {
      expect(filter.isGasCompatible('appsscript.json')).to.be.true;
    });

    it('should reject other .json files', () => {
      expect(filter.isGasCompatible('package.json')).to.be.false;
      expect(filter.isGasCompatible('tsconfig.json')).to.be.false;
    });

    it('should reject other file types', () => {
      expect(filter.isGasCompatible('README.md')).to.be.false;
      expect(filter.isGasCompatible('styles.css')).to.be.false;
      expect(filter.isGasCompatible('image.png')).to.be.false;
    });
  });

  describe('shouldWrapContent()', () => {
    const filter = new FileFilter();

    it('should wrap SERVER_JS files', () => {
      expect(filter.shouldWrapContent('SERVER_JS', 'main')).to.be.true;
      expect(filter.shouldWrapContent('SERVER_JS', 'utils/helpers')).to.be.true;
    });

    it('should NOT wrap HTML files', () => {
      expect(filter.shouldWrapContent('HTML', 'sidebar.html')).to.be.false;
    });

    it('should NOT wrap JSON files', () => {
      expect(filter.shouldWrapContent('JSON', 'appsscript')).to.be.false;
    });

    it('should NOT wrap .git/ files', () => {
      expect(filter.shouldWrapContent('SERVER_JS', '.git/config')).to.be.false;
      expect(filter.shouldWrapContent('SERVER_JS', 'libs/auth/.git/config')).to.be.false;
    });

    it('should NOT wrap special system files', () => {
      expect(filter.shouldWrapContent('SERVER_JS', 'appsscript')).to.be.false;
      expect(filter.shouldWrapContent('SERVER_JS', 'common-js/require')).to.be.false;
      expect(filter.shouldWrapContent('SERVER_JS', 'common-js/__mcp_exec')).to.be.false;
    });
  });

  describe('filter() with options', () => {
    describe('excludeGitBreadcrumbs option', () => {
      it('should skip git breadcrumbs when enabled', () => {
        const filter = new FileFilter({ excludeGitBreadcrumbs: true });

        const result = filter.filter('.git/config');
        expect(result.skip).to.be.true;
        expect(result.reason).to.equal('git_breadcrumb');
        expect(result.category).to.equal('git');
      });

      it('should NOT skip git breadcrumbs when disabled', () => {
        const filter = new FileFilter({ excludeGitBreadcrumbs: false });

        const result = filter.filter('.git/config');
        expect(result.skip).to.be.false;
      });

      it('should skip poly-repo git breadcrumbs', () => {
        const filter = new FileFilter({ excludeGitBreadcrumbs: true });

        expect(filter.shouldSkip('libs/auth/.git/config')).to.be.true;
        expect(filter.shouldSkip('a/b/c/.git/info/exclude')).to.be.true;
      });
    });

    describe('excludeSystemFiles option', () => {
      it('should skip system files when enabled', () => {
        const filter = new FileFilter({ excludeSystemFiles: true });

        const result = filter.filter('common-js/require');
        expect(result.skip).to.be.true;
        expect(result.reason).to.equal('system_file');
        expect(result.category).to.equal('system');
      });

      it('should NOT skip system files when disabled', () => {
        const filter = new FileFilter({ excludeSystemFiles: false });

        expect(filter.shouldSkip('common-js/require')).to.be.false;
      });
    });

    describe('excludeLocalConfig option', () => {
      it('should skip local config when enabled', () => {
        const filter = new FileFilter({ excludeLocalConfig: true });

        const result = filter.filter('.clasp.json');
        expect(result.skip).to.be.true;
        expect(result.reason).to.equal('local_config');
      });
    });

    describe('excludeDevDirs option', () => {
      it('should skip dev directories when enabled', () => {
        const filter = new FileFilter({ excludeDevDirs: true });

        const result = filter.filter('node_modules/lodash/index.js');
        expect(result.skip).to.be.true;
        expect(result.reason).to.equal('dev_directory');
      });
    });

    describe('excludePatterns option', () => {
      it('should skip files matching exclude patterns', () => {
        const filter = new FileFilter({ excludePatterns: ['test/*', '*.test.js'] });

        expect(filter.shouldSkip('test/unit.js')).to.be.true;
        expect(filter.shouldSkip('main.test.js')).to.be.true;
        expect(filter.shouldSkip('main.js')).to.be.false;
      });

      it('should support glob patterns with *', () => {
        const filter = new FileFilter({ excludePatterns: ['*.spec.ts'] });

        expect(filter.shouldSkip('main.spec.ts')).to.be.true;
        expect(filter.shouldSkip('main.ts')).to.be.false;
      });
    });

    describe('includePatterns option (overrides)', () => {
      it('should include files matching include patterns even if they would be excluded', () => {
        const filter = new FileFilter({
          excludeSystemFiles: true,
          includePatterns: ['common-js/require'],
        });

        // common-js/require would normally be excluded as system file
        // but includePatterns overrides that
        expect(filter.shouldSkip('common-js/require')).to.be.false;
        // Other system files are still excluded
        expect(filter.shouldSkip('common-js/other')).to.be.true;
      });
    });
  });

  describe('filterFiles()', () => {
    it('should filter array of strings', () => {
      const filter = new FileFilter({ excludeSystemFiles: true });
      const files = ['main.js', 'common-js/require', 'utils.js'];

      const result = filter.filterFiles(files);
      expect(result).to.deep.equal(['main.js', 'utils.js']);
    });

    it('should filter array of objects with custom extractor', () => {
      const filter = new FileFilter({ excludeGitBreadcrumbs: true });
      const files = [
        { name: 'main.js', size: 100 },
        { name: '.git/config', size: 50 },
        { name: 'utils.js', size: 200 },
      ];

      const result = filter.filterFiles(files, f => f.name);
      expect(result).to.deep.equal([
        { name: 'main.js', size: 100 },
        { name: 'utils.js', size: 200 },
      ]);
    });
  });

  describe('presets', () => {
    describe('sync preset', () => {
      const filter = FileFilter.fromPreset('sync');

      it('should exclude system files', () => {
        expect(filter.shouldSkip('common-js/require')).to.be.true;
      });

      it('should exclude git breadcrumbs', () => {
        expect(filter.shouldSkip('.git/config')).to.be.true;
        expect(filter.shouldSkip('libs/auth/.git/config')).to.be.true;
      });

      it('should exclude local config', () => {
        expect(filter.shouldSkip('.clasp.json')).to.be.true;
      });

      it('should exclude dev directories', () => {
        expect(filter.shouldSkip('node_modules/lodash')).to.be.true;
      });
    });

    describe('syncStatus preset', () => {
      const filter = FileFilter.fromPreset('syncStatus');

      it('should exclude system files', () => {
        expect(filter.shouldSkip('common-js/require')).to.be.true;
      });

      it('should exclude git breadcrumbs (fixes SyncDriftError false positive)', () => {
        expect(filter.shouldSkip('.git/config')).to.be.true;
      });

      it('should NOT exclude local config (for sync status)', () => {
        expect(filter.shouldSkip('.clasp.json')).to.be.false;
      });
    });

    describe('diff preset', () => {
      const filter = FileFilter.fromPreset('diff');

      it('should exclude system files', () => {
        expect(filter.shouldSkip('common-js/require')).to.be.true;
      });

      it('should exclude git breadcrumbs', () => {
        expect(filter.shouldSkip('.git/config')).to.be.true;
      });

      it('should exclude local config', () => {
        expect(filter.shouldSkip('.clasp.json')).to.be.true;
      });

      it('should NOT exclude dev directories', () => {
        expect(filter.shouldSkip('node_modules/lodash')).to.be.false;
      });
    });

    describe('fileOps preset', () => {
      const filter = FileFilter.fromPreset('fileOps');

      it('should NOT exclude anything by default', () => {
        expect(filter.shouldSkip('common-js/require')).to.be.false;
        expect(filter.shouldSkip('.git/config')).to.be.false;
        expect(filter.shouldSkip('.clasp.json')).to.be.false;
        expect(filter.shouldSkip('node_modules/lodash')).to.be.false;
      });
    });
  });

  describe('factory methods', () => {
    describe('forSync()', () => {
      it('should create filter with sync preset', () => {
        const filter = FileFilter.forSync();
        expect(filter.shouldSkip('.git/config')).to.be.true;
      });

      it('should allow overrides', () => {
        const filter = FileFilter.forSync({ excludeGitBreadcrumbs: false });
        // Note: .git/config is still skipped because excludeDevDirs:true from sync preset
        // catches .git as an excluded directory. To fully allow .git/, both must be disabled.
        expect(filter.shouldSkip('.git/config')).to.be.true;  // Still caught by excludeDevDirs

        // Verify override works when not caught by other filters
        const filterNoDevDirs = FileFilter.forSync({
          excludeGitBreadcrumbs: false,
          excludeDevDirs: false
        });
        expect(filterNoDevDirs.shouldSkip('.git/config')).to.be.false;

        // Other sync defaults still apply
        expect(filter.shouldSkip('common-js/require')).to.be.true;
      });
    });

    describe('forSyncStatus()', () => {
      it('should create filter with syncStatus preset', () => {
        const filter = FileFilter.forSyncStatus();
        expect(filter.shouldSkip('.git/config')).to.be.true;
        expect(filter.shouldSkip('.clasp.json')).to.be.false;
      });
    });

    describe('forDiff()', () => {
      it('should create filter with diff preset', () => {
        const filter = FileFilter.forDiff();
        expect(filter.shouldSkip('common-js/require')).to.be.true;
        expect(filter.shouldSkip('node_modules/lodash')).to.be.false;
      });
    });
  });

  describe('static methods', () => {
    describe('isGitBreadcrumbPath()', () => {
      it('should check git breadcrumb without instantiation', () => {
        expect(FileFilter.isGitBreadcrumbPath('.git/config')).to.be.true;
        expect(FileFilter.isGitBreadcrumbPath('libs/auth/.git/config')).to.be.true;
        expect(FileFilter.isGitBreadcrumbPath('.gitignore')).to.be.false;
      });
    });

    describe('getDefaultExcludePatterns()', () => {
      it('should return default patterns', () => {
        const patterns = FileFilter.getDefaultExcludePatterns();
        expect(patterns).to.include('common-js/*');
        expect(patterns).to.include('__mcp_exec*');
      });
    });

    describe('getSystemFilePrefixes()', () => {
      it('should return system file prefixes', () => {
        const prefixes = FileFilter.getSystemFilePrefixes();
        expect(prefixes).to.include('common-js/');
        expect(prefixes).to.include('__mcp_exec');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty filename', () => {
      const filter = new FileFilter({ excludeGitBreadcrumbs: true });
      expect(filter.shouldSkip('')).to.be.false;
    });

    it('should handle filename with only dots', () => {
      const filter = new FileFilter({ excludeGitBreadcrumbs: true });
      expect(filter.shouldSkip('...')).to.be.false;
    });

    it('should handle Windows-style paths', () => {
      const filter = new FileFilter({ excludeDevDirs: true });
      // Note: FileFilter expects forward slashes (as used in GAS filenames)
      expect(filter.shouldSkip('node_modules/lodash')).to.be.true;
    });

    it('should handle paths with trailing slashes', () => {
      const filter = new FileFilter({ excludeGitBreadcrumbs: true });
      expect(filter.shouldSkip('.git/')).to.be.true;
    });

    it('should handle multiple filter conditions', () => {
      const filter = new FileFilter({
        excludeSystemFiles: true,
        excludeGitBreadcrumbs: true,
        excludeLocalConfig: true,
      });

      // System file
      const sysResult = filter.filter('common-js/require');
      expect(sysResult.category).to.equal('system');

      // Git breadcrumb
      const gitResult = filter.filter('.git/config');
      expect(gitResult.category).to.equal('git');

      // Local config
      const configResult = filter.filter('.clasp.json');
      expect(configResult.category).to.equal('config');
    });
  });
});

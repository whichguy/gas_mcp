import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  parsePath,
  getFileType,
  getDirectory,
  getBaseName,
  joinPath,
  matchesDirectory,
  sortFilesForExecution,
  FILE_TYPE_MAP
} from '../../../src/api/pathParser.js';
import { ValidationError } from '../../../src/errors/mcpErrors.js';

describe('Path Parser', () => {
  describe('getFileType', () => {
    it('should return correct types for valid extensions', () => {
      expect(getFileType('file.gs')).to.equal('SERVER_JS');
      expect(getFileType('file.ts')).to.equal('SERVER_JS');
      expect(getFileType('template.html')).to.equal('HTML');
      expect(getFileType('config.json')).to.equal('JSON');
    });

    it('should handle case insensitive extensions', () => {
      expect(getFileType('FILE.GS')).to.equal('SERVER_JS');
      expect(getFileType('file.HTML')).to.equal('HTML');
      expect(getFileType('config.JSON')).to.equal('JSON');
    });

    it('should handle files with multiple dots', () => {
      expect(getFileType('my.config.json')).to.equal('JSON');
      expect(getFileType('user.model.ts')).to.equal('SERVER_JS');
    });

    it('should throw ValidationError for invalid extensions', () => {
      expect(() => getFileType('file.txt')).to.throw(ValidationError);
      expect(() => getFileType('file.py')).to.throw(ValidationError);
      // Files without extensions now default to SERVER_JS
      expect(getFileType('file')).to.equal('SERVER_JS');
    });

    it('should handle files without extensions', () => {
      expect(getFileType('Code')).to.equal('SERVER_JS');
      expect(getFileType('MyFunction')).to.equal('SERVER_JS');
      expect(getFileType('utils')).to.equal('SERVER_JS');
    });

    it('should have correct file type mappings', () => {
      expect(FILE_TYPE_MAP['.gs']).to.equal('SERVER_JS');
      expect(FILE_TYPE_MAP['.ts']).to.equal('SERVER_JS');
      expect(FILE_TYPE_MAP['.html']).to.equal('HTML');
      expect(FILE_TYPE_MAP['.json']).to.equal('JSON');
    });
  });

  describe('parsePath', () => {
    it('should parse empty path as root directory', () => {
      const result = parsePath('');
      expect(result.scriptId).to.equal('');
      expect(result.isProject).to.be.false;
      expect(result.isFile).to.be.false;
      expect(result.isDirectory).to.be.true;
    });

    it('should parse project ID only', () => {
      const result = parsePath('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.scriptId).to.equal('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.isProject).to.be.true;
      expect(result.isFile).to.be.false;
      expect(result.isDirectory).to.be.false;
    });

    it('should parse file paths', () => {
      const result = parsePath('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/Code.gs');
      expect(result.scriptId).to.equal('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.filename).to.equal('Code.gs');
      expect(result.directory).to.be.undefined;
      expect(result.isProject).to.be.false;
      expect(result.isFile).to.be.true;
      expect(result.isDirectory).to.be.false;
    });

    it('should parse nested file paths', () => {
      const result = parsePath('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/models/User.ts');
      expect(result.scriptId).to.equal('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.filename).to.equal('models/User.ts');
      expect(result.directory).to.equal('models');
      expect(result.isFile).to.be.true;
    });

    it('should parse deeply nested file paths', () => {
      const result = parsePath('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/src/models/User.gs');
      expect(result.scriptId).to.equal('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.filename).to.equal('src/models/User.gs');
      expect(result.directory).to.equal('src/models');
      expect(result.isFile).to.be.true;
    });

    it('should parse directory paths', () => {
      const result = parsePath('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/models');
      expect(result.scriptId).to.equal('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.directory).to.equal('models');
      expect(result.isProject).to.be.false;
      expect(result.isFile).to.be.false;
      expect(result.isDirectory).to.be.true;
    });

    it('should parse nested directory paths', () => {
      const result = parsePath('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/src/models');
      expect(result.scriptId).to.equal('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
      expect(result.directory).to.equal('src/models');
      expect(result.isDirectory).to.be.true;
    });



    it('should throw ValidationError for invalid paths', () => {
      expect(() => parsePath('short')).to.throw(ValidationError);
      expect(() => parsePath('project with spaces')).to.throw(ValidationError);
      expect(() => parsePath('project@invalid')).to.throw(ValidationError);
    });

    it('should throw ValidationError for too long filenames', () => {
      const longFilename = 'a'.repeat(101) + '.gs';
      expect(() => parsePath(`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/${longFilename}`)).to.throw(ValidationError);
    });

    it('should handle boundary cases for filename length', () => {
      const filename100 = 'a'.repeat(97) + '.gs'; // Exactly 100 chars
      expect(() => parsePath(`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/${filename100}`)).to.not.throw();

      const filename101 = 'a'.repeat(98) + '.gs'; // 101 chars
      expect(() => parsePath(`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/${filename101}`)).to.throw(ValidationError);
    });

    it('should handle very long project IDs', () => {
      const longProjectId = 'a'.repeat(100);
      expect(() => parsePath(longProjectId)).to.not.throw();
    });
  });

  describe('getDirectory', () => {
    it('should extract directory from file path', () => {
      expect(getDirectory('models/User.gs')).to.equal('models');
      expect(getDirectory('src/models/User.ts')).to.equal('src/models');
    });

    it('should return undefined for root level files', () => {
      expect(getDirectory('Code.gs')).to.be.undefined;
    });

    it('should handle paths with leading slash', () => {
      expect(getDirectory('/models/User.gs')).to.equal('/models');
    });

    it('should handle edge cases', () => {
      expect(getDirectory('')).to.be.undefined;
      expect(getDirectory('/')).to.be.undefined;
      expect(getDirectory('a/b')).to.equal('a');
    });
  });

  describe('getBaseName', () => {
    it('should extract filename from path', () => {
      expect(getBaseName('models/User.gs')).to.equal('User.gs');
      expect(getBaseName('src/models/User.ts')).to.equal('User.ts');
    });

    it('should return full name for root level files', () => {
      expect(getBaseName('Code.gs')).to.equal('Code.gs');
    });

    it('should handle paths with leading slash', () => {
      expect(getBaseName('/models/User.gs')).to.equal('User.gs');
    });

    it('should handle edge cases', () => {
      expect(getBaseName('')).to.equal('');
      expect(getBaseName('/')).to.equal('');
      expect(getBaseName('filename')).to.equal('filename');
    });
  });

  describe('joinPath', () => {
    it('should join path components', () => {
      expect(joinPath('project123', 'models', 'User.gs')).to.equal('project123/models/User.gs');
      expect(joinPath('project123', 'Code.gs')).to.equal('project123/Code.gs');
    });

    it('should filter out empty components', () => {
      expect(joinPath('project123', '', 'models', '', 'User.gs')).to.equal('project123/models/User.gs');
      expect(joinPath('project123')).to.equal('project123');
    });

    it('should handle no additional parts', () => {
      expect(joinPath('project123')).to.equal('project123');
    });
  });

  describe('matchesDirectory', () => {
    it('should match files in directory', () => {
      expect(matchesDirectory('models/User.gs', 'models')).to.be.true;
      expect(matchesDirectory('models/Document.ts', 'models')).to.be.true;
    });

    it('should match files in nested directories', () => {
      expect(matchesDirectory('src/models/User.gs', 'src/models')).to.be.true;
      expect(matchesDirectory('src/models/data/User.gs', 'src/models')).to.be.true;
    });

    it('should not match files in different directories', () => {
      expect(matchesDirectory('views/index.html', 'models')).to.be.false;
      expect(matchesDirectory('modelsExtra/User.gs', 'models')).to.be.false;
    });

    it('should match any file when no directory filter', () => {
      expect(matchesDirectory('models/User.gs', '')).to.be.true;
      expect(matchesDirectory('Code.gs', '')).to.be.true;
    });

    it('should handle directory with trailing slash', () => {
      expect(matchesDirectory('models/User.gs', 'models/')).to.be.true;
      expect(matchesDirectory('models/User.gs', 'models')).to.be.true;
    });
  });

  describe('sortFilesForExecution', () => {
    it('should respect explicit order', () => {
      const files = [
        { name: 'third.gs', order: 2 },
        { name: 'first.gs', order: 0 },
        { name: 'second.gs', order: 1 }
      ];

      const sorted = sortFilesForExecution(files);
      expect(sorted[0].name).to.equal('first.gs');
      expect(sorted[1].name).to.equal('second.gs');
      expect(sorted[2].name).to.equal('third.gs');
    });

    it('should prioritize library files', () => {
      const files = [
        { name: 'main.gs' },
        { name: 'lib/utils.gs' },
        { name: 'util/helpers.gs' },
        { name: 'common/constants.gs' },
        { name: 'shared/config.gs' },
        { name: 'app.gs' }
      ];

      const sorted = sortFilesForExecution(files);
      const sortedLibFiles = sorted.slice(0, 4).map((f: any) => f.name);
      expect(sortedLibFiles).to.have.members(['lib/utils.gs', 'util/helpers.gs', 'common/constants.gs', 'shared/config.gs']);
    });

    it('should sort by directory depth', () => {
      const files = [
        { name: 'deep/nested/file.gs' },
        { name: 'shallow.gs' },
        { name: 'medium/file.gs' }
      ];

      const sorted = sortFilesForExecution(files);
      expect(sorted[0].name).to.equal('shallow.gs');
      expect(sorted[1].name).to.equal('medium/file.gs');
      expect(sorted[2].name).to.equal('deep/nested/file.gs');
    });

    it('should sort alphabetically as fallback', () => {
      const files = [
        { name: 'zebra.gs' },
        { name: 'alpha.gs' },
        { name: 'beta.gs' }
      ];

      const sorted = sortFilesForExecution(files);
      expect(sorted[0].name).to.equal('alpha.gs');
      expect(sorted[1].name).to.equal('beta.gs');
      expect(sorted[2].name).to.equal('zebra.gs');
    });

    it('should handle mixed sorting criteria', () => {
      const files = [
        { name: 'app/main.gs' },
        { name: 'lib/core.gs' },
        { name: 'config.gs', order: 0 },
        { name: 'util/helper.gs' },
        { name: 'views/index.html' }
      ];

      const sorted = sortFilesForExecution(files);
      // Explicit order first
      expect(sorted[0].name).to.equal('config.gs');
      // Then libraries
      expect([sorted[1].name, sorted[2].name]).to.have.members(['lib/core.gs', 'util/helper.gs']);
    });

    it('should work with different file types', () => {
      interface TestFile {
        name: string;
        type: string;
        order?: number;
      }

      const files: TestFile[] = [
        { name: 'main.gs', type: 'SERVER_JS' },
        { name: 'template.html', type: 'HTML' },
        { name: 'lib/utils.gs', type: 'SERVER_JS' }
      ];

      const sorted = sortFilesForExecution(files);
      expect(sorted[0].name).to.equal('lib/utils.gs');
      expect(sorted.length).to.equal(3);
    });
  });

  describe('validation edge cases', () => {
    it('should handle Unicode in filenames', () => {
      expect(() => getFileType('测试文件.gs')).to.not.throw();
      expect(() => parsePath('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/测试文件.gs')).to.not.throw();
    });

    it('should handle very long project IDs', () => {
      const longProjectId = 'a'.repeat(100);
      expect(() => parsePath(longProjectId)).to.not.throw();
    });

    it('should handle boundary cases for filename length', () => {
      const filename100 = 'a'.repeat(97) + '.gs'; // Exactly 100 chars
      expect(() => parsePath(`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/${filename100}`)).to.not.throw();

      const filename101 = 'a'.repeat(98) + '.gs'; // 101 chars
      expect(() => parsePath(`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/${filename101}`)).to.throw(ValidationError);
    });
  });
}); 
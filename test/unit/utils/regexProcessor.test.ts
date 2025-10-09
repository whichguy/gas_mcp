/**
 * Unit tests for RegexProcessor utility
 */

import { expect } from 'chai';
import { RegexProcessor } from '../../../src/utils/regexProcessor.js';

describe('RegexProcessor', () => {
  describe('buildRegex', () => {
    it('should detect regex metacharacters in auto mode', () => {
      const regex = RegexProcessor.buildRegex('test.*pattern', { searchMode: 'auto' });
      expect(regex.test('test123pattern')).to.be.true;
      expect(regex.test('testXYZpattern')).to.be.true;
    });

    it('should treat literal strings in auto mode', () => {
      const regex = RegexProcessor.buildRegex('test pattern', { searchMode: 'auto' });
      expect(regex.test('test pattern')).to.be.true;
      expect(regex.test('test.pattern')).to.be.false;
    });

    it('should escape special characters in literal mode', () => {
      const regex = RegexProcessor.buildRegex('test.pattern', { searchMode: 'literal' });
      expect(regex.test('test.pattern')).to.be.true;
      expect(regex.test('testXpattern')).to.be.false;
    });

    it('should handle case-sensitive matching', () => {
      const regex = RegexProcessor.buildRegex('Test', { caseSensitive: true });
      expect(regex.test('Test')).to.be.true;
      expect(regex.test('test')).to.be.false;
    });

    it('should handle case-insensitive matching', () => {
      const regex = RegexProcessor.buildRegex('Test', { caseSensitive: false });
      expect(regex.test('Test')).to.be.true;
      expect(regex.test('test')).to.be.true;
      expect(regex.test('TEST')).to.be.true;
    });

    it('should add word boundaries when wholeWord is true', () => {
      const regex = RegexProcessor.buildRegex('test', { wholeWord: true });
      expect(regex.test('test')).to.be.true;
      expect(regex.test('testing')).to.be.false;
      expect(regex.test('a test word')).to.be.true;
    });

    it('should respect fixedStrings flag', () => {
      const regex = RegexProcessor.buildRegex('test.*', { fixedStrings: true });
      expect(regex.test('test.*')).to.be.true;
      expect(regex.test('test123')).to.be.false;
    });
  });

  describe('test', () => {
    it('should test pattern matches', () => {
      expect(RegexProcessor.test('hello', 'hello world')).to.be.true;
      expect(RegexProcessor.test('hello', 'goodbye world')).to.be.false;
    });

    it('should handle regex patterns', () => {
      expect(RegexProcessor.test('\\d+', '123 test', { searchMode: 'regex' })).to.be.true;
      expect(RegexProcessor.test('\\d+', 'abc test', { searchMode: 'regex' })).to.be.false;
    });
  });

  describe('findMatches', () => {
    it('should find all matches with line info', () => {
      const text = 'line1 test\nline2 test\nline3 other';
      const matches = RegexProcessor.findMatches('test', text);

      expect(matches).to.have.length(2);
      expect(matches[0].match).to.equal('test');
      expect(matches[0].line).to.equal(1);
      expect(matches[1].line).to.equal(2);
    });

    it('should provide accurate column numbers', () => {
      const text = 'hello test world';
      const matches = RegexProcessor.findMatches('test', text);

      expect(matches).to.have.length(1);
      expect(matches[0].column).to.equal(7); // 1-based, 'test' starts at position 6
    });

    it('should handle regex patterns with groups', () => {
      const text = 'function foo() { }\nfunction bar() { }';
      const matches = RegexProcessor.findMatches('function\\s+(\\w+)', text, { searchMode: 'regex' });

      expect(matches).to.have.length(2);
      expect(matches[0].match).to.include('foo');
      expect(matches[1].match).to.include('bar');
    });

    it('should handle case-insensitive search', () => {
      const text = 'Test test TEST';
      const matches = RegexProcessor.findMatches('test', text, { caseSensitive: false });

      expect(matches).to.have.length(3);
    });
  });

  describe('replace', () => {
    it('should replace all matches', () => {
      const text = 'test1 test2 test3';
      const { text: result, count } = RegexProcessor.replace('test', 'replaced', text);

      expect(result).to.equal('replaced1 replaced2 replaced3');
      expect(count).to.equal(3);
    });

    it('should support capture groups', () => {
      const text = 'function foo() { }';
      const { text: result } = RegexProcessor.replace(
        'function\\s+(\\w+)',
        'async function $1',
        text,
        { searchMode: 'regex' }
      );

      expect(result).to.include('async function foo');
    });

    it('should handle case-insensitive replacement', () => {
      const text = 'Test test TEST';
      const { text: result, count } = RegexProcessor.replace('test', 'replaced', text, {
        caseSensitive: false
      });

      expect(result).to.equal('replaced replaced replaced');
      expect(count).to.equal(3);
    });

    it('should return count of replacements', () => {
      const text = 'a b c a b c';
      const { count } = RegexProcessor.replace('a', 'x', text);

      expect(count).to.equal(2);
    });

    it('should handle no matches', () => {
      const text = 'hello world';
      const { text: result, count } = RegexProcessor.replace('foo', 'bar', text);

      expect(result).to.equal('hello world');
      expect(count).to.equal(0);
    });
  });

  describe('countMatches', () => {
    it('should count all matches', () => {
      const text = 'test test test';
      const count = RegexProcessor.countMatches('test', text);

      expect(count).to.equal(3);
    });

    it('should handle regex patterns', () => {
      const text = '123 abc 456 def';
      const count = RegexProcessor.countMatches('\\d+', text, { searchMode: 'regex' });

      expect(count).to.equal(2);
    });

    it('should return 0 for no matches', () => {
      const text = 'hello world';
      const count = RegexProcessor.countMatches('foo', text);

      expect(count).to.equal(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings', () => {
      const { text: result, count } = RegexProcessor.replace('test', 'replaced', '');
      expect(result).to.equal('');
      expect(count).to.equal(0);
    });

    it('should handle empty patterns gracefully', () => {
      const matches = RegexProcessor.findMatches('', 'test');
      expect(matches).to.be.an('array');
    });

    it('should handle multiline text', () => {
      const text = 'line1\nline2\nline3';
      const matches = RegexProcessor.findMatches('line', text);
      expect(matches).to.have.length(3);
    });

    it('should handle special regex characters in literal mode', () => {
      const text = 'cost is $100';
      const { text: result } = RegexProcessor.replace('$100', '$200', text, {
        searchMode: 'literal'
      });
      expect(result).to.equal('cost is $200');
    });
  });
});

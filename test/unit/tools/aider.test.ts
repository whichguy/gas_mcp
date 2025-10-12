import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { AiderTool } from '../../../src/tools/aider.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';
import { ValidationError } from '../../../src/errors/mcpErrors.js';

describe('AiderTool', () => {
  let aiderTool: AiderTool;
  let authManager: SessionAuthManager;

  beforeEach(() => {
    authManager = new SessionAuthManager();
    aiderTool = new AiderTool(authManager);
  });

  describe('Tool Metadata', () => {
    it('should have correct tool name', () => {
      expect(aiderTool.name).to.equal('aider');
    });

    it('should have descriptive description', () => {
      expect(aiderTool.description).to.include('fuzzy');
      expect(aiderTool.description).to.include('Token-efficient');
    });

    it('should have comprehensive input schema', () => {
      expect(aiderTool.inputSchema).to.exist;
      expect(aiderTool.inputSchema.type).to.equal('object');
      expect(aiderTool.inputSchema.required).to.include('scriptId');
      expect(aiderTool.inputSchema.required).to.include('path');
      expect(aiderTool.inputSchema.required).to.include('edits');
    });

    it('should have llmGuidance with key sections', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance).to.exist;
      expect(schema.llmGuidance.whenToUse).to.exist;
      expect(schema.llmGuidance.contentDifference).to.exist;
      expect(schema.llmGuidance.howToUse).to.be.an('array');
      expect(schema.llmGuidance.whenNotToUse).to.be.an('array');
      expect(schema.llmGuidance.bestPractices).to.be.an('array');
      expect(schema.llmGuidance.tokenSavings).to.exist;
    });

    it('should have llmHints with decision trees', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmHints).to.exist;
      expect(schema.llmHints.decisionTree).to.exist;
      expect(schema.llmHints.idealUseCases).to.be.an('array');
      expect(schema.llmHints.avoidWhen).to.be.an('array');
      expect(schema.llmHints.algorithmDetails).to.exist;
      expect(schema.llmHints.errorHandling).to.exist;
    });
  });

  describe('Input Validation', () => {
    it('should require scriptId parameter', () => {
      expect(aiderTool.inputSchema.required).to.include('scriptId');
    });

    it('should require path parameter', () => {
      expect(aiderTool.inputSchema.required).to.include('path');
    });

    it('should require edits array', () => {
      expect(aiderTool.inputSchema.required).to.include('edits');
    });

    it('should validate scriptId format', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.properties.scriptId.pattern).to.exist;
      expect(schema.properties.scriptId.minLength).to.equal(25);
      expect(schema.properties.scriptId.maxLength).to.equal(60);
    });

    it('should validate path format', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.properties.path.minLength).to.equal(1);
    });

    it('should validate edits structure', () => {
      const schema = aiderTool.inputSchema as any;
      const editsSchema = schema.properties.edits;

      expect(editsSchema.type).to.equal('array');
      expect(editsSchema.minItems).to.equal(1);
      expect(editsSchema.maxItems).to.equal(20);

      const editItemSchema = editsSchema.items;
      expect(editItemSchema.required).to.include('searchText');
      expect(editItemSchema.required).to.include('replaceText');
    });

    it('should have optional similarity threshold', () => {
      const schema = aiderTool.inputSchema as any;
      const editItemSchema = schema.properties.edits.items;

      expect(editItemSchema.properties.similarityThreshold).to.exist;
      expect(editItemSchema.properties.similarityThreshold.default).to.equal(0.8);
      expect(editItemSchema.properties.similarityThreshold.minimum).to.equal(0);
      expect(editItemSchema.properties.similarityThreshold.maximum).to.equal(1);
    });

    it('should have optional dryRun parameter', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.properties.dryRun).to.exist;
      expect(schema.properties.dryRun.type).to.equal('boolean');
      expect(schema.properties.dryRun.default).to.equal(false);
    });
  });

  describe('Fuzzy Matching Algorithm', () => {
    it('should document Levenshtein distance algorithm', () => {
      const schema = aiderTool.inputSchema as any;
      const algorithmDetails = schema.llmHints.algorithmDetails;

      expect(algorithmDetails.matchingMethod).to.include('Levenshtein');
      expect(algorithmDetails.normalization).to.exist;
      expect(algorithmDetails.similarityScore).to.exist;
      expect(algorithmDetails.windowSizes).to.exist;
    });

    it('should explain similarity threshold ranges', () => {
      const schema = aiderTool.inputSchema as any;
      const thresholdGuide = schema.llmHints.similarityThresholdGuide;

      expect(thresholdGuide['0.8-0.85']).to.exist; // Default range
      expect(thresholdGuide['0.7-0.8']).to.exist;  // Permissive
      expect(thresholdGuide['0.95-1.0']).to.exist; // Very strict
    });
  });

  describe('Token Efficiency', () => {
    it('should document 95%+ token savings', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.tokenSavings).to.include('95%+');
      expect(schema.llmGuidance.tokenSavings).to.include('~10');
    });

    it('should explain minimal response format', () => {
      const schema = aiderTool.inputSchema as any;
      const responseOptimization = schema.llmHints.responseOptimization;

      expect(responseOptimization).to.include('~10tok');
      expect(responseOptimization).to.include('success');
    });

    it('should document token economics', () => {
      const schema = aiderTool.inputSchema as any;
      const tokenEconomics = schema.llmHints.tokenEconomics;

      expect(tokenEconomics).to.include('$15/M');
      expect(tokenEconomics).to.include('$3/M');
      expect(tokenEconomics).to.include('5x');
    });
  });

  describe('Tool Comparison Guidance', () => {
    it('should explain when to prefer aider over edit', () => {
      const schema = aiderTool.inputSchema as any;
      const preferOver = schema.llmHints.preferOver;

      expect(preferOver.edit).to.exist;
      expect(preferOver.edit).to.include('whitespace');
      expect(preferOver.edit).to.include('fuzzy');
    });

    it('should explain when to prefer aider over sed', () => {
      const schema = aiderTool.inputSchema as any;
      const preferOver = schema.llmHints.preferOver;

      expect(preferOver.sed).to.exist;
      expect(preferOver.sed).to.include('Levenshtein');
    });

    it('should explain when to prefer aider over write', () => {
      const schema = aiderTool.inputSchema as any;
      const preferOver = schema.llmHints.preferOver;

      expect(preferOver.write).to.exist;
      expect(preferOver.write).to.include('95%+');
    });
  });

  describe('Use Case Examples', () => {
    it('should provide comprehensive examples', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.examples).to.be.an('array');
      expect(schema.llmGuidance.examples.length).to.be.at.least(3);

      const examples = schema.llmGuidance.examples;
      expect(examples[0]).to.have.property('scenario');
      expect(examples[0]).to.have.property('code');
    });

    it('should document ideal use cases', () => {
      const schema = aiderTool.inputSchema as any;
      const idealUseCases = schema.llmHints.idealUseCases;

      expect(idealUseCases).to.be.an('array');
      expect(idealUseCases.some((uc: string) => uc.includes('reformatted'))).to.be.true;
      expect(idealUseCases.some((uc: string) => uc.includes('whitespace'))).to.be.true;
      expect(idealUseCases.some((uc: string) => uc.includes('CommonJS'))).to.be.true;
    });

    it('should document when to avoid aider', () => {
      const schema = aiderTool.inputSchema as any;
      const avoidWhen = schema.llmHints.avoidWhen;

      expect(avoidWhen).to.be.an('array');
      expect(avoidWhen.some((aw: string) => aw.includes('exact text'))).to.be.true;
      expect(avoidWhen.some((aw: string) => aw.includes('regex'))).to.be.true;
      expect(avoidWhen.some((aw: string) => aw.includes('new file'))).to.be.true;
    });
  });

  describe('Error Handling Guidance', () => {
    it('should provide error handling strategies', () => {
      const schema = aiderTool.inputSchema as any;
      const errorHandling = schema.llmHints.errorHandling;

      expect(errorHandling['No match found']).to.exist;
      expect(errorHandling['Multiple matches']).to.exist;
      expect(errorHandling['Wrong text matched']).to.exist;
    });

    it('should explain similarity threshold adjustments', () => {
      const schema = aiderTool.inputSchema as any;
      const errorHandling = schema.llmHints.errorHandling;

      expect(errorHandling['No match found']).to.include('threshold');
      expect(errorHandling['Wrong text matched']).to.include('threshold');
    });
  });

  describe('Script Type Compatibility', () => {
    it('should document standalone script support', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.scriptTypeCompatibility.standalone).to.include('Full Support');
    });

    it('should document container-bound script support', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.scriptTypeCompatibility.containerBound).to.include('Full Support');
    });

    it('should explain universal compatibility', () => {
      const schema = aiderTool.inputSchema as any;
      const notes = schema.llmGuidance.scriptTypeCompatibility.notes;
      expect(notes).to.include('Universal');
    });
  });

  describe('Best Practices', () => {
    it('should recommend dryRun first', () => {
      const schema = aiderTool.inputSchema as any;
      const bestPractices = schema.llmGuidance.bestPractices;

      expect(bestPractices.some((bp: string) => bp.includes('dryRun: true'))).to.be.true;
    });

    it('should recommend starting with default threshold', () => {
      const schema = aiderTool.inputSchema as any;
      const bestPractices = schema.llmGuidance.bestPractices;

      expect(bestPractices.some((bp: string) => bp.includes('0.8'))).to.be.true;
    });

    it('should recommend single-file processing', () => {
      const schema = aiderTool.inputSchema as any;
      const bestPractices = schema.llmGuidance.bestPractices;

      expect(bestPractices.some((bp: string) => bp.includes('one file at a time'))).to.be.true;
    });
  });

  describe('CommonJS Integration', () => {
    it('should explain CommonJS unwrapping', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.commonJsIntegration).to.exist;
      expect(schema.llmGuidance.commonJsIntegration).to.include('unwrap');
      expect(schema.llmGuidance.commonJsIntegration).to.include('rewrap');
    });

    it('should clarify clean user code editing', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.commonJsIntegration).to.include('clean user code');
      expect(schema.llmGuidance.commonJsIntegration).to.include('system handles');
    });
  });
});

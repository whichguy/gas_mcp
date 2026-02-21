import { expect } from 'chai';
import { describe, it } from 'mocha';
import { buildWriteWorkflowHints } from '../../../src/utils/writeHints.js';
import type { CompactGitHint } from '../../../src/utils/gitStatus.js';

const SCRIPT_ID = 'abc123def456';

function makeHint(overrides: Partial<CompactGitHint>): CompactGitHint {
  return {
    branch: 'main',
    uncommitted: 1,
    blocked: true,
    ...overrides,
  };
}

describe('buildWriteWorkflowHints', () => {
  it('returns [] when not blocked', () => {
    const hint = makeHint({ blocked: false, uncommitted: 0 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    expect(result).to.deep.equal([]);
  });

  it('returns 3 steps when blocked on feature branch — step 3 = finish', () => {
    const hint = makeHint({ branch: 'llm-feature-user-auth', uncommitted: 1 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    expect(result).to.have.length(3);
    expect(result[0]).to.equal('1. Review: /review-fix');
    expect(result[1]).to.include('commit');
    expect(result[1]).to.include(SCRIPT_ID);
    expect(result[2]).to.include('finish');
    expect(result[2]).to.include(SCRIPT_ID);
    // pushToRemote:true is expected in finish step — only check that "Push:" label is absent
    expect(result[2]).to.not.match(/^3\. Push:/);
  });

  it('returns 3 steps when blocked on main — step 3 = push + branch tip appended', () => {
    const hint = makeHint({ branch: 'main', uncommitted: 1 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    // 3 core steps + branch tip
    expect(result).to.have.length(4);
    expect(result[0]).to.equal('1. Review: /review-fix');
    expect(result[1]).to.include('commit');
    expect(result[2]).to.include('push');
    expect(result[2]).to.not.include('finish');
    expect(result[3]).to.include('Branch tip');
    expect(result[3]).to.include(SCRIPT_ID);
  });

  it('returns 3 steps when blocked on a non-main non-feature branch — step 3 = push, no branch tip', () => {
    const hint = makeHint({ branch: 'some-other-branch', uncommitted: 1 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    expect(result).to.have.length(3);
    expect(result[2]).to.include('push');
    expect(result[2]).to.not.include('finish');
  });

  it('includes batching tip when uncommitted >= 3', () => {
    const hint = makeHint({ branch: 'llm-feature-x', uncommitted: 3 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    const batchStep = result.find(s => s.includes('Batch tip'));
    expect(batchStep).to.exist;
    expect(batchStep).to.include('3 files');
    expect(batchStep).to.include(SCRIPT_ID);
  });

  it('omits batching tip when uncommitted < 3', () => {
    const hint = makeHint({ branch: 'llm-feature-x', uncommitted: 2 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    expect(result.some(s => s.includes('Batch tip'))).to.be.false;
  });

  it('returns detached HEAD guidance when branch === "HEAD"', () => {
    const hint = makeHint({ branch: 'HEAD', uncommitted: 1 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    expect(result).to.have.length(2);
    expect(result[0]).to.include('Detached HEAD');
    expect(result[0]).to.include(SCRIPT_ID);
    expect(result[1]).to.include('commit');
  });

  it('returns detached HEAD guidance when branch === "unknown"', () => {
    const hint = makeHint({ branch: 'unknown', uncommitted: 1 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    expect(result).to.have.length(2);
    expect(result[0]).to.include('Detached HEAD');
    expect(result[0]).to.include(SCRIPT_ID);
    expect(result[1]).to.include('commit');
  });

  it('returns detached HEAD guidance when branch starts with "HEAD ("', () => {
    const hint = makeHint({ branch: 'HEAD (detached)', uncommitted: 1 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    expect(result).to.have.length(2);
    expect(result[0]).to.include('Detached HEAD');
    expect(result[0]).to.include(SCRIPT_ID);
  });

  it('main + uncommitted >= 3 produces all 5 steps in correct order', () => {
    const hint = makeHint({ branch: 'main', uncommitted: 3 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    // review, commit, push, batch tip, branch tip
    expect(result).to.have.length(5);
    expect(result[0]).to.equal('1. Review: /review-fix');
    expect(result[2]).to.match(/^3\. Push:/);
    expect(result[3]).to.include('Batch tip');
    expect(result[4]).to.include('Branch tip');
  });

  it('includes branch tip for master branch too', () => {
    const hint = makeHint({ branch: 'master', uncommitted: 1 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    const branchStep = result.find(s => s.includes('Branch tip'));
    expect(branchStep).to.exist;
  });

  it('scriptId appears correctly in all tool call strings', () => {
    const hint = makeHint({ branch: 'llm-feature-test', uncommitted: 4 });
    const result = buildWriteWorkflowHints(hint, SCRIPT_ID);
    const toolCallSteps = result.filter(s => s.includes('git_feature') || s.includes('rsync'));
    expect(toolCallSteps.length).to.be.greaterThan(0);
    toolCallSteps.forEach(step => {
      expect(step).to.include(SCRIPT_ID);
    });
  });
});

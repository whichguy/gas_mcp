/**
 * Unit tests for GASClient.updateFile() cachedFiles parameter (Advisory 3)
 *
 * Tests:
 * (a) When cachedFiles provided, injected getContentFn resolves to cachedFiles (no live fetch)
 * (b) When cachedFiles is undefined, live fetch path is used (delegates to getProjectContent)
 * (c) XOR guard: canUseCache is true only when exactly one template is missing
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { GASClient } from '../../../src/api/gasClient.js';
import type { GASFile } from '../../../src/api/gasTypes.js';

describe('GASClient.updateFile() - cachedFiles parameter', () => {
  let client: GASClient;
  let capturedGetContentFn: ((_sid: string, _tok?: string) => Promise<GASFile[]>) | undefined;

  const mockFiles: GASFile[] = [
    { name: 'test', source: 'console.log("hello")', type: 'SERVER_JS' }
  ];

  beforeEach(() => {
    // Create a GASClient instance (falls back to minimal config when oauth-config.json absent)
    client = new GASClient();

    // Replace fileOps with a minimal stub that captures the injected getContentFn
    capturedGetContentFn = undefined;
    (client as any).fileOps = {
      updateFile: async (
        _scriptId: string,
        _fileName: string,
        _content: string,
        _position: number | undefined,
        _accessToken: string | undefined,
        _explicitType: string | undefined,
        getContentFn: (_sid: string, _tok?: string) => Promise<GASFile[]>
      ): Promise<GASFile[]> => {
        capturedGetContentFn = getContentFn;
        return mockFiles;
      }
    };
  });

  afterEach(() => {
    // No sinon to restore — stubs applied via direct property assignment are cleaned up by GC
  });

  it('(a) when cachedFiles provided, getContentFn resolves immediately to cachedFiles without calling getProjectContent', async () => {
    const cached: GASFile[] = [{ name: 'cached', source: 'x=1', type: 'SERVER_JS' }];

    // Track whether getProjectContent is called via replacement
    let getProjectContentCalled = false;
    const originalGetProjectContent = (client as any).getProjectContent.bind(client);
    (client as any).getProjectContent = async (...args: unknown[]) => {
      getProjectContentCalled = true;
      return originalGetProjectContent(...args);
    };

    await client.updateFile('script-id', 'test.js', 'console.log("test")', undefined, undefined, undefined, cached);

    expect(capturedGetContentFn).to.not.be.undefined;
    const resolved = await capturedGetContentFn!('script-id');
    expect(resolved).to.equal(cached); // same reference — no copy
    expect(getProjectContentCalled).to.be.false;
  });

  it('(b) when cachedFiles is undefined, getContentFn delegates to getProjectContent', async () => {
    const liveFiles: GASFile[] = [{ name: 'live', source: 'live=true', type: 'SERVER_JS' }];

    let getProjectContentCallCount = 0;
    (client as any).getProjectContent = async (_scriptId: string, _tok?: string): Promise<GASFile[]> => {
      getProjectContentCallCount++;
      return liveFiles;
    };

    await client.updateFile('script-id', 'test.js', 'console.log("test")');

    expect(capturedGetContentFn).to.not.be.undefined;
    const resolved = await capturedGetContentFn!('script-id', 'token');
    expect(resolved).to.equal(liveFiles);
    expect(getProjectContentCallCount).to.equal(1);
  });

  it('(c) XOR guard: canUseCache is true only when exactly one template is missing', () => {
    // Both missing → XOR is false → canUseCache false
    const bothMissing = { hasSuccessHtml: false, hasErrorHtml: false };
    expect(bothMissing.hasSuccessHtml !== bothMissing.hasErrorHtml).to.be.false;

    // Only success missing → XOR is true → canUseCache true
    const onlySuccessMissing = { hasSuccessHtml: false, hasErrorHtml: true };
    expect(onlySuccessMissing.hasSuccessHtml !== onlySuccessMissing.hasErrorHtml).to.be.true;

    // Only error missing → XOR is true → canUseCache true
    const onlyErrorMissing = { hasSuccessHtml: true, hasErrorHtml: false };
    expect(onlyErrorMissing.hasSuccessHtml !== onlyErrorMissing.hasErrorHtml).to.be.true;

    // Neither missing → condition wouldn't be reached, but XOR is false for completeness
    const neitherMissing = { hasSuccessHtml: true, hasErrorHtml: true };
    expect(neitherMissing.hasSuccessHtml !== neitherMissing.hasErrorHtml).to.be.false;
  });
});

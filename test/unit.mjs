import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createBoxy as createBoxyFromImport } from 'boxy-layout';
import { capture } from '../dist/capture.js';

const require = createRequire(import.meta.url);
const { createBoxy } = require('../dist/index.js');

const model = {
  viewport: { width: 1280, height: 800 },
  url: 'about:blank',
  timestamp: Date.now(),
  elements: [],
};

function fakePage({ locatorCount = 1 } = {}) {
  return {
    locator() {
      return {
        count: async () => locatorCount,
        first() {
          return this;
        },
        screenshot: async () => null,
      };
    },
    evaluate: async () => model,
  };
}

function tempSnapshotDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxy-test-'));
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}

assert.equal(typeof createBoxyFromImport, 'function');
assert.equal(typeof createBoxy, 'function');

{
  const boxy = createBoxy({
    snapshotDir: tempSnapshotDir(),
    allowMissingBaseline: true,
  });

  for (const name of ['../../package', 'nested/name', 'nested\\name', '/tmp/snapshot', 'C:\\tmp\\snapshot', 'name..json', '']) {
    await assert.rejects(
      boxy.capture(fakePage(), { name }),
      /Invalid capture name/
    );
  }
}

{
  const boxy = createBoxy({ snapshotDir: tempSnapshotDir() });

  await assert.rejects(
    boxy.capture(fakePage(), { name: 'missing-baseline' }),
    /Missing layout baseline for "missing-baseline"/
  );
}

{
  const boxy = createBoxy({
    snapshotDir: tempSnapshotDir(),
    allowMissingBaseline: true,
  });

  const step = await boxy.capture(fakePage(), { name: 'missing-baseline-allowed' });
  assert.equal(step.name, 'missing-baseline-allowed');
}

await assert.rejects(
  capture(fakePage({ locatorCount: 0 }), { name: 'missing-scope', scope: '[data-testid="missing"]' }),
  /Scope selector "\[data-testid="missing"\]" was not found while capturing "missing-scope"/
);

{
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (isSandboxedChromiumLaunchError(error)) {
      console.warn('  Skipping browser unit checks: Chromium cannot launch in this sandboxed shell.');
      browser = null;
    } else {
      throw error;
    }
  }

  if (browser) {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage();
    await page.setContent(`
      <div data-testid="root" style="width: 200px; height: 100px; opacity: 0;">
        <div data-testid="child" style="width: 50px; height: 20px;">Hidden by root opacity</div>
      </div>
    `);

    const result = await capture(page, { name: 'root-opacity', scope: '[data-testid="root"]' });
    const root = result.model.elements.find(el => el.selector === '[data-testid="root"]');
    const child = result.model.elements.find(el => el.selector === '[data-testid="child"]');

    assert.ok(root, 'scoped root element should be captured');
    assert.equal(root.opacity, '0');
    assert.equal(child?.opacity, '0');

    await page.setContent(`
      <div data-testid="root" style="position: relative; width: 200px; height: 100px;">
        <div data-testid="child" style="width: 50px; height: 20px;">Child</div>
      </div>
      <div data-testid="static-banner" style="position: relative; width: 200px; height: 20px; margin-top: -20px;">Banner</div>
      <div data-testid="portal" style="position: fixed; left: 20px; top: 20px; width: 80px; height: 20px;">Portal</div>
    `);

    const scoped = await capture(page, { name: 'spatial-scope', scope: '[data-testid="root"]' });
    assert.ok(scoped.model.elements.find(el => el.selector === '[data-testid="child"]'), 'descendant should be captured');
    assert.ok(scoped.model.elements.find(el => el.selector === '[data-testid="portal"]'), 'fixed non-descendant portal should be captured');
    assert.equal(scoped.model.elements.find(el => el.selector === '[data-testid="static-banner"]'), undefined, 'relative non-descendant should not be captured');

    await ctx.close();
    await browser.close();
  }
}

function isSandboxedChromiumLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('MachPortRendezvousServer') && message.includes('Permission denied');
}

console.log('  Unit checks passed');

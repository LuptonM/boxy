import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createBoxy as createBoxyFromImport } from 'boxy-layout';
import { capture } from '../dist/capture.js';
import { makeElement, makeModel } from './fixtures/elements.mjs';

const require = createRequire(import.meta.url);
const { createBoxy } = require('../dist/index.js');

const model = {
  viewport: { width: 1280, height: 800 },
  url: 'about:blank',
  timestamp: Date.now(),
  elements: [],
};

function fakePage({ locatorCount = 1, pageModel = model } = {}) {
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
    evaluate: async () => pageModel,
  };
}

function tempSnapshotDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxy-test-'));
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}

async function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

assert.equal(typeof createBoxyFromImport, 'function');
assert.equal(typeof createBoxy, 'function');

{
  const boxy = createBoxy({ snapshotDir: tempSnapshotDir() });

  for (const name of ['../../package', 'nested/name', 'nested\\name', '/tmp/snapshot', 'C:\\tmp\\snapshot', 'name..json', '']) {
    await assert.rejects(
      boxy.capture(fakePage(), { name }),
      /Invalid capture name/
    );
  }
}

// First run auto-saves baseline
await withEnv('LAYOUT_INIT', undefined, async () => {
  const dir = tempSnapshotDir();
  const boxy = createBoxy({ snapshotDir: dir });

  const step = await boxy.capture(fakePage(), { name: 'auto-saved' });
  assert.equal(step.name, 'auto-saved');
  assert.equal(step.notices?.[0]?.type, 'baseline-created');
  assert.equal(step.notices?.[0]?.severity, 'error');
  assert.equal(step.issues.length, 0, 'auto-created baseline should not be reported as a regression issue');
  assert.equal(boxy.hasErrors(), true, 'auto-created baseline should fail by default');
  assert.equal(boxy.report(), 1, 'report should fail when a baseline is created by default');
  const htmlPath = boxy.writeHTMLReport();
  const html = fs.readFileSync(htmlPath, 'utf-8');
  assert.ok(html.includes('FAIL'), 'HTML report should fail when a baseline-created notice is an error');
  assert.ok(html.includes('Baseline created'), 'HTML report should render baseline notices');

  const baselinePath = path.join(dir, 'baseline', 'auto-saved.json');
  assert.ok(fs.existsSync(baselinePath), 'baseline should be auto-saved on first run');
});

// acceptNewBaselines allows intentional setup runs to pass
await withEnv('LAYOUT_INIT', undefined, async () => {
  const boxy = createBoxy({
    snapshotDir: tempSnapshotDir(),
    acceptNewBaselines: true,
  });

  const step = await boxy.capture(fakePage(), { name: 'accepted-auto-saved' });
  assert.equal(step.notices?.[0]?.type, 'baseline-created');
  assert.equal(step.notices?.[0]?.severity, 'info');
  assert.equal(boxy.hasErrors(), false, 'explicitly accepted new baselines should not fail');
  assert.equal(boxy.report(), 0, 'report should pass for explicitly accepted new baselines');
});

// LAYOUT_INIT=true allows intentional setup runs to pass
await withEnv('LAYOUT_INIT', 'true', async () => {
  const boxy = createBoxy({ snapshotDir: tempSnapshotDir() });

  const step = await boxy.capture(fakePage(), { name: 'env-accepted-auto-saved' });
  assert.equal(step.notices?.[0]?.type, 'baseline-created');
  assert.equal(step.notices?.[0]?.severity, 'info');
  assert.equal(boxy.hasErrors(), false, 'LAYOUT_INIT=true should accept new baselines');
});

// allowMissingBaseline: false throws when no baseline exists
{
  const boxy = createBoxy({
    snapshotDir: tempSnapshotDir(),
    allowMissingBaseline: false,
  });

  await assert.rejects(
    boxy.capture(fakePage(), { name: 'missing-baseline' }),
    /Missing layout baseline for "missing-baseline"/
  );
}

// resetBaseline() deletes baseline files
{
  const dir = tempSnapshotDir();
  const boxy = createBoxy({ snapshotDir: dir });

  await boxy.capture(fakePage(), { name: 'to-reset' });
  const baselinePath = path.join(dir, 'baseline', 'to-reset.json');
  assert.ok(fs.existsSync(baselinePath), 'baseline should exist before reset');

  boxy.resetBaseline('to-reset');
  assert.ok(!fs.existsSync(baselinePath), 'baseline should be deleted after reset');
}

// resetAllBaselines() clears baseline and current dirs
{
  const dir = tempSnapshotDir();
  const boxy = createBoxy({ snapshotDir: dir });

  await boxy.capture(fakePage(), { name: 'clear-me' });
  assert.ok(fs.existsSync(path.join(dir, 'baseline', 'clear-me.json')));

  boxy.resetAllBaselines();
  assert.equal(fs.readdirSync(path.join(dir, 'baseline')).length, 0, 'baseline dir should be empty after resetAll');
  assert.equal(fs.readdirSync(path.join(dir, 'current')).length, 0, 'current dir should be empty after resetAll');
}

// Update mode overwrites baseline
{
  const dir = tempSnapshotDir();
  const boxy = createBoxy({ snapshotDir: dir });
  const originalModel = makeModel([
    makeElement({
      selector: '[data-testid="moving"]',
      box: { x: 100, y: 100, width: 200, height: 50 },
    }),
  ]);
  const updatedModel = makeModel([
    makeElement({
      selector: '[data-testid="moving"]',
      box: { x: 160, y: 100, width: 200, height: 50 },
    }),
  ]);

  // First capture auto-saves baseline
  await boxy.capture(fakePage({ pageModel: originalModel }), { name: 'update-test' });
  const baselinePath = path.join(dir, 'baseline', 'update-test.json');
  const original = fs.readFileSync(baselinePath, 'utf-8');

  // Second capture with update: true overwrites baseline
  const boxyUpdate = createBoxy({ snapshotDir: dir, update: true });
  const step = await boxyUpdate.capture(fakePage({ pageModel: updatedModel }), { name: 'update-test' });
  const updated = fs.readFileSync(baselinePath, 'utf-8');

  assert.ok(fs.existsSync(baselinePath), 'baseline should still exist after update');
  assert.notEqual(original, updated, 'update mode should overwrite baseline with changed layout');
  assert.deepEqual(JSON.parse(updated).elements[0].box, updatedModel.elements[0].box);
  assert.equal(step.notices?.[0]?.type, 'baseline-updated');
  assert.equal(step.issues.some(issue => issue.category === 'POSITION'), false, 'update mode should not record old baseline regression issues');
  assert.equal(boxyUpdate.hasErrors(), false, 'update mode should leave no regression errors for accepted changes');
}

// Per-capture update: true
{
  const dir = tempSnapshotDir();
  const boxy = createBoxy({ snapshotDir: dir });

  await boxy.capture(fakePage(), { name: 'per-capture' });
  const baselinePath = path.join(dir, 'baseline', 'per-capture.json');
  assert.ok(fs.existsSync(baselinePath));

  // Capture again with per-capture update
  await boxy.capture(fakePage(), { name: 'per-capture', update: true });
  assert.ok(fs.existsSync(baselinePath), 'baseline should still exist after per-capture update');
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

import assert from 'node:assert/strict';
import { compare } from '../dist/regression.js';
import { makeElement, makeModel } from './fixtures/elements.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
  }
}

// ============================================================
// REGRESSION CHECK TESTS
// ============================================================

console.log('\n--- Regression Compare Tests ---');

test('Element disappeared — VISIBILITY', () => {
  const el = makeElement({
    selector: '[data-testid="widget"]',
    hasVisibleContent: true,
    box: { x: 100, y: 100, width: 200, height: 50 },
  });
  const baseline = makeModel([el]);
  const current = makeModel([]);
  const issues = compare(baseline, current);
  const vis = issues.filter(i => i.category === 'VISIBILITY');
  assert.ok(vis.length >= 1);
  assert.ok(vis[0].detail.includes('not found'));
});

test('Element became hidden — VISIBILITY', () => {
  const baseEl = makeElement({
    selector: '[data-testid="banner"]',
    visibility: 'visible',
    opacity: '1',
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="banner"]',
    visibility: 'hidden',
    opacity: '1',
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]));
  const vis = issues.filter(i => i.category === 'VISIBILITY');
  assert.ok(vis.length >= 1);
  assert.ok(vis[0].title.includes('hidden'));
});

test('Element became transparent — VISIBILITY', () => {
  const baseEl = makeElement({
    selector: '[data-testid="alert"]',
    visibility: 'visible',
    opacity: '1',
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="alert"]',
    visibility: 'visible',
    opacity: '0',
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]));
  const vis = issues.filter(i => i.category === 'VISIBILITY');
  assert.ok(vis.length >= 1);
});

test('Spacing changed — SPACING', () => {
  const baseEl = makeElement({
    selector: '[data-testid="item"]',
    siblingSpacing: { previousGap: 16, nextGap: 16, direction: 'vertical' },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="item"]',
    siblingSpacing: { previousGap: 4, nextGap: 16, direction: 'vertical' },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { spacingThreshold: 4 });
  const spacing = issues.filter(i => i.category === 'SPACING');
  assert.ok(spacing.length >= 1, `Expected SPACING issue, got ${spacing.length}`);
});

test('Spacing within threshold — no issue', () => {
  const baseEl = makeElement({
    selector: '[data-testid="item"]',
    siblingSpacing: { previousGap: 16, nextGap: 16, direction: 'vertical' },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="item"]',
    siblingSpacing: { previousGap: 14, nextGap: 16, direction: 'vertical' },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { spacingThreshold: 4 });
  const spacing = issues.filter(i => i.category === 'SPACING');
  assert.equal(spacing.length, 0);
});

test('Position shifted — POSITION', () => {
  const baseEl = makeElement({
    selector: '[data-testid="card"]',
    box: { x: 100, y: 100, width: 200, height: 50 },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="card"]',
    box: { x: 130, y: 100, width: 200, height: 50 },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { positionThreshold: 20 });
  const pos = issues.filter(i => i.category === 'POSITION');
  assert.ok(pos.length >= 1);
});

test('Position within threshold — no issue', () => {
  const baseEl = makeElement({
    selector: '[data-testid="card"]',
    box: { x: 100, y: 100, width: 200, height: 50 },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="card"]',
    box: { x: 115, y: 100, width: 200, height: 50 },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { positionThreshold: 20 });
  const pos = issues.filter(i => i.category === 'POSITION');
  assert.equal(pos.length, 0);
});

test('Size grew 50% — SIZE', () => {
  const baseEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 100, height: 50 },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 150, height: 50 },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { sizeChangePercent: 30 });
  const size = issues.filter(i => i.category === 'SIZE');
  assert.ok(size.length >= 1);
});

test('Size within threshold — no issue', () => {
  const baseEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 100, height: 50 },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 120, height: 50 },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { sizeChangePercent: 30 });
  const size = issues.filter(i => i.category === 'SIZE');
  assert.equal(size.length, 0);
});

test('Size from zero width to nonzero — SIZE', () => {
  const baseEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 0, height: 50 },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 20, height: 50 },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { sizeChangePercent: 30 });
  const size = issues.filter(i => i.category === 'SIZE');
  assert.equal(size.length, 1);
  assert.ok(size[0].detail.includes('100% change'));
});

test('sr-only clipped near origin — no POSITION or SIZE regression', () => {
  const baseEl = makeElement({
    selector: '.sr-only',
    position: 'absolute',
    overflow: 'hidden',
    styles: { overflow: 'hidden', clipPath: 'inset(50%)' },
    box: { x: 0, y: 0, width: 1, height: 1 },
    hasVisibleContent: true,
    childCount: 1,
  });
  const currEl = makeElement({
    selector: '.sr-only',
    position: 'absolute',
    overflow: 'hidden',
    styles: { overflow: 'hidden', clipPath: 'inset(50%)' },
    box: { x: 100, y: 100, width: 0, height: 0 },
    hasVisibleContent: true,
    childCount: 1,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), {
    positionThreshold: 20,
    sizeChangePercent: 30,
  });
  assert.equal(issues.filter(i => i.category === 'POSITION').length, 0);
  assert.equal(issues.filter(i => i.category === 'SIZE').length, 0);
});

test('New element appeared — no issue', () => {
  const baseEl = makeElement({
    selector: '[data-testid="existing"]',
    hasVisibleContent: true,
  });
  const newEl = makeElement({
    selector: '[data-testid="new-element"]',
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([baseEl, newEl]));
  // New elements should not be flagged
  const newIssues = issues.filter(i => i.selector === '[data-testid="new-element"]');
  assert.equal(newIssues.length, 0);
});

test('CSS diffs attach without data-testid ancestor', () => {
  const baseEl = makeElement({
    selector: '.panel > .item',
    box: { x: 0, y: 0, width: 100, height: 50 },
    styles: { margin: '0px' },
    hasVisibleContent: true,
  });
  const currEl = makeElement({
    selector: '.panel > .item',
    box: { x: 40, y: 0, width: 100, height: 50 },
    styles: { margin: '40px' },
    hasVisibleContent: true,
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]), { positionThreshold: 20 });
  const pos = issues.find(i => i.category === 'POSITION');
  assert.ok(pos?.styleChanges?.some(sc => sc.property === 'margin'), 'style changes should be attached without data-testid');
});

// ============================================================
// BROKEN SCROLL REGRESSION (overflow changed from scrollable to non-scrollable)
// ============================================================

console.log('--- Broken Scroll Regression ---');

test('overflow-y: auto → hidden with content still overflowing — CLIPPING', () => {
  const baseEl = makeElement({
    selector: '[data-testid="panel"]',
    box: { x: 0, y: 0, width: 300, height: 200 },
    scroll: { scrollWidth: 300, scrollHeight: 500, overflowX: 'visible', overflowY: 'auto' },
    overflow: 'auto',
  });
  const currEl = makeElement({
    selector: '[data-testid="panel"]',
    box: { x: 0, y: 0, width: 300, height: 200 },
    scroll: { scrollWidth: 300, scrollHeight: 500, overflowX: 'visible', overflowY: 'hidden' },
    overflow: 'hidden',
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]));
  const broken = issues.filter(i => i.title === 'Scroll removed — content now unreachable');
  assert.equal(broken.length, 1);
  assert.ok(broken[0].detail.includes('overflow-y: auto → hidden'));
  assert.ok(broken[0].detail.includes('scrollHeight: 500'));
});

test('overflow-x: scroll → clip with horizontal overflow — CLIPPING', () => {
  const baseEl = makeElement({
    selector: '[data-testid="carousel"]',
    box: { x: 0, y: 0, width: 400, height: 100 },
    scroll: { scrollWidth: 1200, scrollHeight: 100, overflowX: 'scroll', overflowY: 'visible' },
    overflow: 'scroll',
  });
  const currEl = makeElement({
    selector: '[data-testid="carousel"]',
    box: { x: 0, y: 0, width: 400, height: 100 },
    scroll: { scrollWidth: 1200, scrollHeight: 100, overflowX: 'clip', overflowY: 'visible' },
    overflow: 'clip',
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]));
  const broken = issues.filter(i => i.title === 'Scroll removed — content now unreachable');
  assert.equal(broken.length, 1);
  assert.ok(broken[0].detail.includes('overflow-x: scroll → clip'));
});

test('overflow-y: auto → hidden but content fits (no overflow) — no issue', () => {
  const baseEl = makeElement({
    selector: '[data-testid="panel"]',
    box: { x: 0, y: 0, width: 300, height: 200 },
    scroll: { scrollWidth: 300, scrollHeight: 150, overflowX: 'visible', overflowY: 'auto' },
  });
  const currEl = makeElement({
    selector: '[data-testid="panel"]',
    box: { x: 0, y: 0, width: 300, height: 200 },
    scroll: { scrollWidth: 300, scrollHeight: 150, overflowX: 'visible', overflowY: 'hidden' },
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]));
  const broken = issues.filter(i => i.title === 'Scroll removed — content now unreachable');
  assert.equal(broken.length, 0);
});

test('overflow stayed hidden (was always hidden) — no issue', () => {
  const baseEl = makeElement({
    selector: '[data-testid="carousel"]',
    box: { x: 0, y: 0, width: 400, height: 100 },
    scroll: { scrollWidth: 1200, scrollHeight: 100, overflowX: 'hidden', overflowY: 'visible' },
  });
  const currEl = makeElement({
    selector: '[data-testid="carousel"]',
    box: { x: 0, y: 0, width: 400, height: 100 },
    scroll: { scrollWidth: 1200, scrollHeight: 100, overflowX: 'hidden', overflowY: 'visible' },
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]));
  const broken = issues.filter(i => i.title === 'Scroll removed — content now unreachable');
  assert.equal(broken.length, 0);
});

test('overflow: visible → hidden (was never scrollable) — no issue', () => {
  const baseEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 300, height: 200 },
    scroll: { scrollWidth: 300, scrollHeight: 400, overflowX: 'visible', overflowY: 'visible' },
  });
  const currEl = makeElement({
    selector: '[data-testid="box"]',
    box: { x: 0, y: 0, width: 300, height: 200 },
    scroll: { scrollWidth: 300, scrollHeight: 400, overflowX: 'visible', overflowY: 'hidden' },
  });
  const issues = compare(makeModel([baseEl]), makeModel([currEl]));
  const broken = issues.filter(i => i.title === 'Scroll removed — content now unreachable');
  // visible → hidden is NOT "scroll removed" because visible was never scrollable (no scrollbar)
  assert.equal(broken.length, 0);
});

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('All regression tests passed.');

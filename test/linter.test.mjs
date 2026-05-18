import assert from 'node:assert/strict';
import { lint } from '../dist/linter.js';
import { checkClipping, checkCollapsed, checkOffScreen, checkOverlap, findOverlapIssues, isIgnored } from '../dist/linter.lib.js';
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
// FALSE POSITIVES — should produce 0 issues
// ============================================================

console.log('\n--- False Positives (should produce 0 issues) ---');

test('Text truncation — static element with overflow:hidden', () => {
  const el = makeElement({
    selector: '[data-testid="truncated-text"]',
    position: 'static',
    overflow: 'hidden',
    styles: { 'text-overflow': 'ellipsis', overflow: 'hidden' },
    clip: { isClipped: true, clippedBy: '[data-testid="parent"]', clippedEdges: { top: 0, bottom: 0, left: 0, right: 10 } },
    hasVisibleContent: true,
    childCount: 1,
  });
  const model = makeModel([el]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Scroll container — children beyond parent bounds', () => {
  const parent = makeElement({
    selector: '[data-testid="scroll-container"]',
    overflow: 'auto',
    box: { x: 0, y: 0, width: 400, height: 300 },
    childCount: 3,
  });
  const child = makeElement({
    selector: '[data-testid="scroll-child"]',
    position: 'static',
    parentSelector: '[data-testid="scroll-container"]',
    box: { x: 0, y: 300, width: 400, height: 200 },
    clip: { isClipped: true, clippedBy: '[data-testid="scroll-container"]', clippedEdges: { top: 0, bottom: 200, left: 0, right: 0 } },
  });
  const model = makeModel([parent, child]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Image cropping / avatar circle — static child clipped by parent', () => {
  const parent = makeElement({
    selector: '[data-testid="avatar"]',
    overflow: 'hidden',
    box: { x: 10, y: 10, width: 40, height: 40 },
    childCount: 1,
  });
  const img = makeElement({
    selector: '[data-testid="avatar"] img',
    position: 'static',
    parentSelector: '[data-testid="avatar"]',
    box: { x: 5, y: 5, width: 50, height: 50 },
    clip: { isClipped: true, clippedBy: '[data-testid="avatar"]', clippedEdges: { top: 5, bottom: 5, left: 5, right: 5 } },
  });
  const model = makeModel([parent, img]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Carousel / slider — static items outside overflow:hidden container', () => {
  const container = makeElement({
    selector: '[data-testid="carousel"]',
    overflow: 'hidden',
    box: { x: 0, y: 0, width: 600, height: 300 },
    childCount: 4,
  });
  const slide2 = makeElement({
    selector: '[data-testid="carousel"] .slide:nth-child(2)',
    position: 'static',
    parentSelector: '[data-testid="carousel"]',
    box: { x: 600, y: 0, width: 600, height: 300 },
    clip: { isClipped: true, clippedBy: '[data-testid="carousel"]', clippedEdges: { top: 0, bottom: 0, left: 0, right: 600 } },
  });
  const model = makeModel([container, slide2]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Collapsed accordion panel — hasVisibleContent:false', () => {
  const panel = makeElement({
    selector: '[data-testid="accordion-panel"]',
    box: { x: 0, y: 100, width: 400, height: 0 },
    overflow: 'hidden',
    hasVisibleContent: false,
    childCount: 5,
  });
  const model = makeModel([panel]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Tab panel — display:none not in model (absent)', () => {
  // display:none elements are not captured, so model is empty of the hidden tab
  const activeTab = makeElement({
    selector: '[data-testid="tab-panel-active"]',
    box: { x: 0, y: 50, width: 600, height: 400 },
    childCount: 2,
    hasVisibleContent: true,
  });
  const model = makeModel([activeTab]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Off-screen mobile menu — position:static is not flagged', () => {
  const menu = makeElement({
    selector: '[data-testid="mobile-menu"]',
    position: 'static',
    box: { x: -300, y: 0, width: 280, height: 600 },
    hasVisibleContent: true,
    childCount: 5,
  });
  const model = makeModel([menu]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Sticky header overlapping content — higher z-index NOT clipped', () => {
  const header = makeElement({
    selector: '[data-testid="sticky-header"]',
    position: 'fixed',
    zIndex: 100,
    box: { x: 0, y: 0, width: 1440, height: 60 },
    clip: { isClipped: false },
  });
  const content = makeElement({
    selector: '[data-testid="content"]',
    position: 'relative',
    zIndex: 1,
    box: { x: 0, y: 0, width: 1440, height: 900 },
    clip: { isClipped: false },
  });
  const model = makeModel([header, content]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Tooltip that fits — absolute inside overflow:hidden but within bounds', () => {
  const tooltip = makeElement({
    selector: '[data-testid="tooltip"]',
    position: 'absolute',
    box: { x: 110, y: 110, width: 80, height: 30 },
    clip: { isClipped: false },
    parentSelector: '[data-testid="container"]',
  });
  const container = makeElement({
    selector: '[data-testid="container"]',
    overflow: 'hidden',
    box: { x: 100, y: 100, width: 200, height: 200 },
    childCount: 1,
  });
  const model = makeModel([container, tooltip]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

test('Fixed modal overlay — within viewport bounds', () => {
  const modal = makeElement({
    selector: '[data-testid="modal"]',
    position: 'fixed',
    box: { x: 0, y: 0, width: 1440, height: 900 },
    zIndex: 1000,
    clip: { isClipped: false },
    hasVisibleContent: true,
    childCount: 3,
  });
  const model = makeModel([modal]);
  const issues = lint(model);
  assert.equal(issues.length, 0, `Expected 0 issues, got ${issues.length}`);
});

// ============================================================
// TRUE POSITIVES — should flag specific issues
// ============================================================

console.log('--- True Positives (should flag specific issues) ---');

test('Dropdown clipped by table cell — CLIPPING', () => {
  const dropdown = makeElement({
    selector: '[data-testid="dropdown"]',
    position: 'absolute',
    box: { x: 200, y: 300, width: 200, height: 250 },
    clip: {
      isClipped: true,
      clippedBy: 'td.cell',
      clippedEdges: { top: 0, bottom: 100, left: 0, right: 0 },
    },
    parentSelector: 'td.cell',
  });
  const model = makeModel([dropdown]);
  const issues = lint(model);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'CLIPPING');
});

test('Popover clipped by modal — CLIPPING', () => {
  const popover = makeElement({
    selector: '[data-testid="select-panel"]',
    position: 'absolute',
    box: { x: 300, y: 400, width: 250, height: 300 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="modal-body"]',
      clippedEdges: { top: 0, bottom: 80, left: 0, right: 0 },
    },
    parentSelector: '[data-testid="modal-body"]',
  });
  const model = makeModel([popover]);
  const issues = lint(model);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'CLIPPING');
});

test('Sidebar collapsed to 0 — COLLAPSED width', () => {
  const sidebar = makeElement({
    selector: '[data-testid="sidebar"]',
    box: { x: 0, y: 0, width: 2, height: 600 },
    hasVisibleContent: true,
    childCount: 5,
    overflow: 'hidden',
  });
  const model = makeModel([sidebar]);
  const issues = lint(model);
  assert.ok(issues.length >= 1);
  assert.equal(issues[0].category, 'COLLAPSED');
  assert.ok(issues[0].detail.includes('width'));
});

test('Element height collapsed — COLLAPSED height', () => {
  const el = makeElement({
    selector: '[data-testid="panel"]',
    box: { x: 0, y: 0, width: 400, height: 3 },
    hasVisibleContent: true,
    childCount: 2,
  });
  const model = makeModel([el]);
  const issues = lint(model);
  assert.ok(issues.length >= 1);
  assert.equal(issues[0].category, 'COLLAPSED');
  assert.ok(issues[0].detail.includes('height'));
});

test('Notification dropdown off-screen — OFF_SCREEN', () => {
  const dropdown = makeElement({
    selector: '[data-testid="notification-dropdown"]',
    position: 'absolute',
    box: { x: -500, y: 0, width: 300, height: 400 },
    hasVisibleContent: true,
    childCount: 3,
  });
  const model = makeModel([dropdown]);
  const issues = lint(model);
  assert.ok(issues.length >= 1);
  assert.equal(issues[0].category, 'OFF_SCREEN');
});

test('Element below viewport — OFF_SCREEN', () => {
  const el = makeElement({
    selector: '[data-testid="footer-popup"]',
    position: 'fixed',
    box: { x: 100, y: 2000, width: 300, height: 100 },
    hasVisibleContent: true,
    childCount: 1,
  });
  const model = makeModel([el], { width: 1440, height: 900 });
  const issues = lint(model);
  assert.ok(issues.length >= 1);
  assert.equal(issues[0].category, 'OFF_SCREEN');
});

test('High z-index clipped popup — OVERLAP', () => {
  const popup = makeElement({
    selector: '[data-testid="popup"]',
    position: 'absolute',
    zIndex: 100,
    box: { x: 50, y: 50, width: 200, height: 200 },
    clip: { isClipped: true, clippedBy: '[data-testid="container"]', clippedEdges: { top: 0, bottom: 50, left: 0, right: 0 } },
  });
  const behind = makeElement({
    selector: '[data-testid="behind"]',
    position: 'relative',
    zIndex: 1,
    box: { x: 100, y: 100, width: 200, height: 200 },
    clip: { isClipped: false },
  });
  const model = makeModel([popup, behind]);
  const issues = lint(model);
  const overlapIssues = issues.filter(i => i.category === 'OVERLAP');
  assert.ok(overlapIssues.length >= 1);
  assert.ok(overlapIssues[0].detail.includes('z:100'));
});

test('Nested clipping with children — affectedChildren', () => {
  const parent = makeElement({
    selector: '[data-testid="dropdown"]',
    position: 'absolute',
    box: { x: 200, y: 200, width: 200, height: 300 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="overflow-container"]',
      clippedEdges: { top: 0, bottom: 100, left: 0, right: 0 },
    },
    parentSelector: '[data-testid="overflow-container"]',
    childCount: 2,
  });
  const child = makeElement({
    selector: '[data-testid="dropdown"] [data-testid="tooltip"]',
    position: 'absolute',
    box: { x: 210, y: 400, width: 100, height: 40 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="overflow-container"]',
      clippedEdges: { top: 0, bottom: 40, left: 0, right: 0 },
    },
    parentSelector: '[data-testid="dropdown"]',
  });
  const model = makeModel([parent, child]);
  const issues = lint(model);
  const clipping = issues.filter(i => i.category === 'CLIPPING');
  // Parent is root, child is nested under it
  assert.equal(clipping.length, 1, `Expected 1 root CLIPPING issue, got ${clipping.length}`);
  assert.ok(clipping[0].affectedChildren && clipping[0].affectedChildren.length > 0);
});

test('Multiple dropdowns same container — 2 CLIPPING issues', () => {
  const dd1 = makeElement({
    selector: '[data-testid="dropdown-1"]',
    position: 'absolute',
    box: { x: 100, y: 200, width: 200, height: 300 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="table"]',
      clippedEdges: { top: 0, bottom: 80, left: 0, right: 0 },
    },
    parentSelector: '[data-testid="table"]',
  });
  const dd2 = makeElement({
    selector: '[data-testid="dropdown-2"]',
    position: 'absolute',
    box: { x: 400, y: 200, width: 200, height: 300 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="table"]',
      clippedEdges: { top: 0, bottom: 60, left: 0, right: 0 },
    },
    parentSelector: '[data-testid="table"]',
  });
  const model = makeModel([dd1, dd2]);
  const issues = lint(model);
  const clipping = issues.filter(i => i.category === 'CLIPPING');
  assert.equal(clipping.length, 2, `Expected 2 CLIPPING issues, got ${clipping.length}`);
});

test('Zero-dimension but has content — COLLAPSED', () => {
  const el = makeElement({
    selector: '[data-testid="zero-width"]',
    box: { x: 100, y: 100, width: 0, height: 50 },
    hasVisibleContent: true,
    childCount: 3,
  });
  const model = makeModel([el]);
  const issues = lint(model);
  // width: 0 is < collapsedMinSize (5), so checkCollapsed flags it
  const collapsed = issues.filter(i => i.category === 'COLLAPSED');
  assert.equal(collapsed.length, 1);
  assert.ok(collapsed[0].detail.includes('width'));
});

// ============================================================
// EDGE CASES
// ============================================================

console.log('--- Edge Cases ---');

test('Element exactly at viewport edge — NOT off-screen', () => {
  const el = makeElement({
    selector: '[data-testid="full-viewport"]',
    position: 'fixed',
    box: { x: 0, y: 0, width: 1440, height: 900 },
    hasVisibleContent: true,
  });
  const model = makeModel([el], { width: 1440, height: 900 });
  const issues = lint(model);
  const offScreen = issues.filter(i => i.category === 'OFF_SCREEN');
  assert.equal(offScreen.length, 0);
});

test('Element 1px beyond viewport — OFF_SCREEN', () => {
  const el = makeElement({
    selector: '[data-testid="past-edge"]',
    position: 'absolute',
    box: { x: 1441, y: 0, width: 200, height: 50 },
    hasVisibleContent: true,
    childCount: 1,
  });
  const model = makeModel([el], { width: 1440, height: 900 });
  const issues = lint(model);
  const offScreen = issues.filter(i => i.category === 'OFF_SCREEN');
  assert.equal(offScreen.length, 1);
});

test('Clipping by 1px — should flag CLIPPING', () => {
  const el = makeElement({
    selector: '[data-testid="barely-clipped"]',
    position: 'absolute',
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="parent"]',
      clippedEdges: { top: 0, bottom: 1, left: 0, right: 0 },
    },
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'CLIPPING').length, 1);
});

test('Collapsed at exactly threshold — NOT collapsed', () => {
  const el = makeElement({
    selector: '[data-testid="at-threshold"]',
    box: { x: 0, y: 0, width: 5, height: 50 },
    hasVisibleContent: true,
    childCount: 2,
  });
  // Default collapsedMinSize is 5, and check is `width < collapsedMinSize`
  const issues = lint(makeModel([el]), { collapsedMinSize: 5 });
  const collapsed = issues.filter(i => i.category === 'COLLAPSED');
  assert.equal(collapsed.length, 0);
});

test('Collapsed at threshold - 1 — COLLAPSED', () => {
  const el = makeElement({
    selector: '[data-testid="below-threshold"]',
    box: { x: 0, y: 0, width: 4, height: 50 },
    hasVisibleContent: true,
    childCount: 2,
  });
  const issues = lint(makeModel([el]), { collapsedMinSize: 5 });
  const collapsed = issues.filter(i => i.category === 'COLLAPSED');
  assert.equal(collapsed.length, 1);
});

test('Ignore list — element is skipped', () => {
  const el = makeElement({
    selector: '[data-testid="dropdown"]',
    position: 'absolute',
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="parent"]',
      clippedEdges: { top: 0, bottom: 50, left: 0, right: 0 },
    },
  });
  const issues = lint(makeModel([el]), { ignore: ['dropdown'] });
  assert.equal(issues.length, 0);
});

test('Zero-dimension element — linter does not crash', () => {
  const el = makeElement({
    selector: '[data-testid="zero"]',
    box: { x: 0, y: 0, width: 0, height: 0 },
    hasVisibleContent: false,
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.length, 0);
});

test('Overlap with equal z-index — still checks clipping', () => {
  const a = makeElement({
    selector: '[data-testid="a"]',
    position: 'absolute',
    zIndex: 5,
    box: { x: 0, y: 0, width: 100, height: 100 },
    clip: { isClipped: true, clippedBy: '[data-testid="container"]', clippedEdges: { top: 0, bottom: 20, left: 0, right: 0 } },
  });
  const b = makeElement({
    selector: '[data-testid="b"]',
    position: 'absolute',
    zIndex: 5,
    box: { x: 50, y: 50, width: 100, height: 100 },
    clip: { isClipped: false },
  });
  const model = makeModel([a, b]);
  const issues = lint(model);
  // Both have same z-index; checkOverlap picks one as "higher" (comparison: a.zIndex > b.zIndex is false, so b is "higher")
  // Since b is not clipped, no OVERLAP issue. But a itself triggers CLIPPING check.
  const clipping = issues.filter(i => i.category === 'CLIPPING');
  assert.ok(clipping.length >= 1);
});

// ============================================================
// STACKING CONTEXT TRAPS
// ============================================================

console.log('--- Stacking Context Traps ---');

test('Tooltip trapped by parent opacity (creates stacking context) — OVERLAP', () => {
  // parent has opacity:0.99 which creates a stacking context, trapping the tooltip
  const tooltip = makeElement({
    selector: '[data-testid="tooltip"]',
    position: 'absolute',
    zIndex: 9999,
    box: { x: 100, y: 100, width: 200, height: 40 },
    clip: { isClipped: true, clippedBy: '[data-testid="card"]', clippedEdges: { top: 0, bottom: 20, left: 0, right: 0 } },
  });
  const card = makeElement({
    selector: '[data-testid="card"]',
    position: 'relative',
    zIndex: 1,
    box: { x: 80, y: 80, width: 300, height: 200 },
    clip: { isClipped: false },
  });
  const model = makeModel([tooltip, card]);
  const issues = lint(model);
  const overlap = issues.filter(i => i.category === 'OVERLAP');
  assert.ok(overlap.length >= 1);
  assert.ok(overlap[0].detail.includes('z:9999'));
});

test('Popover behind sticky header — OVERLAP', () => {
  const popover = makeElement({
    selector: '[data-testid="popover"]',
    position: 'absolute',
    zIndex: 50,
    box: { x: 200, y: 10, width: 250, height: 200 },
    clip: { isClipped: true, clippedBy: '[data-testid="main"]', clippedEdges: { top: 10, bottom: 0, left: 0, right: 0 } },
  });
  const header = makeElement({
    selector: '[data-testid="header"]',
    position: 'sticky',
    zIndex: 100,
    box: { x: 0, y: 0, width: 1440, height: 60 },
    clip: { isClipped: false },
  });
  const model = makeModel([popover, header]);
  const issues = lint(model);
  // popover (z:50) overlaps header (z:100) — but header is higher and not clipped, so no OVERLAP
  // However popover IS clipped → CLIPPING
  const clipping = issues.filter(i => i.category === 'CLIPPING');
  assert.ok(clipping.length >= 1);
});

// ============================================================
// COLLAPSED EDGE CASES
// ============================================================

console.log('--- Collapsed Edge Cases ---');

test('Flex item crushed to near-zero by flex-shrink — COLLAPSED', () => {
  const item = makeElement({
    selector: '[data-testid="flex-button"]',
    box: { x: 500, y: 100, width: 3, height: 36 },
    hasVisibleContent: true,
    childCount: 1,
    tag: 'button',
  });
  const issues = lint(makeModel([item]));
  const collapsed = issues.filter(i => i.category === 'COLLAPSED');
  assert.equal(collapsed.length, 1);
  assert.ok(collapsed[0].detail.includes('width'));
});

test('Detail panel max-height clips content — absolute child CLIPPING', () => {
  const panel = makeElement({
    selector: '[data-testid="detail-panel"]',
    overflow: 'hidden',
    box: { x: 100, y: 100, width: 400, height: 150 },
    childCount: 5,
  });
  const content = makeElement({
    selector: '[data-testid="detail-content"]',
    position: 'absolute',
    parentSelector: '[data-testid="detail-panel"]',
    box: { x: 100, y: 100, width: 400, height: 500 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="detail-panel"]',
      clippedEdges: { top: 0, bottom: 350, left: 0, right: 0 },
    },
  });
  const model = makeModel([panel, content]);
  const issues = lint(model);
  assert.ok(issues.filter(i => i.category === 'CLIPPING').length >= 1);
});

// ============================================================
// OFF-SCREEN EDGE CASES
// ============================================================

console.log('--- Off-Screen Edge Cases ---');

test('Toast stuck at negative Y (animation failed) — OFF_SCREEN', () => {
  const toast = makeElement({
    selector: '[data-testid="toast"]',
    position: 'fixed',
    box: { x: 500, y: -200, width: 350, height: 60 },
    hasVisibleContent: true,
    childCount: 2,
  });
  const issues = lint(makeModel([toast]));
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 1);
});

test('Mobile menu off-screen via transform (absolute positioned) — OFF_SCREEN', () => {
  // getBoundingClientRect includes transforms, so box reflects actual position
  const menu = makeElement({
    selector: '[data-testid="mobile-nav"]',
    position: 'absolute',
    box: { x: -320, y: 0, width: 300, height: 800 },
    hasVisibleContent: true,
    childCount: 8,
  });
  const issues = lint(makeModel([menu]));
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 1);
});

test('Fixed bottom bar within viewport — no issue', () => {
  const bar = makeElement({
    selector: '[data-testid="bottom-bar"]',
    position: 'fixed',
    box: { x: 0, y: 850, width: 1440, height: 50 },
    hasVisibleContent: true,
    childCount: 4,
  });
  const issues = lint(makeModel([bar], { width: 1440, height: 900 }));
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 0);
});

// ============================================================
// FALSE POSITIVE TRAPS — things that LOOK broken but are fine
// ============================================================

console.log('--- False Positive Traps ---');

test('Dropdown in grid cell — static child clipped is OK', () => {
  const gridCell = makeElement({
    selector: '[data-testid="grid-cell"]',
    overflow: 'hidden',
    box: { x: 0, y: 0, width: 200, height: 100 },
    childCount: 2,
  });
  const content = makeElement({
    selector: '[data-testid="grid-cell"] .overflow-text',
    position: 'static',
    parentSelector: '[data-testid="grid-cell"]',
    box: { x: 0, y: 0, width: 200, height: 150 },
    clip: { isClipped: true, clippedBy: '[data-testid="grid-cell"]', clippedEdges: { top: 0, bottom: 50, left: 0, right: 0 } },
    hasVisibleContent: true,
  });
  const issues = lint(makeModel([gridCell, content]));
  // Static child clipped = intentional (text truncation in grid)
  assert.equal(issues.length, 0);
});

test('Relative-positioned element clipped — NOT flagged (known FN)', () => {
  // position:relative clipping is a known false negative — we only flag absolute/fixed
  const el = makeElement({
    selector: '[data-testid="relative-popover"]',
    position: 'relative',
    box: { x: 100, y: 100, width: 200, height: 300 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="container"]',
      clippedEdges: { top: 0, bottom: 100, left: 0, right: 0 },
    },
    hasVisibleContent: true,
  });
  const issues = lint(makeModel([el]));
  // Known false negative: relative elements are not flagged
  assert.equal(issues.filter(i => i.category === 'CLIPPING').length, 0);
});

test('Positioned element partially off-screen — NOT flagged (known FN)', () => {
  // Element hangs 160px off the right edge but is not FULLY off-screen
  const dropdown = makeElement({
    selector: '[data-testid="edge-dropdown"]',
    position: 'absolute',
    box: { x: 1400, y: 200, width: 200, height: 300 },
    hasVisibleContent: true,
    childCount: 5,
  });
  const issues = lint(makeModel([dropdown], { width: 1440, height: 900 }));
  // Known false negative: only fully off-screen triggers
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 0);
});

test('Overlap with z-index:0 elements — NOT checked (known FN)', () => {
  // Both elements have z-index:0, findOverlapIssues filters to zIndex > 0
  const a = makeElement({
    selector: '[data-testid="card-1"]',
    position: 'absolute',
    zIndex: 0,
    box: { x: 0, y: 0, width: 200, height: 200 },
    clip: { isClipped: true, clippedBy: '[data-testid="wrapper"]', clippedEdges: { top: 0, bottom: 30, left: 0, right: 0 } },
  });
  const b = makeElement({
    selector: '[data-testid="card-2"]',
    position: 'absolute',
    zIndex: 0,
    box: { x: 100, y: 100, width: 200, height: 200 },
    clip: { isClipped: false },
  });
  const issues = lint(makeModel([a, b]));
  // Known false negative: z-index:0 elements not checked for overlap
  const overlap = issues.filter(i => i.category === 'OVERLAP');
  assert.equal(overlap.length, 0);
  // But the clipped element still gets CLIPPING check
  assert.ok(issues.filter(i => i.category === 'CLIPPING').length >= 1);
});

// ============================================================
// ARIA / INTENT SUPPRESSION
// ============================================================

console.log('--- ARIA / Intent Suppression ---');

test('aria-hidden + visually invisible (opacity:0) — not flagged for CLIPPING', () => {
  const el = makeElement({
    selector: '[data-testid="hidden-menu"]',
    position: 'absolute',
    ariaHidden: true,
    opacity: '0',
    box: { x: 0, y: 50, width: 200, height: 300 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="nav"]',
      clippedEdges: { top: 0, bottom: 100, left: 0, right: 0 },
    },
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'CLIPPING').length, 0);
});

test('aria-hidden + visibility:hidden — not flagged for OFF_SCREEN', () => {
  const el = makeElement({
    selector: '[data-testid="drawer"]',
    position: 'fixed',
    ariaHidden: true,
    visibility: 'hidden',
    box: { x: -400, y: 0, width: 350, height: 900 },
    hasVisibleContent: true,
    childCount: 5,
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 0);
});

test('aria-hidden alone (still visible) — STILL flagged for CLIPPING', () => {
  // Decorative icon with aria-hidden but visually rendered — clipping is still a bug
  const el = makeElement({
    selector: '[data-testid="icon"]',
    position: 'absolute',
    ariaHidden: true,
    visibility: 'visible',
    opacity: '1',
    box: { x: 50, y: 50, width: 24, height: 24 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="button"]',
      clippedEdges: { top: 0, bottom: 10, left: 0, right: 0 },
    },
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'CLIPPING').length, 1);
});

test('aria-hidden alone (still visible) — STILL flagged for OFF_SCREEN', () => {
  const el = makeElement({
    selector: '[data-testid="visible-drawer"]',
    position: 'fixed',
    ariaHidden: true,
    visibility: 'visible',
    opacity: '1',
    box: { x: -400, y: 0, width: 350, height: 900 },
    hasVisibleContent: true,
    childCount: 5,
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 1);
});

test('Element with hasVisibleContent:false — not flagged for COLLAPSED', () => {
  const el = makeElement({
    selector: '[data-testid="collapsed-panel"]',
    box: { x: 0, y: 0, width: 400, height: 2 },
    hasVisibleContent: false,
    childCount: 3,
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'COLLAPSED').length, 0);
});

test('sr-only pattern (absolute, 1x1, large negative coords) — not flagged OFF_SCREEN', () => {
  const el = makeElement({
    selector: '[data-testid="skip-link"]',
    position: 'absolute',
    box: { x: -10000, y: 0, width: 1, height: 1 },
    hasVisibleContent: true,
    childCount: 1,
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 0);
});

test('sr-only pattern — not flagged COLLAPSED', () => {
  const el = makeElement({
    selector: '.sr-only',
    position: 'absolute',
    box: { x: -10000, y: 0, width: 1, height: 1 },
    hasVisibleContent: true,
    childCount: 1,
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'COLLAPSED').length, 0);
});

test('Actual off-screen bug (NOT aria-hidden, NOT sr-only) — still flagged', () => {
  const el = makeElement({
    selector: '[data-testid="broken-popup"]',
    position: 'absolute',
    ariaHidden: false,
    box: { x: -500, y: 100, width: 300, height: 200 },
    hasVisibleContent: true,
    childCount: 2,
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.filter(i => i.category === 'OFF_SCREEN').length, 1);
});

test('Closed dropdown with aria-hidden but NOT aria-hidden on clipped child — child still flagged', () => {
  // The dropdown trigger has aria-expanded=false, but the dropdown panel
  // does NOT have aria-hidden (developer forgot). Should still flag.
  const panel = makeElement({
    selector: '[data-testid="dropdown-panel"]',
    position: 'absolute',
    ariaHidden: false,
    box: { x: 100, y: 200, width: 200, height: 300 },
    clip: {
      isClipped: true,
      clippedBy: '[data-testid="container"]',
      clippedEdges: { top: 0, bottom: 80, left: 0, right: 0 },
    },
  });
  const issues = lint(makeModel([panel]));
  assert.equal(issues.filter(i => i.category === 'CLIPPING').length, 1);
});

// ============================================================
// BROKEN SCROLL — static lint should NOT flag these (moved to regression)
// ============================================================

console.log('--- Broken Scroll (static lint should NOT flag) ---');

test('Overflow:hidden with scrollHeight > height — NOT flagged in static lint', () => {
  // This is the carousel/slider case — static lint can't distinguish broken scroll from intentional
  const container = makeElement({
    selector: '[data-testid="list-container"]',
    overflow: 'hidden',
    box: { x: 0, y: 0, width: 300, height: 200 },
    scroll: { scrollWidth: 300, scrollHeight: 500, overflowX: 'visible', overflowY: 'hidden' },
    childCount: 5,
  });
  const child1 = makeElement({
    selector: '[data-testid="list-item-3"]',
    position: 'static',
    parentSelector: '[data-testid="list-container"]',
    box: { x: 0, y: 200, width: 300, height: 50 },
    hasVisibleContent: true,
    clip: { isClipped: true, clippedBy: '[data-testid="list-container"]', clippedEdges: { top: 0, bottom: 50, left: 0, right: 0 } },
  });
  const model = makeModel([container, child1]);
  const issues = lint(model);
  // Static lint does not flag broken scroll — only regression detects this
  const brokenScroll = issues.filter(i => i.detail && i.detail.includes('unreachable'));
  assert.equal(brokenScroll.length, 0);
});

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('All linter tests passed.');

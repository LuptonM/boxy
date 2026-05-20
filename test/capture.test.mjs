/**
 * Capture Verification Tests
 *
 * These tests close the gap between synthetic model tests (linter.test.mjs,
 * regression.test.mjs) and end-to-end mutation tests (mutations.mjs).
 *
 * They render real HTML in a real browser, run captureModel(), and assert
 * the raw model fields are correct. If the capture layer produces different
 * data than what the linter/regression tests assume, these tests catch it.
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { capture } from '../dist/capture.js';

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  if (error.message?.includes('MachPortRendezvousServer') && error.message?.includes('Permission denied')) {
    console.warn('  Skipping capture verification: Chromium cannot launch in this sandboxed shell.');
    process.exit(0);
  }
  throw error;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await fn(page);
    passed++;
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
  }
  await ctx.close();
}

function find(model, testId) {
  return model.elements.find(el => el.selector === `[data-testid="${testId}"]`);
}

// ============================================================
// CLIPPING — the most important check
// ============================================================

console.log('\n--- Capture: Clipping ---');

await test('Absolute dropdown clipped by overflow:hidden parent', async (page) => {
  await page.setContent(`
    <div data-testid="container" style="position: relative; width: 200px; height: 100px; overflow: hidden;">
      <div data-testid="dropdown" style="position: absolute; top: 60px; left: 10px; width: 150px; height: 120px; background: blue;">
        Menu item
      </div>
    </div>
  `);
  const { model } = await capture(page, { name: 'clip-test' });
  const dropdown = find(model, 'dropdown');
  assert.ok(dropdown, 'dropdown should be captured');
  assert.equal(dropdown.clip.isClipped, true, 'dropdown should be marked as clipped');
  assert.ok(dropdown.clip.clippedEdges.bottom > 0, 'bottom edge should be clipped');
  assert.ok(dropdown.clip.clippedBy.includes('container'), 'clippedBy should reference container');
  assert.equal(dropdown.position, 'absolute');
});

await test('Absolute element NOT clipped when it fits within parent', async (page) => {
  await page.setContent(`
    <div data-testid="container" style="position: relative; width: 300px; height: 300px; overflow: hidden;">
      <div data-testid="tooltip" style="position: absolute; top: 10px; left: 10px; width: 100px; height: 30px;">
        Fits
      </div>
    </div>
  `);
  const { model } = await capture(page, { name: 'no-clip-test' });
  const tooltip = find(model, 'tooltip');
  assert.ok(tooltip);
  assert.equal(tooltip.clip.isClipped, false, 'element that fits should not be clipped');
});

await test('Static element clipped by overflow:hidden — capture still marks isClipped', async (page) => {
  await page.setContent(`
    <div data-testid="container" style="width: 200px; height: 50px; overflow: hidden;">
      <div data-testid="text" style="width: 200px; height: 100px;">Long text content here that overflows</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'static-clip' });
  const text = find(model, 'text');
  assert.ok(text);
  // Capture marks clipping regardless of position — the LINTER filters by position
  assert.equal(text.clip.isClipped, true, 'capture should mark static element as clipped');
  assert.equal(text.position, 'static', 'position should be static');
});

await test('Nested clipping — element clipped by grandparent', async (page) => {
  await page.setContent(`
    <div data-testid="grandparent" style="position: relative; width: 200px; height: 100px; overflow: hidden;">
      <div data-testid="parent" style="position: relative; width: 200px; height: 100px;">
        <div data-testid="popup" style="position: absolute; top: 80px; left: 10px; width: 100px; height: 80px;">
          Popup
        </div>
      </div>
    </div>
  `);
  const { model } = await capture(page, { name: 'nested-clip' });
  const popup = find(model, 'popup');
  assert.ok(popup);
  assert.equal(popup.clip.isClipped, true);
  assert.ok(popup.clip.clippedEdges.bottom > 0);
  assert.ok(popup.clip.clippedBy.includes('grandparent'), 'should be clipped by grandparent, not immediate parent');
});

// ============================================================
// BOUNDING BOX
// ============================================================

console.log('--- Capture: Bounding Box ---');

await test('Box dimensions match rendered size', async (page) => {
  await page.setContent(`
    <body style="margin: 0;">
      <div data-testid="box" style="width: 250px; height: 120px; margin: 50px 0 0 80px;">Content</div>
    </body>
  `);
  const { model } = await capture(page, { name: 'box-test' });
  const el = find(model, 'box');
  assert.ok(el);
  assert.equal(el.box.width, 250);
  assert.equal(el.box.height, 120);
  assert.equal(el.box.x, 80);
  assert.equal(el.box.y, 50);
});

await test('Transform affects bounding box', async (page) => {
  await page.setContent(`
    <div data-testid="shifted" style="width: 100px; height: 50px; transform: translateX(200px);">Shifted</div>
  `);
  const { model } = await capture(page, { name: 'transform-box' });
  const el = find(model, 'shifted');
  assert.ok(el);
  // getBoundingClientRect includes transforms
  assert.ok(el.box.x >= 200, `x should include transform offset, got ${el.box.x}`);
});

// ============================================================
// POSITION
// ============================================================

console.log('--- Capture: Position ---');

await test('Position values captured correctly', async (page) => {
  await page.setContent(`
    <div data-testid="static-el" style="width: 50px; height: 50px;">S</div>
    <div data-testid="relative-el" style="position: relative; width: 50px; height: 50px;">R</div>
    <div data-testid="absolute-el" style="position: absolute; top: 0; left: 0; width: 50px; height: 50px;">A</div>
    <div data-testid="fixed-el" style="position: fixed; top: 200px; left: 200px; width: 50px; height: 50px;">F</div>
  `);
  const { model } = await capture(page, { name: 'pos-test', scope: 'body' });
  assert.equal(find(model, 'static-el')?.position, 'static');
  assert.equal(find(model, 'relative-el')?.position, 'relative');
  assert.equal(find(model, 'absolute-el')?.position, 'absolute');
  assert.equal(find(model, 'fixed-el')?.position, 'fixed');
});

// ============================================================
// Z-INDEX
// ============================================================

console.log('--- Capture: Z-Index ---');

await test('z-index captured as number', async (page) => {
  await page.setContent(`
    <div data-testid="auto-z" style="position: relative; width: 50px; height: 50px;">auto</div>
    <div data-testid="high-z" style="position: relative; z-index: 999; width: 50px; height: 50px;">999</div>
    <div data-testid="neg-z" style="position: relative; z-index: -1; width: 50px; height: 50px;">-1</div>
  `);
  const { model } = await capture(page, { name: 'z-test', scope: 'body' });
  assert.equal(find(model, 'auto-z')?.zIndex, 0, 'auto z-index should be 0');
  assert.equal(find(model, 'high-z')?.zIndex, 999);
  assert.equal(find(model, 'neg-z')?.zIndex, -1);
});

// ============================================================
// VISIBILITY & OPACITY
// ============================================================

console.log('--- Capture: Visibility & Opacity ---');

await test('visibility:hidden captured correctly', async (page) => {
  await page.setContent(`
    <div data-testid="hidden-el" style="visibility: hidden; width: 100px; height: 50px;">Hidden</div>
  `);
  const { model } = await capture(page, { name: 'vis-test' });
  const el = find(model, 'hidden-el');
  assert.ok(el);
  assert.equal(el.visibility, 'hidden');
});

await test('opacity:0 captured correctly', async (page) => {
  await page.setContent(`
    <div data-testid="transparent" style="opacity: 0; width: 100px; height: 50px;">Invisible</div>
  `);
  const { model } = await capture(page, { name: 'opacity-test' });
  const el = find(model, 'transparent');
  assert.ok(el);
  assert.equal(el.opacity, '0');
});

await test('Inherited opacity from parent is computed', async (page) => {
  await page.setContent(`
    <div data-testid="parent" style="opacity: 0.5; width: 200px; height: 100px;">
      <div data-testid="child" style="opacity: 0.5; width: 100px; height: 50px;">Child</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'inherited-opacity' });
  const child = find(model, 'child');
  assert.ok(child);
  // Effective opacity = 0.5 * 0.5 = 0.25
  assert.equal(parseFloat(child.opacity), 0.25, `effective opacity should be 0.25, got ${child.opacity}`);
});

await test('Inherited visibility:hidden from parent', async (page) => {
  await page.setContent(`
    <div data-testid="parent" style="visibility: hidden; width: 200px; height: 100px;">
      <div data-testid="child" style="width: 100px; height: 50px;">Child</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'inherited-vis' });
  const child = find(model, 'child');
  assert.ok(child);
  assert.equal(child.visibility, 'hidden', 'child should inherit visibility:hidden');
});

// ============================================================
// OVERFLOW & SCROLL
// ============================================================

console.log('--- Capture: Overflow & Scroll ---');

await test('overflow property captured', async (page) => {
  await page.setContent(`
    <div data-testid="scroll-box" style="width: 200px; height: 100px; overflow: auto;">
      <div style="height: 500px;">Tall content</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'overflow-test' });
  const el = find(model, 'scroll-box');
  assert.ok(el);
  assert.equal(el.overflow, 'auto');
  assert.equal(el.scroll.overflowY, 'auto');
  assert.ok(el.scroll.scrollHeight > el.box.height, `scrollHeight (${el.scroll.scrollHeight}) should exceed box height (${el.box.height})`);
});

await test('overflow:hidden with overflowing content', async (page) => {
  await page.setContent(`
    <div data-testid="hidden-overflow" style="width: 200px; height: 100px; overflow: hidden;">
      <div style="height: 400px;">Trapped content</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'hidden-overflow' });
  const el = find(model, 'hidden-overflow');
  assert.ok(el);
  assert.equal(el.overflow, 'hidden');
  assert.equal(el.scroll.overflowY, 'hidden');
  assert.ok(el.scroll.scrollHeight > el.box.height);
});

// ============================================================
// SIBLING SPACING
// ============================================================

console.log('--- Capture: Sibling Spacing ---');

await test('Vertical sibling spacing captured', async (page) => {
  await page.setContent(`
    <div data-testid="parent" style="display: flex; flex-direction: column; gap: 16px; width: 200px;">
      <div data-testid="first" style="height: 40px; background: gray;">A</div>
      <div data-testid="second" style="height: 40px; background: gray;">B</div>
      <div data-testid="third" style="height: 40px; background: gray;">C</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'spacing-test' });
  const second = find(model, 'second');
  assert.ok(second);
  assert.equal(second.siblingSpacing.previousGap, 16, `gap should be 16px, got ${second.siblingSpacing.previousGap}`);
  assert.equal(second.siblingSpacing.direction, 'vertical');
});

await test('Horizontal sibling spacing captured', async (page) => {
  await page.setContent(`
    <div data-testid="row" style="display: flex; gap: 24px;">
      <div data-testid="col-a" style="width: 80px; height: 40px; background: gray;">A</div>
      <div data-testid="col-b" style="width: 80px; height: 40px; background: gray;">B</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'h-spacing' });
  const b = find(model, 'col-b');
  assert.ok(b);
  assert.equal(b.siblingSpacing.previousGap, 24, `gap should be 24px, got ${b.siblingSpacing.previousGap}`);
  assert.equal(b.siblingSpacing.direction, 'horizontal');
});

// ============================================================
// COLLAPSED ELEMENTS
// ============================================================

console.log('--- Capture: Collapsed ---');

await test('Collapsed sidebar has near-zero width in model', async (page) => {
  await page.setContent(`
    <div data-testid="sidebar" style="width: 2px; height: 400px; overflow: hidden;">
      <div>Nav 1</div>
      <div>Nav 2</div>
      <div>Nav 3</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'collapsed-test' });
  const sidebar = find(model, 'sidebar');
  assert.ok(sidebar);
  assert.equal(sidebar.box.width, 2, 'collapsed width should be 2px');
  assert.ok(sidebar.childCount >= 3, 'should have children');
});

// ============================================================
// ARIA ATTRIBUTES
// ============================================================

console.log('--- Capture: ARIA ---');

await test('aria-hidden captured', async (page) => {
  await page.setContent(`
    <div data-testid="icon" aria-hidden="true" style="width: 24px; height: 24px;">★</div>
    <div data-testid="label" style="width: 100px; height: 20px;">Label</div>
  `);
  const { model } = await capture(page, { name: 'aria-test' });
  assert.equal(find(model, 'icon')?.ariaHidden, true);
  assert.equal(find(model, 'label')?.ariaHidden, false);
});

await test('role attribute captured', async (page) => {
  await page.setContent(`
    <div data-testid="menu" role="menu" style="width: 200px; height: 100px;">
      <div role="menuitem" data-testid="item" style="height: 30px;">Item</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'role-test' });
  assert.equal(find(model, 'menu')?.role, 'menu');
  assert.equal(find(model, 'item')?.role, 'menuitem');
});

// ============================================================
// hasVisibleContent
// ============================================================

console.log('--- Capture: hasVisibleContent ---');

await test('Element with text has hasVisibleContent=true', async (page) => {
  await page.setContent(`
    <div data-testid="with-text" style="width: 100px; height: 30px;">Hello</div>
  `);
  const { model } = await capture(page, { name: 'content-test' });
  assert.equal(find(model, 'with-text')?.hasVisibleContent, true);
});

await test('visibility:hidden element has hasVisibleContent=false', async (page) => {
  await page.setContent(`
    <div data-testid="hidden-content" style="visibility: hidden; width: 100px; height: 30px;">Hidden text</div>
  `);
  const { model } = await capture(page, { name: 'hidden-content-test' });
  assert.equal(find(model, 'hidden-content')?.hasVisibleContent, false);
});

// ============================================================
// PARENT SELECTOR
// ============================================================

console.log('--- Capture: Parent Selector ---');

await test('parentSelector references correct parent', async (page) => {
  await page.setContent(`
    <div data-testid="outer" style="width: 300px; height: 200px;">
      <div data-testid="inner" style="width: 100px; height: 50px;">Child</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'parent-test' });
  const inner = find(model, 'inner');
  assert.ok(inner);
  assert.ok(inner.parentSelector?.includes('outer'), `parentSelector should reference outer, got: ${inner.parentSelector}`);
});

// ============================================================
// STYLES
// ============================================================

console.log('--- Capture: Computed Styles ---');

await test('Layout-relevant CSS properties captured', async (page) => {
  await page.setContent(`
    <div data-testid="styled" style="
      display: flex;
      position: relative;
      overflow: auto;
      width: 300px;
      height: 200px;
      max-height: 200px;
      padding: 16px;
      gap: 8px;
    ">
      <div style="width: 50px; height: 50px;">A</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'styles-test' });
  const el = find(model, 'styled');
  assert.ok(el);
  assert.equal(el.styles.display, 'flex');
  assert.equal(el.styles.position, 'relative');
  assert.ok(el.styles.overflow); // 'auto' or 'auto auto'
  assert.ok(el.styles.maxHeight, 'maxHeight should be captured');
  assert.ok(el.styles.padding, 'padding should be captured');
  assert.ok(el.styles.gap, 'gap should be captured');
});

// ============================================================
// REAL-WORLD SCENARIOS — what the linter actually needs
// ============================================================

console.log('--- Capture: Real-World Scenarios ---');

await test('Dropdown clipped by table — full pipeline data', async (page) => {
  await page.setContent(`
    <div data-testid="table" style="position: relative; width: 600px; height: 300px; overflow: hidden;">
      <div data-testid="row" style="position: relative; width: 600px; height: 40px; margin-top: 250px;">
        <button data-testid="action-btn" style="width: 30px; height: 30px;">⋮</button>
        <div data-testid="action-menu" style="position: absolute; top: 100%; left: 0; width: 150px; height: 120px; background: white; z-index: 10;">
          <div>Edit</div>
          <div>Delete</div>
          <div>Archive</div>
        </div>
      </div>
    </div>
  `);
  const { model } = await capture(page, { name: 'table-dropdown' });
  const menu = find(model, 'action-menu');
  assert.ok(menu, 'action-menu should be in model');
  assert.equal(menu.position, 'absolute', 'menu should be absolute');
  assert.equal(menu.clip.isClipped, true, 'menu should be clipped');
  assert.ok(menu.clip.clippedEdges.bottom > 0, 'bottom should be clipped');
  assert.ok(menu.clip.clippedBy.includes('table'), `clippedBy should be the table, got: ${menu.clip.clippedBy}`);
  assert.ok(menu.zIndex > 0, 'z-index should be captured');
  assert.ok(menu.hasVisibleContent, 'should have visible content');
  assert.equal(menu.childCount, 3);
});

await test('Fixed modal with select dropdown — portal scenario', async (page) => {
  await page.setContent(`
    <div data-testid="app" style="width: 1440px; height: 900px;">
      <div data-testid="modal" style="position: fixed; top: 100px; left: 300px; width: 500px; height: 200px; overflow: hidden; z-index: 1000;">
        <div data-testid="form" style="padding: 20px;">
          <div data-testid="select-trigger" style="position: relative; width: 200px; height: 36px; border: 1px solid gray;">
            Select...
            <div data-testid="select-dropdown" style="position: absolute; top: 100%; left: 0; width: 200px; height: 300px; background: white; z-index: 1001;">
              <div>Option 1</div>
              <div>Option 2</div>
              <div>Option 3</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
  const { model } = await capture(page, { name: 'modal-select', scope: '[data-testid="modal"]' });
  const dropdown = find(model, 'select-dropdown');
  assert.ok(dropdown, 'select-dropdown should be captured within modal scope');
  assert.equal(dropdown.clip.isClipped, true, 'dropdown should be clipped by modal overflow:hidden');
  assert.ok(dropdown.clip.clippedBy.includes('modal'), `should be clipped by modal, got: ${dropdown.clip.clippedBy}`);
});

await test('Scrollable container losing scroll — captures scroll dimensions', async (page) => {
  await page.setContent(`
    <div data-testid="list" style="width: 300px; height: 150px; overflow: auto;">
      <div style="height: 30px;">Item 1</div>
      <div style="height: 30px;">Item 2</div>
      <div style="height: 30px;">Item 3</div>
      <div style="height: 30px;">Item 4</div>
      <div style="height: 30px;">Item 5</div>
      <div style="height: 30px;">Item 6</div>
      <div style="height: 30px;">Item 7</div>
      <div style="height: 30px;">Item 8</div>
    </div>
  `);
  const { model } = await capture(page, { name: 'scroll-data' });
  const list = find(model, 'list');
  assert.ok(list);
  assert.equal(list.scroll.overflowY, 'auto');
  assert.ok(list.scroll.scrollHeight > list.box.height,
    `scrollHeight (${list.scroll.scrollHeight}) should exceed height (${list.box.height})`);
});

await test('Overlapping positioned elements — z-index data for overlap check', async (page) => {
  await page.setContent(`
    <div data-testid="wrapper" style="position: relative; width: 400px; height: 300px;">
      <div data-testid="header" style="position: sticky; top: 0; z-index: 100; width: 400px; height: 60px; background: white;">
        Header
      </div>
      <div data-testid="popover" style="position: absolute; top: 20px; left: 100px; z-index: 50; width: 200px; height: 150px; background: yellow;">
        Popover
      </div>
    </div>
  `);
  const { model } = await capture(page, { name: 'overlap-data' });
  const header = find(model, 'header');
  const popover = find(model, 'popover');
  assert.ok(header && popover);
  assert.equal(header.zIndex, 100);
  assert.equal(popover.zIndex, 50);
  // Boxes should overlap (popover starts at y:20, header covers y:0-60)
  assert.ok(popover.box.y < header.box.y + header.box.height, 'popover should overlap header vertically');
});

await test('Off-screen element captured with correct coordinates', async (page) => {
  await page.setContent(`
    <div data-testid="app" style="width: 1440px; height: 900px;">
      <div data-testid="flyout" style="position: absolute; left: -500px; top: 100px; width: 300px; height: 200px;">
        Off-screen content
      </div>
    </div>
  `);
  const { model } = await capture(page, { name: 'offscreen-data', scope: 'body' });
  const flyout = find(model, 'flyout');
  assert.ok(flyout, 'off-screen element should still be in model');
  assert.ok(flyout.box.x + flyout.box.width < 0, 'element should be fully off-screen left');
  assert.equal(flyout.position, 'absolute');
  assert.equal(flyout.hasVisibleContent, true);
});

// ============================================================
// SUMMARY
// ============================================================

await browser.close();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('All capture verification tests passed.');

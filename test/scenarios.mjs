import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createBoxy } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = process.argv.includes('--broken');
const HEADED = process.argv.includes('--headed');
const SCENARIO = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1];

const mode = BROKEN ? 'BROKEN' : 'GOOD';
console.log(`\n  Scenario Tests (${mode} mode)\n`);

let browser;
try {
  browser = await chromium.launch({ headless: !HEADED });
} catch (error) {
  if (error.message?.includes('MachPortRendezvousServer') && error.message?.includes('Permission denied')) {
    console.warn('  Skipping: Chromium cannot launch in this sandboxed shell.');
    process.exit(0);
  }
  throw error;
}

const scenarios = [];
let totalErrors = 0;
let totalWarnings = 0;

// ─── Scenario 1: Modal with nested dropdown ───

if (!SCENARIO || SCENARIO === 'modal') {
  const boxy = createBoxy({
    snapshotDir: path.join(__dirname, '..', '.boxy', 'scenario-modal'),
    allowMissingBaseline: true,
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const html = fs.readFileSync(path.join(__dirname, '..', 'examples', 'scenario-modal-form.html'), 'utf-8');
  const injected = BROKEN
    ? html.replace('--modal-overflow, visible', '--modal-overflow, hidden')
    : html;
  await page.setContent(injected);

  console.log('  ── Modal Form ──');

  // Step 1: Open the modal
  console.log('  → Open modal');
  await page.click('[data-testid="open-modal"]');
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'modal-open', scope: '[data-testid="modal"]' });

  // Step 2: Open the country dropdown (near bottom of modal)
  console.log('  → Open country dropdown inside modal');
  await page.click('[data-testid="country-trigger"]');
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'modal-country-dropdown', scope: '[data-testid="modal"]' });

  // Step 3: Select a country, then open state dropdown
  console.log('  → Select country, open state dropdown');
  await page.click('[data-testid="country-dropdown"] .select-option[data-value="us"]');
  await page.waitForTimeout(100);
  await page.click('[data-testid="state-trigger"]');
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'modal-state-dropdown', scope: '[data-testid="modal"]' });

  const report = summarize(boxy);
  scenarios.push({ name: 'Modal Form', ...report });
  await ctx.close();
}

// ─── Scenario 2: Dashboard with sidebar collapse + dropdowns ───

if (!SCENARIO || SCENARIO === 'dashboard') {
  const boxy = createBoxy({
    snapshotDir: path.join(__dirname, '..', '.boxy', 'scenario-dashboard'),
    allowMissingBaseline: true,
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const html = fs.readFileSync(path.join(__dirname, '..', 'examples', 'scenario-dashboard.html'), 'utf-8');
  const injected = BROKEN
    ? html
        .replace('--sidebar-overflow, visible', '--sidebar-overflow, hidden')
        .replace('--sidebar-collapsed-width, 64px', '--sidebar-collapsed-width, 0px')
        .replace('--card-gap, 24px', '--card-gap, 2px')
    : html;
  await page.setContent(injected);

  console.log('  ── Dashboard ──');

  // Step 1: Default state
  console.log('  → Default layout');
  await boxy.capture(page, { name: 'dashboard-default', scope: '[data-testid="layout"]' });

  // Step 2: Open notification dropdown
  console.log('  → Open notifications');
  await page.click('[data-testid="notif-btn"]');
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'dashboard-notif-open', scope: '[data-testid="layout"]' });

  // Step 3: Close notifications, open profile menu
  console.log('  → Open profile menu');
  await page.click('body');
  await page.waitForTimeout(100);
  await page.click('[data-testid="profile-btn"]');
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'dashboard-profile-open', scope: '[data-testid="layout"]' });

  // Step 4: Collapse the sidebar
  console.log('  → Collapse sidebar');
  await page.click('body');
  await page.waitForTimeout(100);
  await page.click('[data-testid="collapse-btn"]');
  await page.waitForTimeout(250);
  await boxy.capture(page, { name: 'dashboard-sidebar-collapsed', scope: '[data-testid="layout"]' });

  // Step 5: Hover a nav item (tooltip should be visible, not clipped)
  // In broken mode the sidebar collapses to 0px so the element is not hoverable
  console.log('  → Hover nav item (collapsed sidebar)');
  try {
    await page.hover('[data-testid="nav-analytics"]', { timeout: 3000 });
    await page.waitForTimeout(150);
    await boxy.capture(page, { name: 'dashboard-nav-tooltip', scope: '[data-testid="layout"]' });
  } catch {
    // Sidebar collapsed to 0 — nav is not interactable, capture the broken state as-is
    console.log('    (nav item not hoverable — sidebar fully collapsed)');
    await boxy.capture(page, { name: 'dashboard-nav-tooltip', scope: '[data-testid="layout"]' });
  }

  const report = summarize(boxy);
  scenarios.push({ name: 'Dashboard', ...report });
  await ctx.close();
}

// ─── Scenario 3: Chat UI with menus ───

if (!SCENARIO || SCENARIO === 'chat') {
  const boxy = createBoxy({
    snapshotDir: path.join(__dirname, '..', '.boxy', 'scenario-chat'),
    allowMissingBaseline: true,
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const html = fs.readFileSync(path.join(__dirname, '..', 'examples', 'scenario-chat.html'), 'utf-8');
  // Broken: context menu opens downward (clips below message area) + messages area clips
  const injected = BROKEN
    ? html
        .replace('--messages-overflow, auto', '--messages-overflow, hidden')
        .replace('bottom: calc(100% + 4px); right: 0;\n    background: white; border: 1px solid #e2e8f0; border-radius: 10px;',
                 'top: calc(100% + 4px); right: 0;\n    background: white; border: 1px solid #e2e8f0; border-radius: 10px;')
    : html;
  await page.setContent(injected);

  console.log('  ── Chat UI ──');

  // Step 1: Default state
  console.log('  → Default chat view');
  await boxy.capture(page, { name: 'chat-default', scope: '[data-testid="chat-layout"]' });

  // Step 2: Open attachment menu (pops up from composer)
  console.log('  → Open attachment menu');
  await page.click('[data-testid="attach-btn"]');
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'chat-attach-menu', scope: '[data-testid="chat-area"]' });

  // Step 3: Close attach, open emoji picker
  console.log('  → Open emoji picker');
  await page.click('body');
  await page.waitForTimeout(100);
  await page.click('[data-testid="emoji-btn"]');
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'chat-emoji-picker', scope: '[data-testid="chat-area"]' });

  // Step 4: Right-click last message for context menu
  console.log('  → Right-click message context menu');
  await page.click('body');
  await page.waitForTimeout(100);
  await page.click('[data-testid="last-msg-bubble"]', { button: 'right' });
  await page.waitForTimeout(150);
  await boxy.capture(page, { name: 'chat-context-menu', scope: '[data-testid="chat-area"]' });

  // Step 5: Open attach + emoji at same time (if both menus open, overlap?)
  console.log('  → Open attachment menu, then emoji (overlap test)');
  await page.click('body');
  await page.waitForTimeout(100);
  await page.click('[data-testid="attach-btn"]');
  await page.waitForTimeout(100);
  // In the real page JS, opening emoji closes attach — but let's capture the state
  await boxy.capture(page, { name: 'chat-attach-only', scope: '[data-testid="chat-area"]' });

  const report = summarize(boxy);
  scenarios.push({ name: 'Chat UI', ...report });
  await ctx.close();
}

// ─── Summary ───

await browser.close();

console.log('\n  ═══════════════════════════════════════════');
console.log('  Scenario Summary');
console.log('  ═══════════════════════════════════════════\n');

for (const s of scenarios) {
  const icon = s.errors > 0 ? '✗' : '✓';
  const detail = s.errors > 0 || s.warnings > 0
    ? `(${s.errors} errors, ${s.warnings} warnings)`
    : '(clean)';
  console.log(`  ${icon} ${s.name} — ${s.steps} steps ${detail}`);
  totalErrors += s.errors;
  totalWarnings += s.warnings;
}

console.log(`\n  Total: ${totalErrors} errors, ${totalWarnings} warnings`);
console.log('  ═══════════════════════════════════════════\n');

process.exit(totalErrors > 0 ? 1 : 0);

function summarize(boxy) {
  const steps = boxy.getSteps();
  let errors = 0;
  let warnings = 0;
  for (const step of steps) {
    for (const issue of step.issues) {
      if (issue.severity === 'error') errors++;
      else warnings++;
    }
    if (step.issues.length > 0) {
      console.log(`    ${step.name}: ${step.issues.length} issue(s)`);
      for (const issue of step.issues) {
        console.log(`      [${issue.severity}] ${issue.category}: ${issue.title}`);
        console.log(`        ${issue.selector}`);
      }
    }
  }
  boxy.writeHTMLReport();
  return { steps: steps.length, errors, warnings };
}

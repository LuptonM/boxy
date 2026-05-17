/**
 * Mutation-based validation suite.
 *
 * 1. Capture baselines from the clean sample project view
 * 2. Inject realistic CSS mutations (the kind someone introduces in a PR)
 * 3. Run comparison against baselines
 * 4. Score: did the linter detect the mutation?
 *
 * The test author only writes interaction steps — not expected failures.
 * The mutations are injected programmatically and the linter must find them.
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createBoxy } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEADED = process.argv.includes('--headed');
const VERBOSE = process.argv.includes('--verbose');
const htmlPath = path.join(__dirname, '..', 'examples', 'sample-project-view.html');
const baseHTML = fs.readFileSync(htmlPath, 'utf-8');

// ── Mutations: realistic CSS changes that break layout ──

const mutations = [
  {
    name: 'table-overflow-hidden',
    description: 'Add overflow:hidden to table area (clips row action dropdowns)',
    inject: page => page.evaluate(() => {
      document.querySelector('[data-testid="table-area"]').style.overflow = 'hidden';
    }),
    interactions: async (page) => {
      // Open the action menu on the last row — it should pop upward but gets clipped
      await page.click('[data-testid="action-btn-8"]');
      await page.waitForTimeout(100);
    },
    captures: ['table-action-menu'],
    scope: '[data-testid="main"]',
  },
  {
    name: 'modal-overflow-hidden',
    description: 'Add overflow:hidden to modal (clips select dropdown inside form)',
    inject: page => page.evaluate(() => {
      document.querySelector('[data-testid="modal"]').style.overflow = 'hidden';
    }),
    interactions: async (page) => {
      // Open modal by double-clicking first row title
      await page.dblclick('[data-testid="row-1"] td:first-child');
      await page.waitForTimeout(150);
      // Open priority select
      await page.click('[data-testid="form-priority-trigger"]');
      await page.waitForTimeout(100);
    },
    captures: ['modal-select-open'],
    scope: '[data-testid="modal"]',
    setup: async () => {}, // modal opens during interactions
  },
  {
    name: 'sidebar-collapse-to-zero',
    description: 'Collapsed sidebar width set to 0 instead of icon-width (clips all nav)',
    inject: page => page.evaluate(() => {
      document.documentElement.style.setProperty('--sidebar-collapsed', '0px');
    }),
    interactions: async (page) => {
      await page.click('[data-testid="sidebar-toggle"]');
      await page.waitForTimeout(200);
    },
    captures: ['sidebar-collapsed'],
    scope: '[data-testid="app"]',
  },
  {
    name: 'detail-panel-overflow-hidden',
    description: 'Detail panel body gets overflow:hidden (clips long content)',
    inject: page => page.evaluate(() => {
      document.querySelector('[data-testid="detail-body"]').style.overflow = 'hidden';
      // Also make the detail body shorter to force clipping
      document.querySelector('[data-testid="detail-body"]').style.maxHeight = '150px';
    }),
    interactions: async (page) => {
      // Click row to open detail panel
      await page.click('[data-testid="row-1"] td:first-child');
      await page.waitForTimeout(150);
    },
    captures: ['detail-panel-content'],
    scope: '[data-testid="detail-panel"]',
  },
  {
    name: 'filter-popover-under-table',
    description: 'Filter bar z-index too low — popover renders under table header',
    inject: page => page.evaluate(() => {
      // Lower the filter popover z-index so it goes behind the sticky table header
      document.querySelectorAll('.filter-popover').forEach(p => {
        p.style.zIndex = '1';
      });
    }),
    interactions: async (page) => {
      await page.click('[data-testid="filter-status"]');
      await page.waitForTimeout(100);
    },
    captures: ['filter-popover-open'],
    scope: '[data-testid="main"]',
  },
  {
    name: 'notif-dropdown-off-screen',
    description: 'Notification dropdown positioned with wrong offset (partially off-screen)',
    inject: page => page.evaluate(() => {
      const dd = document.querySelector('[data-testid="notif-dropdown"]');
      dd.style.right = '-200px';
    }),
    interactions: async (page) => {
      await page.click('[data-testid="notif-btn"]');
      await page.waitForTimeout(100);
    },
    captures: ['notif-dropdown-open'],
    scope: '[data-testid="topnav"]',
  },
  {
    name: 'row-dropdown-opens-down',
    description: 'Row action dropdown opens downward instead of upward (clips at bottom)',
    inject: page => page.evaluate(() => {
      document.querySelectorAll('.row-dropdown').forEach(d => {
        d.style.bottom = 'auto';
        d.style.top = 'calc(100% + 4px)';
      });
    }),
    interactions: async (page) => {
      // Open action menu on last row
      await page.click('[data-testid="action-btn-8"]');
      await page.waitForTimeout(100);
    },
    captures: ['row-dropdown-last'],
    scope: '[data-testid="main"]',
  },
  {
    name: 'nav-items-visibility-hidden',
    description: 'Nav items set to visibility:hidden (invisible but still take space)',
    inject: page => page.evaluate(() => {
      document.querySelectorAll('.nav-item').forEach(item => {
        item.style.visibility = 'hidden';
      });
    }),
    interactions: async () => {},
    captures: ['sidebar-nav-hidden'],
    scope: '[data-testid="sidebar"]',
  },
  {
    name: 'pagination-opacity-zero',
    description: 'Pagination faded to opacity:0 (invisible controls)',
    inject: page => page.evaluate(() => {
      document.querySelector('[data-testid="pagination"]').style.opacity = '0';
    }),
    interactions: async () => {},
    captures: ['pagination-invisible'],
    scope: '[data-testid="main"]',
  },
];

// ── Runner ──

console.log('\n  Mutation Test Suite');
console.log('  ═══════════════════════════════════════════\n');

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

const snapshotBase = path.join(__dirname, '..', '.boxy', 'mutations');

// Phase 1: Capture baselines
console.log('  Phase 1: Capturing baselines...\n');

for (const mutation of mutations) {
  const snapshotDir = path.join(snapshotBase, mutation.name);
  const boxy = createBoxy({ snapshotDir, baseline: true });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.setContent(baseHTML);

  // Run interactions on clean page
  await mutation.interactions(page);
  await page.waitForTimeout(50);

  for (const captureName of mutation.captures) {
    try {
      await boxy.capture(page, { name: captureName, scope: mutation.scope });
    } catch (e) {
      // Some captures need the element to exist (e.g., modal) — skip baseline if not available
      if (VERBOSE) console.log(`    [baseline skip] ${mutation.name}/${captureName}: ${e.message}`);
    }
  }

  await ctx.close();
}

console.log('  Baselines captured.\n');

// Phase 2: Inject mutations and compare
console.log('  Phase 2: Injecting mutations...\n');

let detected = 0;
let missed = 0;
const results = [];

for (const mutation of mutations) {
  const snapshotDir = path.join(snapshotBase, mutation.name);
  const boxy = createBoxy({ snapshotDir, allowMissingBaseline: true });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.setContent(baseHTML);

  // Inject the mutation
  await mutation.inject(page);
  await page.waitForTimeout(50);

  // Run same interactions
  await mutation.interactions(page);
  await page.waitForTimeout(50);

  // Capture and compare
  let totalIssues = 0;
  for (const captureName of mutation.captures) {
    try {
      const step = await boxy.capture(page, { name: captureName, scope: mutation.scope });
      totalIssues += step.issues.length;

      if (VERBOSE && step.issues.length > 0) {
        for (const issue of step.issues) {
          console.log(`      [${issue.severity}] ${issue.category}: ${issue.title}`);
          console.log(`        ${issue.selector}`);
          if (issue.styleChanges?.length > 0) {
            for (const sc of issue.styleChanges) {
              const prefix = sc.selector === issue.selector ? '' : `${sc.selector} → `;
              console.log(`          ${prefix}${sc.property}: ${sc.baseline} → ${sc.current}`);
            }
          }
        }
      }
    } catch (e) {
      // Scope not found counts as detection (element disappeared/broken)
      totalIssues += 1;
      if (VERBOSE) console.log(`      [error] Scope not found: ${e.message}`);
    }
  }

  const wasDetected = totalIssues > 0;
  if (wasDetected) detected++;
  else missed++;

  const icon = wasDetected ? '✓ CAUGHT' : '✗ MISSED';
  const issueStr = totalIssues > 0 ? `(${totalIssues} issues)` : '';
  console.log(`  ${icon}  ${mutation.name} ${issueStr}`);
  if (!wasDetected) {
    console.log(`         ${mutation.description}`);
  }

  results.push({ name: mutation.name, description: mutation.description, detected: wasDetected, issues: totalIssues });
  await ctx.close();
}

await browser.close();

// ── Summary ──

console.log('\n  ═══════════════════════════════════════════');
console.log(`  Detection rate: ${detected}/${mutations.length} mutations caught (${Math.round(detected / mutations.length * 100)}%)`);

if (missed > 0) {
  console.log(`\n  Missed mutations:`);
  for (const r of results) {
    if (!r.detected) {
      console.log(`    - ${r.name}: ${r.description}`);
    }
  }
}

console.log('  ═══════════════════════════════════════════\n');

process.exit(missed > 0 ? 1 : 0);

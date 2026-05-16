# Boxy

Spatial layout linter for Playwright. Catches CSS cascade side-effects — clipped dropdowns, broken overflow, invisible elements, shifted layouts — before they ship.

**Not pixel diffing.** Builds a spatial model of your rendered page and detects broken layout patterns. When something breaks, it tells you *which CSS property changed on which element* caused it — verified by re-rendering with each change in isolation.

## The Problem

The worst UI bugs are the ones where:
- Someone adds `overflow: hidden` to a container and now dropdowns are clipped
- A modal gets `overflow: hidden` and select menus inside it are cut off
- A sidebar collapses to 0px and all nav items disappear
- An element gets `visibility: hidden` or `opacity: 0` and nobody notices
- A z-index change buries a popover behind another element

These bugs are invisible to pixel diffing because they only appear after specific interactions (open menu, scroll, open another menu), depend on content length or viewport size, and the baseline screenshot was taken in a different state.

## Install

```bash
npm install -D boxy-layout
```

## Quick Start

Add `capture()` calls to your existing Playwright tests after interactions:

```js
import { createBoxy } from 'boxy-layout';

const boxy = createBoxy();

test('users page', async ({ page }) => {
  await page.goto('/users');
  await boxy.capture(page, { name: 'users-loaded' });

  // Open a dropdown — does it get clipped?
  await page.click('[data-testid="filter-status"]');
  await boxy.capture(page, { name: 'filter-open' });

  // Open action menu on last row — does it overflow the table?
  await page.click('[data-testid="action-btn"]');
  await boxy.capture(page, {
    name: 'action-menu',
    scope: '[data-testid="users-table"]',
  });
});

afterAll(() => {
  const exitCode = boxy.report();
  boxy.writeHTMLReport();
  if (exitCode) process.exit(exitCode);
});
```

## Two Modes

### Linter Mode (no baseline needed)

Works on first run, zero setup. Analyses the current page and detects:

| Check | What it catches |
|-------|----------------|
| **Clipping** | Element extends beyond parent with `overflow: hidden/auto/scroll` |
| **Overlap** | Positioned elements overlapping where high z-index is clipped |
| **Collapsed** | Element has near-zero width/height but contains content |
| **Off-screen** | Positioned element outside viewport bounds |

### Regression Mode (with baseline)

Compare current branch against baselines. Detect unintended side-effects of CSS changes.

```bash
# On main branch — save baselines
LAYOUT_BASELINE=true npx playwright test

# On feature branch — compare against baselines
npx playwright test
```

Detects:

| Check | What it catches |
|-------|----------------|
| **Spacing** | Gap between siblings changed beyond threshold |
| **Position** | Element shifted significantly from baseline |
| **Size** | Element width/height changed >30% |
| **Visibility** | Element disappeared, became `visibility:hidden`, or `opacity:0` |
| **CSS diff** | Shows which computed styles changed on which elements |

## Verified Causation Analysis

When a regression is detected, Boxy can prove exactly which CSS property caused it by re-rendering with each change applied in isolation:

```js
// After capturing a regression
const step = await boxy.capture(page, { name: 'detail', scope: '[data-testid="panel"]' });

// Revert the page to baseline state, then run causation analysis
const result = await boxy.diagnoseCauses(page, 'detail');
```

```
┌─────────────────────────────────────────────────────────┐
│              Causation Analysis                         │
└─────────────────────────────────────────────────────────┘
  8 re-renders performed

  ┌ ROOT CAUSES (1 verified)
  │ [data-testid="detail-body"]
  │   maxHeight: none → 150px
  │     → shifted 39 elements, resized 2 elements
  └

  ┌ NO IMPACT (6 verified)
  │ [data-testid="detail-header"]
  │   zIndex: auto → 99
  │ [data-testid="detail-close"]
  │   maxWidth: none → 9999px
  │ [data-testid="detail-body"]
  │   overflow: auto → hidden
  │ [data-testid="detail-body"]
  │   overflowX: auto → hidden
  │ [data-testid="detail-body"]
  │   overflowY: auto → hidden
  └
```

7 CSS properties changed. Only 1 actually broke the layout. Boxy proves it.

## Configuration

```js
const boxy = createBoxy({
  snapshotDir: '.layout-snapshots',    // where to store baselines
  allowMissingBaseline: false,         // fail when baseline is missing (set true for first run)
  config: {
    spacingThreshold: 4,     // px — spacing changes below this are ignored
    positionThreshold: 20,   // px — position shifts below this are ignored
    sizeChangePercent: 30,   // % — size changes below this are ignored
    collapsedMinSize: 5,     // px — elements smaller than this are flagged
    ignore: [                // selectors to skip
      '.scrollable-list',
      '[data-testid="carousel"]',
    ],
  },
});
```

## Output

### Terminal
```
┌─────────────────────────────────────────────────────────┐
│              Layout Lint Results                        │
└─────────────────────────────────────────────────────────┘

  ✓ users-loaded
  ✓ filter-open
  ✗ action-menu (4 errors, 0 warnings)

    ┌ CLIPPING
    │ ✗ Element clipped by parent overflow
    │   [data-testid="action-menu"]
    │     clipped by: [data-testid="users-table"]
    │     hidden: bottom: 94px
    └

    ┌ CSS CHANGES (caused layout impact)
    │ [data-testid="users-table"]
    │   overflow: visible → hidden
    └
```

### HTML Report

Generated at `.layout-snapshots/report.html` with screenshots and issue details.

### CI

Exit code 1 when errors are found:

```yaml
- run: npx playwright test
```

## Testing

```bash
# Smoke test (good version should pass clean)
npm test

# Broken version should catch clipping errors
npm run test:broken

# Interaction-driven scenario tests
npm run test:scenarios
npm run test:scenarios:broken

# Mutation suite: inject 9 realistic CSS bugs, verify all are caught
npm run test:mutations
```

Current mutation detection rate: **9/9 (100%)**

| Mutation | What it simulates |
|---|---|
| `table-overflow-hidden` | `overflow:hidden` added to scrollable table container |
| `modal-overflow-hidden` | Modal clips select dropdowns inside forms |
| `sidebar-collapse-to-zero` | Collapsed sidebar width set to 0 instead of icon-width |
| `detail-panel-overflow-hidden` | Detail panel body loses scroll, clips long content |
| `filter-popover-under-table` | Filter popover z-index lowered, goes behind sticky header |
| `notif-dropdown-off-screen` | Notification dropdown positioned with wrong offset |
| `row-dropdown-opens-down` | Action menu opens downward instead of upward on last rows |
| `nav-items-visibility-hidden` | Nav items set to `visibility:hidden` |
| `pagination-opacity-zero` | Pagination faded to `opacity:0` |

## How It Works

1. **Captures** the bounding box, computed styles, z-index, overflow, visibility, opacity, and sibling spacing for every visible element
2. **Lints** the spatial model for broken patterns (clipping, overlap, collapse)
3. **Compares** against baseline (if available) for regressions (spacing, position, size, visibility)
4. **Diffs computed CSS** between baseline and current, classifying changes as effective (caused spatial impact) or inert (no layout difference)
5. **Verifies causation** (optional) to identify which specific CSS property caused the breakage

## Why Not Percy / Chromatic?

| | Pixel diffing | Boxy |
|---|---|---|
| False positives | High (anti-aliasing, fonts, rendering) | Low (spatial analysis) |
| Explains the bug | "These pixels changed" | "Dropdown clipped because `overflow: auto → hidden`" |
| Identifies root cause | No | Yes — pinpoints the CSS property that caused it |
| Needs cloud infra | Yes | No (runs locally) |
| Needs baseline | Always | Only for regression checks |
| Post-interaction testing | Only if you screenshot every state | Captures spatial model after any interaction |

## License

MIT

import type { Page } from 'playwright';
import type { SpatialModel, StyleChange, CausationResult } from './types.js';
import { captureScope } from './capture.lib.js';

/**
 * Verify causation by reverting individual CSS changes.
 *
 * For each unique style change, temporarily reverts that change from the
 * current page back toward the baseline value and recaptures the spatial model.
 * If the revert reduces the current-vs-baseline spatial diff, that change is
 * a verified contributor.
 *
 * Groups changes by element first. If reverting the group helps, test each
 * property to find which ones improve the current-vs-baseline diff.
 */
export async function analyzeCausation(
  page: Page,
  scope: string,
  baselineModel: SpatialModel,
  styleChanges: StyleChange[],
): Promise<CausationResult> {
  const causes: StyleChange[] = [];
  const noImpact: StyleChange[] = [];
  let renders = 0;

  // Properties that are layout outputs (computed from content/flex/grid), not inputs.
  // Applying a computed height back as an inline style forces a fixed size, which is wrong.
  const OUTPUT_PROPS = new Set(['width', 'height']);

  // Dedupe style changes by selector+property, skip output-only properties
  const seen = new Set<string>();
  const unique: StyleChange[] = [];
  for (const sc of styleChanges) {
    if (OUTPUT_PROPS.has(sc.property)) continue;
    const key = `${sc.selector}::${sc.property}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sc);
  }

  // Group by selector for batch testing
  const bySelector = new Map<string, StyleChange[]>();
  for (const sc of unique) {
    if (!bySelector.has(sc.selector)) bySelector.set(sc.selector, []);
    bySelector.get(sc.selector)!.push(sc);
  }

  const currentModel = await captureModel(page, scope);
  const currentDiffs = countSpatialDiffs(baselineModel, currentModel);

  for (const [selector, changes] of bySelector) {
    // Phase 1: Test all changes on this element together by reverting them.
    const groupModel = await renderWithRevertedChanges(page, scope, selector, changes);
    renders++;

    if (!groupModel) {
      // Selector/scope could not be resolved — leave the changes unverified.
      for (const sc of changes) {
        sc.verified = undefined;
      }
      continue;
    }

    const groupDiffs = countSpatialDiffs(baselineModel, groupModel);
    const groupImprovement = diffImprovement(currentDiffs, groupDiffs);

    if (groupImprovement.total <= 0) {
      // Reverting all changes on this element does not improve the page.
      for (const sc of changes) {
        sc.verified = false;
        noImpact.push(sc);
      }
      continue;
    }

    if (changes.length === 1) {
      // Single property — it's the verified cause
      const sc = changes[0];
      sc.verified = true;
      sc.impactSummary = formatImpact(groupImprovement);
      causes.push(sc);
      continue;
    }

    // Phase 2: Multiple properties changed on same element — revert individually.
    for (const sc of changes) {
      const singleModel = await renderWithRevertedChanges(page, scope, selector, [sc]);
      renders++;

      if (!singleModel) {
        sc.verified = undefined;
        continue;
      }

      const singleDiffs = countSpatialDiffs(baselineModel, singleModel);
      const singleImprovement = diffImprovement(currentDiffs, singleDiffs);

      if (singleImprovement.total > 0) {
        sc.verified = true;
        sc.impactSummary = formatImpact(singleImprovement);
        causes.push(sc);
      } else {
        sc.verified = false;
        noImpact.push(sc);
      }
    }
  }

  return { causes, noImpact, renders };
}

/**
 * Revert specific CSS changes on an element and recapture the spatial model.
 * Returns null if the scope element is not found.
 */
async function renderWithRevertedChanges(
  page: Page,
  scope: string,
  selector: string,
  changes: StyleChange[],
): Promise<SpatialModel | null> {
  const overrides = changes.map(sc => ({
    property: sc.property.replace(/[A-Z]/g, c => '-' + c.toLowerCase()),
    value: sc.baseline === '(unset)' ? '' : sc.baseline,
  }));

  const originals = await page.evaluate(({ selector, overrides }) => {
    const el = resolveElement(selector) as HTMLElement | null;
    if (!el) return null;

    const originals: { property: string; value: string }[] = [];
    for (const { property, value } of overrides) {
      originals.push({ property, value: el.style.getPropertyValue(property) });
      if (value) el.style.setProperty(property, value);
      else el.style.removeProperty(property);
    }

    return originals;

    function resolveElement(rawSelector: string): Element | null {
      const occurrenceMatch = rawSelector.match(/^(.*)\[(\d+)\]$/);
      if (!occurrenceMatch) return document.querySelector(rawSelector);

      const baseSelector = occurrenceMatch[1];
      const index = Number(occurrenceMatch[2]) - 1;
      if (!baseSelector || index < 0) return null;
      return document.querySelectorAll(baseSelector)[index] ?? null;
    }
  }, { selector, overrides });

  if (!originals) return null;

  try {
    return await captureModel(page, scope);
  } finally {
    await page.evaluate(({ selector, originals }) => {
      const el = resolveElement(selector) as HTMLElement | null;
      if (!el) return;

      for (const { property, value } of originals) {
        if (value) el.style.setProperty(property, value);
        else el.style.removeProperty(property);
      }

      function resolveElement(rawSelector: string): Element | null {
        const occurrenceMatch = rawSelector.match(/^(.*)\[(\d+)\]$/);
        if (!occurrenceMatch) return document.querySelector(rawSelector);

        const baseSelector = occurrenceMatch[1];
        const index = Number(occurrenceMatch[2]) - 1;
        if (!baseSelector || index < 0) return null;
        return document.querySelectorAll(baseSelector)[index] ?? null;
      }
    }, { selector, originals });
  }
}

async function captureModel(page: Page, scope: string): Promise<SpatialModel> {
  return page.evaluate(captureScope, scope) as Promise<SpatialModel>;
}

interface SpatialDiffCounts {
  clipped: number;
  shifted: number;
  resized: number;
  missing: number;
  total: number;
}

/**
 * Count spatial differences between baseline and a test render.
 */
function countSpatialDiffs(baseline: SpatialModel, test: SpatialModel): SpatialDiffCounts {
  const baseMap = new Map(baseline.elements.map(el => [el.selector, el]));
  const testMap = new Map(test.elements.map((el: any) => [el.selector, el]));
  const counts: SpatialDiffCounts = { clipped: 0, shifted: 0, resized: 0, missing: 0, total: 0 };

  for (const [sel, baseEl] of baseMap) {
    const testEl = testMap.get(sel) as any;
    if (!testEl) {
      counts.missing++;
      counts.total++;
      continue;
    }

    // Clip changed
    if (!baseEl.clip.isClipped && testEl.clip?.isClipped) { counts.clipped++; counts.total++; }

    // Position shifted (>1px threshold for rounding)
    if (baseEl.box && testEl.box) {
      if (Math.abs(baseEl.box.x - testEl.box.x) > 1 || Math.abs(baseEl.box.y - testEl.box.y) > 1) {
        counts.shifted++;
        counts.total++;
      }

      // Size changed
      if (Math.abs(baseEl.box.width - testEl.box.width) > 1 || Math.abs(baseEl.box.height - testEl.box.height) > 1) {
        counts.resized++;
        counts.total++;
      }
    }
  }

  return counts;
}

function diffImprovement(before: SpatialDiffCounts, after: SpatialDiffCounts): SpatialDiffCounts {
  return {
    clipped: Math.max(0, before.clipped - after.clipped),
    shifted: Math.max(0, before.shifted - after.shifted),
    resized: Math.max(0, before.resized - after.resized),
    missing: Math.max(0, before.missing - after.missing),
    total: Math.max(0, before.total - after.total),
  };
}

function formatImpact(diffs: SpatialDiffCounts): string {
  const parts: string[] = [];
  if (diffs.clipped > 0) parts.push(`clipped ${diffs.clipped} elements`);
  if (diffs.shifted > 0) parts.push(`shifted ${diffs.shifted} elements`);
  if (diffs.resized > 0) parts.push(`resized ${diffs.resized} elements`);
  if (diffs.missing > 0) parts.push(`restored ${diffs.missing} elements`);
  return parts.join(', ');
}

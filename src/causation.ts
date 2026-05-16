import type { Page } from 'playwright';
import type { SpatialModel, StyleChange, CausationResult, ElementModel } from './types.js';
import { capture } from './capture.js';

/**
 * Verify causation by re-rendering with individual CSS changes applied.
 *
 * For each unique style change, applies ONLY that change to the baseline page
 * and recaptures the spatial model. If the model differs from baseline,
 * that change is a verified root cause.
 *
 * Groups changes by element first — if all changes on an element are inert together,
 * skip individual testing. If the group is causal, bisect to find which properties matter.
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

  const baselineMap = new Map(baselineModel.elements.map(el => [el.selector, el]));

  for (const [selector, changes] of bySelector) {
    // Phase 1: Test all changes on this element together
    const groupModel = await renderWithChanges(page, scope, selector, changes);
    renders++;

    if (!groupModel) {
      // Scope disappeared — all changes on this element are causal
      for (const sc of changes) {
        sc.verified = true;
        sc.impactSummary = 'scope element disappeared';
        causes.push(sc);
      }
      continue;
    }

    const groupDiffs = countSpatialDiffs(baselineModel, groupModel);

    if (groupDiffs.total === 0) {
      // All changes on this element together have no impact — skip individual testing
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
      sc.impactSummary = formatImpact(groupDiffs);
      causes.push(sc);
      continue;
    }

    // Phase 2: Multiple properties changed on same element — test individually
    for (const sc of changes) {
      const singleModel = await renderWithChanges(page, scope, selector, [sc]);
      renders++;

      if (!singleModel) {
        sc.verified = true;
        sc.impactSummary = 'scope element disappeared';
        causes.push(sc);
        continue;
      }

      const singleDiffs = countSpatialDiffs(baselineModel, singleModel);

      if (singleDiffs.total > 0) {
        sc.verified = true;
        sc.impactSummary = formatImpact(singleDiffs);
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
 * Apply specific CSS changes to an element and recapture the spatial model.
 * Returns null if the scope element is not found.
 */
async function renderWithChanges(
  page: Page,
  scope: string,
  selector: string,
  changes: StyleChange[],
): Promise<SpatialModel | null> {
  // Build the CSS override script
  const overrides = changes.map(sc => ({
    property: sc.property.replace(/[A-Z]/g, c => '-' + c.toLowerCase()),
    value: sc.current,
  }));

  // Apply overrides, capture, then revert
  const model = await page.evaluate(({ scope, selector, overrides }) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return null;

    // Save original values
    const originals: { property: string; value: string }[] = [];
    for (const { property, value } of overrides) {
      originals.push({ property, value: el.style.getPropertyValue(property) });
      el.style.setProperty(property, value);
    }

    // Capture spatial model (inline — we can't import capture.ts here)
    const root = document.querySelector(scope);
    if (!root) {
      // Revert
      for (const { property, value } of originals) {
        if (value) el.style.setProperty(property, value);
        else el.style.removeProperty(property);
      }
      return null;
    }

    // Force a layout recalc
    void root.getBoundingClientRect();

    const elements: any[] = [];
    const allEls = [root, ...Array.from(root.querySelectorAll('*'))];

    for (const node of allEls) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const computed = window.getComputedStyle(node);
      if (computed.display === 'none') continue;

      // Minimal model — just what we need for spatial comparison
      const zIndex = computed.zIndex === 'auto' ? 0 : parseInt(computed.zIndex);
      const clip = detectClipSimple(node);
      const visibility = computed.visibility;
      const opacity = computed.opacity;

      elements.push({
        selector: buildSelectorSimple(node, root),
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        zIndex,
        visibility,
        opacity,
        clip,
        overflow: computed.overflow,
      });
    }

    // Deduplicate selectors (must match main capture logic)
    const selectorCount = new Map<string, number>();
    for (const e of elements) {
      selectorCount.set(e.selector, (selectorCount.get(e.selector) || 0) + 1);
    }
    const selectorIndex = new Map<string, number>();
    for (const e of elements) {
      if (selectorCount.get(e.selector)! > 1) {
        const idx = (selectorIndex.get(e.selector) || 0) + 1;
        selectorIndex.set(e.selector, idx);
        e.selector = `${e.selector}[${idx}]`;
      }
    }

    // Revert
    for (const { property, value } of originals) {
      if (value) el.style.setProperty(property, value);
      else el.style.removeProperty(property);
    }

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: window.location.href,
      timestamp: Date.now(),
      elements,
    };

    function buildSelectorSimple(el: Element, root: Element): string {
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.documentElement) {
        let part = current.tagName.toLowerCase();
        const testId = current.getAttribute('data-testid');
        if (testId) { parts.unshift(`[data-testid="${testId}"]`); break; }
        if (current.id) { parts.unshift(`#${current.id}`); break; }
        if (current.className && typeof current.className === 'string' && current.className.trim()) {
          part += '.' + current.className.trim().split(/\s+/).slice(0, 2).join('.');
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            part += `:nth-of-type(${index})`;
          }
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    }

    function detectClipSimple(el: Element): { isClipped: boolean } {
      const rect = el.getBoundingClientRect();
      let parent = el.parentElement;
      while (parent) {
        const ps = window.getComputedStyle(parent);
        const hasClip = ps.overflow === 'hidden' || ps.overflow === 'auto' || ps.overflow === 'scroll'
          || ps.overflowX === 'hidden' || ps.overflowY === 'hidden';
        if (hasClip) {
          const pr = parent.getBoundingClientRect();
          if (rect.top < pr.top || rect.bottom > pr.bottom || rect.left < pr.left || rect.right > pr.right) {
            return { isClipped: true };
          }
        }
        parent = parent.parentElement;
      }
      return { isClipped: false };
    }
  }, { scope, selector, overrides });

  return model as SpatialModel | null;
}

interface SpatialDiffCounts {
  clipped: number;
  shifted: number;
  resized: number;
  total: number;
}

/**
 * Count spatial differences between baseline and a test render.
 */
function countSpatialDiffs(baseline: SpatialModel, test: SpatialModel): SpatialDiffCounts {
  const baseMap = new Map(baseline.elements.map(el => [el.selector, el]));
  const testMap = new Map(test.elements.map((el: any) => [el.selector, el]));
  const counts: SpatialDiffCounts = { clipped: 0, shifted: 0, resized: 0, total: 0 };

  // Only compare elements that exist in both — selector mismatches from deduplication
  // ordering differences should not count as diffs
  for (const [sel, baseEl] of baseMap) {
    const testEl = testMap.get(sel) as any;
    if (!testEl) continue; // Skip disappeared — could be dedup ordering difference

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

function formatImpact(diffs: SpatialDiffCounts): string {
  const parts: string[] = [];
  if (diffs.clipped > 0) parts.push(`clipped ${diffs.clipped} elements`);
  if (diffs.shifted > 0) parts.push(`shifted ${diffs.shifted} elements`);
  if (diffs.resized > 0) parts.push(`resized ${diffs.resized} elements`);
  return parts.join(', ');
}

import type { SpatialModel, ElementModel, Issue, LinterConfig, BoundingBox } from './types.js';

export function isIgnored(selector: string, ignoreList: string[]): boolean {
  return ignoreList.some(pattern => selector.includes(pattern));
}

/**
 * Detect if an element is intentionally hidden from ALL users (both visually
 * and from assistive technology). Only suppress layout checks when the element
 * is truly invisible — not when it's merely decorative (aria-hidden but visible).
 *
 * aria-hidden="true" alone is NOT sufficient — it only hides from AT, not visually.
 * Decorative icons with aria-hidden are still rendered and can still be clipped.
 */
export function isIntentionallyHidden(el: ElementModel): boolean {
  // Visually invisible (hidden or transparent) — regardless of aria state
  if (el.visibility === 'hidden' || el.opacity === '0') return true;

  // No visible content — nothing to see
  if (!el.hasVisibleContent) return true;

  // sr-only / visually-hidden pattern:
  // position:absolute, dimensions ≤ 1px, positioned off-screen via negative coords
  // OR clipped at any position using common Bootstrap/Tailwind patterns.
  // These ARE visible to screen readers (no aria-hidden) but invisible to sighted users.
  const clip = el.styles.clip;
  const clipPath = el.styles.clipPath;
  const hasSrOnlyClip = el.overflow === 'hidden' &&
    ((clip && clip !== 'auto') || (clipPath && clipPath !== 'none'));
  if (el.position === 'absolute' &&
      el.box.width <= 1 && el.box.height <= 1 &&
      ((el.box.x < -9000 || el.box.y < -9000) || hasSrOnlyClip)) {
    return true;
  }

  // aria-hidden="true" AND not visually rendered (zero-area or off-screen with no content)
  // This catches elements hidden from BOTH AT and visually
  if (el.ariaHidden && el.box.width === 0 && el.box.height === 0) return true;

  return false;
}

export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

export function checkClipping(el: ElementModel): Issue | null {
  if (!el.clip.isClipped || !el.clip.clippedEdges) return null;
  if (isIntentionallyHidden(el)) return null;

  const edges = el.clip.clippedEdges;
  const totalClipped = edges.top + edges.bottom + edges.left + edges.right;
  if (totalClipped === 0) return null;

  // Positioned elements (absolute/fixed) clipped by a parent is almost always
  // a bug — dropdowns, popovers, tooltips should never be clipped.
  // Static/relative elements clipped by overflow:hidden is usually intentional
  // (text truncation with ellipsis, scroll containers, image cropping).
  if (el.position !== 'absolute' && el.position !== 'fixed') return null;

  const edgeStr = Object.entries(edges)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}px`)
    .join(', ');

  return {
    category: 'CLIPPING',
    severity: 'error',
    selector: el.selector,
    title: 'Element clipped by parent overflow',
    detail: `clipped by: ${el.clip.clippedBy}\nhidden: ${edgeStr}`,
  };
}

export function checkCollapsed(el: ElementModel, collapsedMinSize: number): Issue[] {
  if (!el.hasVisibleContent || el.childCount === 0) return [];
  if (isIntentionallyHidden(el)) return [];

  const issues: Issue[] = [];

  if (el.box.width < collapsedMinSize) {
    issues.push({
      category: 'COLLAPSED',
      severity: 'error',
      selector: el.selector,
      title: 'Element width collapsed',
      detail: `width: ${el.box.width}px — likely unusable\nelement has ${el.childCount} children`,
    });
  }

  if (el.box.height < collapsedMinSize) {
    issues.push({
      category: 'COLLAPSED',
      severity: 'error',
      selector: el.selector,
      title: 'Element height collapsed',
      detail: `height: ${el.box.height}px — likely unusable\nelement has ${el.childCount} children`,
    });
  }

  return issues;
}

export function checkOffScreen(el: ElementModel, viewport: { width: number; height: number }): Issue | null {
  const fullyOff = el.box.x + el.box.width < 0
    || el.box.y + el.box.height < 0
    || el.box.x > viewport.width
    || el.box.y > viewport.height;

  if (!fullyOff) return null;
  if (el.position === 'static' || !el.hasVisibleContent) return null;
  if (isIntentionallyHidden(el)) return null;

  return {
    category: 'OFF_SCREEN',
    severity: 'warning',
    selector: el.selector,
    title: 'Element positioned off-screen',
    detail: `position: (${el.box.x}, ${el.box.y})\nviewport: ${viewport.width}×${viewport.height}`,
  };
}

export function checkOverlap(a: ElementModel, b: ElementModel): Issue | null {
  if (!boxesOverlap(a.box, b.box)) return null;

  const higher = a.zIndex > b.zIndex ? a : b;
  const lower = a.zIndex > b.zIndex ? b : a;

  if (!higher.clip.isClipped) return null;

  return {
    category: 'OVERLAP',
    severity: 'error',
    selector: higher.selector,
    title: 'High z-index element is clipped',
    detail: `${higher.selector} (z:${higher.zIndex}) overlaps ${lower.selector} (z:${lower.zIndex})\nbut is clipped by: ${higher.clip.clippedBy}`,
  };
}

export function findOverlapIssues(elements: ElementModel[], ignore: string[]): Issue[] {
  const positioned = elements.filter(el =>
    el.position !== 'static' && el.zIndex > 0 && !isIgnored(el.selector, ignore)
  );

  const issues: Issue[] = [];
  for (let i = 0; i < positioned.length; i++) {
    for (let j = i + 1; j < positioned.length; j++) {
      const issue = checkOverlap(positioned[i], positioned[j]);
      if (issue) issues.push(issue);
    }
  }
  return issues;
}

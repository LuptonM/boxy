import type { SpatialModel, ElementModel, Issue, LinterConfig, BoundingBox } from './types.js';

export function isIgnored(selector: string, ignoreList: string[]): boolean {
  return ignoreList.some(pattern => selector.includes(pattern));
}

export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

export function checkClipping(el: ElementModel): Issue | null {
  if (!el.clip.isClipped || !el.clip.clippedEdges) return null;

  const edges = el.clip.clippedEdges;
  const totalClipped = edges.top + edges.bottom + edges.left + edges.right;
  if (totalClipped === 0) return null;

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

  const issues: Issue[] = [];

  if (el.box.width > 0 && el.box.width < collapsedMinSize) {
    issues.push({
      category: 'COLLAPSED',
      severity: 'error',
      selector: el.selector,
      title: 'Element width collapsed',
      detail: `width: ${el.box.width}px — likely unusable\nelement has ${el.childCount} children`,
    });
  }

  if (el.box.height > 0 && el.box.height < collapsedMinSize) {
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

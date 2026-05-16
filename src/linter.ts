import type { SpatialModel, Issue, LinterConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Analyse a spatial model for layout issues — no baseline needed.
 */
export function lint(model: SpatialModel, config: Partial<LinterConfig> = {}): Issue[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const issues: Issue[] = [];

  for (const el of model.elements) {
    if (isIgnored(el.selector, cfg.ignore)) continue;

    // 1. Clipping
    if (el.clip.isClipped && el.clip.clippedEdges) {
      const edges = el.clip.clippedEdges;
      const totalClipped = edges.top + edges.bottom + edges.left + edges.right;
      if (totalClipped > 0) {
        const edgeStr = Object.entries(edges)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k}: ${v}px`)
          .join(', ');

        issues.push({
          category: 'CLIPPING',
          severity: 'error',
          selector: el.selector,
          title: 'Element clipped by parent overflow',
          detail: `clipped by: ${el.clip.clippedBy}\nhidden: ${edgeStr}`,
        });
      }
    }

    // 2. Collapsed
    if (el.hasVisibleContent && el.childCount > 0) {
      if (el.box.width < cfg.collapsedMinSize && el.box.width > 0) {
        issues.push({
          category: 'COLLAPSED',
          severity: 'error',
          selector: el.selector,
          title: 'Element width collapsed',
          detail: `width: ${el.box.width}px — likely unusable\nelement has ${el.childCount} children`,
        });
      }
      if (el.box.height < cfg.collapsedMinSize && el.box.height > 0) {
        issues.push({
          category: 'COLLAPSED',
          severity: 'error',
          selector: el.selector,
          title: 'Element height collapsed',
          detail: `height: ${el.box.height}px — likely unusable\nelement has ${el.childCount} children`,
        });
      }
    }

    // 3. Off-screen
    const rightEdge = el.box.x + el.box.width;
    const bottomEdge = el.box.y + el.box.height;
    if (el.box.x + el.box.width < 0 || el.box.y + el.box.height < 0 ||
        el.box.x > model.viewport.width || el.box.y > model.viewport.height) {
      // Fully off-screen — only flag if it seems unintentional (positioned, has content)
      if (el.position !== 'static' && el.hasVisibleContent) {
        issues.push({
          category: 'OFF_SCREEN',
          severity: 'warning',
          selector: el.selector,
          title: 'Element positioned off-screen',
          detail: `position: (${el.box.x}, ${el.box.y})\nviewport: ${model.viewport.width}×${model.viewport.height}`,
        });
      }
    }
  }

  // 4. Overlap detection — positioned elements with z-index that overlap
  const positioned = model.elements.filter(el =>
    el.position !== 'static' && el.zIndex > 0 && !isIgnored(el.selector, cfg.ignore)
  );

  for (let i = 0; i < positioned.length; i++) {
    for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i];
      const b = positioned[j];

      if (!boxesOverlap(a.box, b.box)) continue;

      // Flag if the higher z-index element is clipped (can't actually appear on top)
      const higher = a.zIndex > b.zIndex ? a : b;
      const lower = a.zIndex > b.zIndex ? b : a;

      if (higher.clip.isClipped) {
        issues.push({
          category: 'OVERLAP',
          severity: 'error',
          selector: higher.selector,
          title: 'High z-index element is clipped',
          detail: `${higher.selector} (z:${higher.zIndex}) overlaps ${lower.selector} (z:${lower.zIndex})\nbut is clipped by: ${higher.clip.clippedBy}`,
        });
      }
    }
  }

  return issues;
}

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

function isIgnored(selector: string, ignoreList: string[]): boolean {
  return ignoreList.some(pattern => selector.includes(pattern));
}

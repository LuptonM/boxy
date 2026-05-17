import type { SpatialModel, Issue, LinterConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import {
  isIgnored,
  checkClipping,
  checkCollapsed,
  checkOffScreen,
  findOverlapIssues,
} from './linter.lib.js';

export function lint(model: SpatialModel, config: Partial<LinterConfig> = {}): Issue[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const filtered = model.elements.filter(el => !isIgnored(el.selector, cfg.ignore));

  const elementIssues = filtered
    .flatMap(el => [
      checkClipping(el),
      ...checkCollapsed(el, cfg.collapsedMinSize),
      checkOffScreen(el, model.viewport),
    ])
    .filter((issue): issue is Issue => issue !== null);

  // Deduplicate clipping: if a parent is clipped, don't also flag children
  // clipped by the same ancestor (they're clipped because their parent is)
  const clippedSelectors = new Set(
    elementIssues
      .filter(i => i.category === 'CLIPPING')
      .map(i => i.selector)
  );

  const deduped = elementIssues.filter(issue => {
    if (issue.category !== 'CLIPPING') return true;
    // Check if any ancestor of this element is already flagged as clipped
    const el = model.elements.find(e => e.selector === issue.selector);
    if (!el) return true;
    let parent = el.parentSelector;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (clippedSelectors.has(parent)) return false;
      visited.add(parent);
      const parentEl = model.elements.find(e => e.selector === parent);
      parent = parentEl?.parentSelector ?? null;
    }
    return true;
  });

  const overlapIssues = findOverlapIssues(model.elements, cfg.ignore);

  return [...deduped, ...overlapIssues];
}

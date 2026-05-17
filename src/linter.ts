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

  // Group clipping: if a parent is clipped, nest its clipped children under it
  const clippingIssues = elementIssues.filter(i => i.category === 'CLIPPING');
  const otherIssues = elementIssues.filter(i => i.category !== 'CLIPPING');
  const clippedSelectors = new Set(clippingIssues.map(i => i.selector));

  const isDescendantOfClipped = (selector: string): string | null => {
    const el = model.elements.find(e => e.selector === selector);
    if (!el) return null;
    let parent = el.parentSelector;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (clippedSelectors.has(parent)) return parent;
      visited.add(parent);
      const parentEl = model.elements.find(e => e.selector === parent);
      parent = parentEl?.parentSelector ?? null;
    }
    return null;
  };

  const rootClipping: Issue[] = [];
  const childMap = new Map<string, string[]>();

  for (const issue of clippingIssues) {
    const ancestor = isDescendantOfClipped(issue.selector);
    if (ancestor) {
      if (!childMap.has(ancestor)) childMap.set(ancestor, []);
      childMap.get(ancestor)!.push(issue.selector);
    } else {
      rootClipping.push(issue);
    }
  }

  for (const issue of rootClipping) {
    const children = childMap.get(issue.selector);
    if (children && children.length > 0) {
      issue.affectedChildren = children;
    }
  }

  const overlapIssues = findOverlapIssues(model.elements, cfg.ignore);

  return [...rootClipping, ...otherIssues, ...overlapIssues];
}

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

  const elementIssues = model.elements
    .filter(el => !isIgnored(el.selector, cfg.ignore))
    .flatMap(el => [
      checkClipping(el),
      ...checkCollapsed(el, cfg.collapsedMinSize),
      checkOffScreen(el, model.viewport),
    ])
    .filter((issue): issue is Issue => issue !== null);

  const overlapIssues = findOverlapIssues(model.elements, cfg.ignore);

  return [...elementIssues, ...overlapIssues];
}

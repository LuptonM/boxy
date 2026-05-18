import type { SpatialModel, Issue, LinterConfig, ElementModel, StyleChange } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Compare current spatial model against baseline — detect regressions.
 */
export function compare(baseline: SpatialModel, current: SpatialModel, config: Partial<LinterConfig> = {}): Issue[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const issues: Issue[] = [];

  const baseMap = new Map(baseline.elements.map(el => [el.selector, el]));
  const currMap = new Map(current.elements.map(el => [el.selector, el]));

  // 1. Visibility — elements that disappeared
  for (const [sel, baseEl] of baseMap) {
    if (isIgnored(sel, cfg.ignore)) continue;
    if (!currMap.has(sel) && baseEl.hasVisibleContent) {
      issues.push({
        category: 'VISIBILITY',
        severity: 'error',
        selector: sel,
        title: 'Element disappeared',
        detail: `was: ${baseEl.box.width}×${baseEl.box.height} at (${baseEl.box.x}, ${baseEl.box.y})\nnow: not found`,
      });
    }
  }

  // Compare matching elements
  for (const [sel, baseEl] of baseMap) {
    const currEl = currMap.get(sel);
    if (!currEl || isIgnored(sel, cfg.ignore)) continue;

    // 2. Visible-to-hidden regression
    const baseVisible = baseEl.visibility !== 'hidden' && baseEl.opacity !== '0';
    const currVisible = currEl.visibility !== 'hidden' && currEl.opacity !== '0';
    if (baseVisible && !currVisible) {
      issues.push({
        category: 'VISIBILITY',
        severity: 'error',
        selector: sel,
        title: 'Element became hidden',
        detail: `visibility: ${baseEl.visibility} → ${currEl.visibility}\nopacity: ${baseEl.opacity} → ${currEl.opacity}`,
      });
    }

    // 3. Spacing regression
    if (baseEl.siblingSpacing.previousGap !== null && currEl.siblingSpacing.previousGap !== null) {
      const delta = Math.abs(currEl.siblingSpacing.previousGap - baseEl.siblingSpacing.previousGap);
      if (delta > cfg.spacingThreshold) {
        issues.push({
          category: 'SPACING',
          severity: delta > cfg.spacingThreshold * 3 ? 'error' : 'warning',
          selector: sel,
          title: 'Sibling spacing changed',
          detail: `gap to previous sibling: ${baseEl.siblingSpacing.previousGap}px → ${currEl.siblingSpacing.previousGap}px (${delta > 0 ? '+' : ''}${currEl.siblingSpacing.previousGap - baseEl.siblingSpacing.previousGap}px)\ndirection: ${currEl.siblingSpacing.direction}`,
        });
      }
    }

    // 3. Position shift
    const dx = Math.abs(currEl.box.x - baseEl.box.x);
    const dy = Math.abs(currEl.box.y - baseEl.box.y);
    if (dx > cfg.positionThreshold || dy > cfg.positionThreshold) {
      issues.push({
        category: 'POSITION',
        severity: 'error',
        selector: sel,
        title: 'Element position shifted',
        detail: `was: (${baseEl.box.x}, ${baseEl.box.y})\nnow: (${currEl.box.x}, ${currEl.box.y})\ndelta: x${dx > 0 ? '+' : ''}${currEl.box.x - baseEl.box.x}px, y${dy > 0 ? '+' : ''}${currEl.box.y - baseEl.box.y}px`,
      });
    }

    // 4. Size change (check each axis independently to avoid division by zero)
    if (baseEl.box.width > 0 || baseEl.box.height > 0) {
      const wChange = baseEl.box.width > 0
        ? Math.abs(currEl.box.width - baseEl.box.width) / baseEl.box.width * 100 : 0;
      const hChange = baseEl.box.height > 0
        ? Math.abs(currEl.box.height - baseEl.box.height) / baseEl.box.height * 100 : 0;

      if (wChange > cfg.sizeChangePercent || hChange > cfg.sizeChangePercent) {
        issues.push({
          category: 'SIZE',
          severity: 'error',
          selector: sel,
          title: 'Element size changed significantly',
          detail: `width: ${baseEl.box.width}px → ${currEl.box.width}px (${wChange.toFixed(0)}% change)\nheight: ${baseEl.box.height}px → ${currEl.box.height}px (${hChange.toFixed(0)}% change)`,
        });
      }
    }
  }

  // 5. Broken scroll — overflow changed from scrollable to non-scrollable while content still overflows
  const brokenScrollIssues = detectBrokenScroll(baseMap, currMap, cfg);
  issues.push(...brokenScrollIssues);

  // 6. Spacing consistency — check groups of siblings
  const spacingIssues = detectSpacingInconsistency(baseline, current, cfg);
  issues.push(...spacingIssues);

  // 6. Attach style diffs — scan the testid container subtree for all CSS changes
  //    Cache per testid so we don't re-diff the same subtree for every child issue
  const changeCache = new Map<string, StyleChange[]>();

  for (const issue of issues) {
    const currEl = currMap.get(issue.selector);
    const baseEl = baseMap.get(issue.selector);
    const clippedBy = currEl?.clip?.clippedBy ?? baseEl?.clip?.clippedBy;

    const cacheKey = (findTestIdAncestor(issue.selector, baseMap, currMap) ?? issue.selector)
      + (clippedBy ? `+${clippedBy}` : '');

    let changes: StyleChange[];
    if (changeCache.has(cacheKey)) {
      changes = changeCache.get(cacheKey)!;
    } else {
      changes = collectStyleChangesUnderTestId(issue.selector, baseMap, currMap, clippedBy);
      changeCache.set(cacheKey, changes);
    }

    if (changes.length > 0) {
      issue.styleChanges = changes;
    }
  }

  return issues;
}

/**
 * Detect containers whose overflow changed from scrollable (auto/scroll) to
 * non-scrollable (hidden/clip) while content still exceeds the visible area.
 * This is a definitive signal: content that WAS reachable via scrolling is now inaccessible.
 */
function detectBrokenScroll(
  baseMap: Map<string, ElementModel>,
  currMap: Map<string, ElementModel>,
  cfg: LinterConfig,
): Issue[] {
  const issues: Issue[] = [];

  for (const [sel, currEl] of currMap) {
    if (isIgnored(sel, cfg.ignore)) continue;
    if (!currEl.scroll || !currEl.scroll.overflowX) continue;

    const baseEl = baseMap.get(sel);
    if (!baseEl?.scroll) continue;

    const { overflowX: baseOX, overflowY: baseOY } = baseEl.scroll;
    const { overflowX: currOX, overflowY: currOY } = currEl.scroll;

    const wasScrollableY = baseOY === 'auto' || baseOY === 'scroll';
    const nowBlockedY = currOY === 'hidden' || currOY === 'clip';
    const overflowsY = currEl.scroll.scrollHeight > currEl.box.height;

    const wasScrollableX = baseOX === 'auto' || baseOX === 'scroll';
    const nowBlockedX = currOX === 'hidden' || currOX === 'clip';
    const overflowsX = currEl.scroll.scrollWidth > currEl.box.width;

    const brokenY = wasScrollableY && nowBlockedY && overflowsY;
    const brokenX = wasScrollableX && nowBlockedX && overflowsX;

    if (brokenY || brokenX) {
      const axes: string[] = [];
      if (brokenY) axes.push(`overflow-y: ${baseOY} → ${currOY} (scrollHeight: ${currEl.scroll.scrollHeight}px > height: ${currEl.box.height}px)`);
      if (brokenX) axes.push(`overflow-x: ${baseOX} → ${currOX} (scrollWidth: ${currEl.scroll.scrollWidth}px > width: ${currEl.box.width}px)`);

      issues.push({
        category: 'CLIPPING',
        severity: 'error',
        selector: sel,
        title: 'Scroll removed — content now unreachable',
        detail: `container was scrollable, now clips content\n${axes.join('\n')}`,
      });
    }
  }

  return issues;
}

/**
 * Detect when spacing within a group of siblings became inconsistent.
 * e.g. all gaps were 16px, now one is 8px.
 */
function detectSpacingInconsistency(baseline: SpatialModel, current: SpatialModel, cfg: LinterConfig): Issue[] {
  const issues: Issue[] = [];

  // Group current elements by parent
  const parentGroups = new Map<string, typeof current.elements>();
  for (const el of current.elements) {
    if (!el.parentSelector) continue;
    if (!parentGroups.has(el.parentSelector)) parentGroups.set(el.parentSelector, []);
    parentGroups.get(el.parentSelector)!.push(el);
  }

  for (const [parentSel, children] of parentGroups) {
    if (isIgnored(parentSel, cfg.ignore)) continue;
    if (children.length < 3) continue; // Need at least 3 to detect inconsistency

    const gaps = children
      .map(c => c.siblingSpacing.previousGap)
      .filter((g): g is number => g !== null);

    if (gaps.length < 2) continue;

    // Calculate median gap
    const sorted = [...gaps].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

    // Find outliers
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const gap = child.siblingSpacing.previousGap;
      if (gap === null) continue;

      const deviation = Math.abs(gap - median);
      const absMedian = Math.abs(median);
      if (deviation > cfg.spacingThreshold && absMedian > 0 && deviation / absMedian > 0.3) {
        issues.push({
          category: 'SPACING',
          severity: 'warning',
          selector: child.selector,
          title: 'Inconsistent sibling spacing',
          detail: `gap: ${gap}px (group median: ${median}px)\nparent: ${parentSel}\ndeviation: ${deviation}px from group pattern`,
        });
      }
    }
  }

  return issues;
}

/**
 * Check whether an element's spatial model actually differs between baseline and current.
 * Compares: box, clip, visibility, opacity, spacing, zIndex.
 */
function hasSpatialDifference(base: ElementModel, curr: ElementModel): boolean {
  // Box position/size
  if (base.box.x !== curr.box.x || base.box.y !== curr.box.y ||
      base.box.width !== curr.box.width || base.box.height !== curr.box.height) return true;

  // Visibility / opacity
  if (base.visibility !== curr.visibility || base.opacity !== curr.opacity) return true;

  // Clip state
  if (base.clip.isClipped !== curr.clip.isClipped) return true;
  if (base.clip.isClipped && curr.clip.isClipped) {
    const be = base.clip.clippedEdges;
    const ce = curr.clip.clippedEdges;
    if (be && ce && (be.top !== ce.top || be.bottom !== ce.bottom || be.left !== ce.left || be.right !== ce.right)) return true;
  }

  // Spacing
  if (base.siblingSpacing.previousGap !== curr.siblingSpacing.previousGap ||
      base.siblingSpacing.nextGap !== curr.siblingSpacing.nextGap) return true;

  // z-index (can affect overlap)
  if (base.zIndex !== curr.zIndex) return true;

  // Overflow (can affect children even if this element's box is unchanged)
  if (base.overflow !== curr.overflow) return true;

  return false;
}

/**
 * Check whether an element or any of its direct descendants have a spatial difference.
 * Uses parentSelector chain (not selector prefix) to only check actual children,
 * not siblings that happen to share a selector prefix.
 */
function hasSpatialImpact(
  selector: string,
  baseMap: Map<string, ElementModel>,
  currMap: Map<string, ElementModel>,
): boolean {
  const base = baseMap.get(selector);
  const curr = currMap.get(selector);
  if (!base || !curr) return true; // element appeared/disappeared — that's a difference
  if (hasSpatialDifference(base, curr)) return true;

  // Build set of descendants by walking parentSelector chains
  // An element is a descendant of `selector` if its parentSelector chain reaches `selector`
  const isDescendant = (sel: string): boolean => {
    let current = currMap.get(sel) ?? baseMap.get(sel);
    const visited = new Set<string>();
    while (current?.parentSelector) {
      if (current.parentSelector === selector) return true;
      if (visited.has(current.parentSelector)) break;
      visited.add(current.parentSelector);
      current = currMap.get(current.parentSelector) ?? baseMap.get(current.parentSelector);
    }
    return false;
  };

  // Check descendants in baseline
  for (const [sel, baseChild] of baseMap) {
    if (sel === selector) continue;
    if (!isDescendant(sel)) continue;
    const currChild = currMap.get(sel);
    if (!currChild) return true;
    if (hasSpatialDifference(baseChild, currChild)) return true;
  }
  // Check for new elements in current
  for (const sel of currMap.keys()) {
    if (sel === selector) continue;
    if (!isDescendant(sel)) continue;
    if (!baseMap.has(sel)) return true;
  }

  return false;
}

/**
 * Diff computed styles between baseline and current for a single element.
 * Marks each change as effective (caused spatial impact) or inert.
 */
function diffStyles(
  selector: string,
  base: Record<string, string> | undefined,
  curr: Record<string, string> | undefined,
  effective: boolean,
): StyleChange[] {
  if (!base || !curr) return [];
  const changes: StyleChange[] = [];
  const allKeys = new Set([...Object.keys(base), ...Object.keys(curr)]);
  for (const prop of allKeys) {
    const bv = base[prop] ?? '';
    const cv = curr[prop] ?? '';
    if (bv !== cv) {
      changes.push({ selector, property: prop, baseline: bv || '(unset)', current: cv || '(unset)', effective });
    }
  }
  return changes;
}

/**
 * Find the nearest data-testid ancestor for a selector (including self).
 * Walk up via parentSelector until we find one that looks like [data-testid="..."].
 */
function findTestIdAncestor(
  selector: string,
  baseMap: Map<string, ElementModel>,
  currMap: Map<string, ElementModel>,
): string | null {
  let sel: string | null = selector;
  const visited = new Set<string>();
  while (sel) {
    if (visited.has(sel)) break;
    visited.add(sel);
    if (sel.match(/\[data-testid="/)) return sel;
    const found: ElementModel | undefined = currMap.get(sel) ?? baseMap.get(sel);
    if (!found?.parentSelector || found.parentSelector === sel) break;
    sel = found.parentSelector;
  }
  return null;
}

/**
 * Collect all style changes under a testid container.
 * Finds the nearest testid ancestor of the affected element,
 * then diffs every element under that container (including the container itself
 * and its ancestors up to 2 levels) between baseline and current.
 * Also checks the clippedBy ancestor for clipping issues.
 */
function collectStyleChangesUnderTestId(
  selector: string,
  baseMap: Map<string, ElementModel>,
  currMap: Map<string, ElementModel>,
  clippedBy?: string,
): StyleChange[] {
  // Find the nearest testid ancestor
  const testIdAncestor = findTestIdAncestor(selector, baseMap, currMap);
  if (!testIdAncestor) return [];

  const changes: StyleChange[] = [];
  const seen = new Set<string>();

  // Helper: diff one element and track by selector
  // Mark changes as effective if the element or its descendants have a spatial difference
  const diffOne = (sel: string) => {
    if (seen.has(sel)) return;
    seen.add(sel);
    const base = baseMap.get(sel);
    const curr = currMap.get(sel);
    if (base && curr) {
      const effective = hasSpatialImpact(sel, baseMap, currMap);
      changes.push(...diffStyles(sel, base.styles, curr.styles, effective));
    }
  };

  // 1. Diff the testid ancestor itself
  diffOne(testIdAncestor);

  // 2. Diff ancestors of the testid container (up 2 levels — catches e.g. layout wrapper changes)
  let parent: string | null = testIdAncestor;
  for (let i = 0; i < 2; i++) {
    const ancestor: ElementModel | undefined = currMap.get(parent!) ?? baseMap.get(parent!);
    if (!ancestor?.parentSelector || ancestor.parentSelector === parent) break;
    parent = ancestor.parentSelector;
    diffOne(parent!);
  }

  // 3. Diff all elements whose selector starts with the testid ancestor
  //    (i.e. children/descendants of the container)
  const prefix = testIdAncestor;
  for (const sel of baseMap.keys()) {
    if (sel === prefix || sel.startsWith(prefix + ' ')) {
      diffOne(sel);
    }
  }
  for (const sel of currMap.keys()) {
    if (sel === prefix || sel.startsWith(prefix + ' ')) {
      diffOne(sel);
    }
  }

  // 4. For clipping: also check the clipping ancestor and its subtree
  if (clippedBy) {
    const clipTestId = findTestIdAncestor(clippedBy, baseMap, currMap);
    if (clipTestId && clipTestId !== testIdAncestor) {
      diffOne(clipTestId);
      for (const sel of baseMap.keys()) {
        if (sel === clipTestId || sel.startsWith(clipTestId + ' ')) {
          diffOne(sel);
        }
      }
      for (const sel of currMap.keys()) {
        if (sel === clipTestId || sel.startsWith(clipTestId + ' ')) {
          diffOne(sel);
        }
      }
    }
    // Always diff the clippedBy element directly
    diffOne(clippedBy);
  }

  return changes;
}

function isIgnored(selector: string, ignoreList: string[]): boolean {
  return ignoreList.some(pattern => selector.includes(pattern));
}

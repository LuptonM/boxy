"use strict";
var Boxy = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    DEFAULT_CONFIG: () => DEFAULT_CONFIG,
    captureFromElement: () => captureScope,
    compare: () => compare,
    lint: () => lint
  });

  // src/capture.lib.ts
  function captureScope(scope) {
    const STYLE_PROPS = [
      "display",
      "position",
      "overflow",
      "overflowX",
      "overflowY",
      "visibility",
      "opacity",
      "zIndex",
      "width",
      "height",
      "minWidth",
      "minHeight",
      "maxWidth",
      "maxHeight",
      "top",
      "right",
      "bottom",
      "left",
      "margin",
      "padding",
      "flexShrink",
      "flexGrow",
      "flexBasis",
      "gridTemplateColumns",
      "gap",
      "transform",
      "clipPath"
    ];
    function buildSelector(el) {
      const parts = [];
      let current = el;
      while (current && current !== document.documentElement) {
        let part = current.tagName.toLowerCase();
        const testId = current.getAttribute("data-testid");
        if (testId) {
          parts.unshift(`[data-testid="${testId}"]`);
          break;
        }
        if (current.id) {
          parts.unshift(`#${current.id}`);
          break;
        }
        if (current.className && typeof current.className === "string" && current.className.trim()) {
          part += "." + current.className.trim().split(/\s+/).slice(0, 2).join(".");
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            part += `:nth-of-type(${index})`;
          }
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    }
    function computeEffectiveVisibility(el) {
      let visibility = "visible";
      let opacity = 1;
      let current = el;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.visibility === "hidden" || style.visibility === "collapse") {
          visibility = style.visibility;
        }
        const parsedOpacity = parseFloat(style.opacity);
        if (!Number.isNaN(parsedOpacity)) {
          opacity *= parsedOpacity;
        }
        current = current.parentElement;
      }
      return {
        visibility,
        opacity: opacity <= 0 ? "0" : String(opacity)
      };
    }
    function detectClipping(el) {
      const rect = el.getBoundingClientRect();
      let parent = el.parentElement;
      while (parent) {
        const ps = window.getComputedStyle(parent);
        const hasClip = ps.overflow === "hidden" || ps.overflow === "auto" || ps.overflow === "scroll" || ps.overflowX === "hidden" || ps.overflowY === "hidden" || ps.overflowX === "auto" || ps.overflowY === "auto" || ps.overflowX === "scroll" || ps.overflowY === "scroll";
        if (hasClip) {
          const pr = parent.getBoundingClientRect();
          const edges = {
            top: rect.top < pr.top ? Math.round(pr.top - rect.top) : 0,
            bottom: rect.bottom > pr.bottom ? Math.round(rect.bottom - pr.bottom) : 0,
            left: rect.left < pr.left ? Math.round(pr.left - rect.left) : 0,
            right: rect.right > pr.right ? Math.round(rect.right - pr.right) : 0
          };
          if (edges.top || edges.bottom || edges.left || edges.right) {
            return {
              isClipped: true,
              clippedBy: buildSelector(parent),
              clippedByBox: {
                x: Math.round(pr.x),
                y: Math.round(pr.y),
                width: Math.round(pr.width),
                height: Math.round(pr.height)
              },
              clippedEdges: edges
            };
          }
        }
        parent = parent.parentElement;
      }
      return { isClipped: false };
    }
    function computeSiblingSpacing(el) {
      const parent = el.parentElement;
      if (!parent) return { previousGap: null, nextGap: null, direction: "unknown" };
      const siblings = Array.from(parent.children).filter((child) => {
        const r = child.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = window.getComputedStyle(child);
        return s.display !== "none";
      });
      const idx = siblings.indexOf(el);
      if (idx === -1) return { previousGap: null, nextGap: null, direction: "unknown" };
      const rect = el.getBoundingClientRect();
      let previousGap = null;
      let nextGap = null;
      let direction = "unknown";
      if (idx > 0) {
        const prev = siblings[idx - 1].getBoundingClientRect();
        if (Math.abs(prev.top - rect.top) < 5) {
          direction = "horizontal";
          previousGap = Math.round(rect.left - prev.right);
        } else {
          direction = "vertical";
          previousGap = Math.round(rect.top - prev.bottom);
        }
      }
      if (idx < siblings.length - 1) {
        const next = siblings[idx + 1].getBoundingClientRect();
        if (direction === "horizontal" || direction === "unknown" && Math.abs(rect.top - next.top) < 5) {
          direction = "horizontal";
          nextGap = Math.round(next.left - rect.right);
        } else {
          direction = "vertical";
          nextGap = Math.round(next.top - rect.bottom);
        }
      }
      return { previousGap, nextGap, direction };
    }
    const root = document.querySelector(scope);
    if (!root) throw new Error(`Scope selector "${scope}" was not found during spatial model extraction.`);
    const elements = [];
    const allEls = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const computed = window.getComputedStyle(el);
      if (computed.display === "none") continue;
      const selector = buildSelector(el);
      const zIndex = computed.zIndex === "auto" ? 0 : parseInt(computed.zIndex);
      let depth = 0;
      let p = el.parentElement;
      while (p && p !== root) {
        depth++;
        p = p.parentElement;
      }
      const clip = detectClipping(el);
      const siblingSpacing = computeSiblingSpacing(el);
      const parentSelector = el.parentElement && el.parentElement !== document.body ? buildSelector(el.parentElement) : null;
      const { visibility, opacity } = computeEffectiveVisibility(el);
      const styles = {};
      for (const prop of STYLE_PROPS) {
        const val = computed.getPropertyValue(
          prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
        );
        if (val) {
          styles[prop] = val;
        }
      }
      const hasVisibleContent = el.childNodes.length > 0 && (el.textContent?.trim().length > 0 || el.querySelector("img, svg, canvas, video") !== null) && visibility !== "hidden" && opacity !== "0";
      elements.push({
        selector,
        tag: el.tagName.toLowerCase(),
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        zIndex,
        depth,
        position: computed.position,
        overflow: computed.overflow,
        clip,
        siblingSpacing,
        parentSelector,
        childCount: el.children.length,
        hasVisibleContent,
        visibility,
        opacity,
        styles
      });
    }
    const selectorCount = /* @__PURE__ */ new Map();
    for (const el of elements) {
      selectorCount.set(el.selector, (selectorCount.get(el.selector) || 0) + 1);
    }
    const selectorIndex = /* @__PURE__ */ new Map();
    for (const el of elements) {
      if (selectorCount.get(el.selector) > 1) {
        const idx = (selectorIndex.get(el.selector) || 0) + 1;
        selectorIndex.set(el.selector, idx);
        el.selector = `${el.selector}[${idx}]`;
      }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: window.location.href,
      timestamp: Date.now(),
      elements
    };
  }

  // src/types.ts
  var DEFAULT_CONFIG = {
    spacingThreshold: 4,
    positionThreshold: 20,
    sizeChangePercent: 30,
    collapsedMinSize: 5,
    ignore: []
  };

  // src/linter.lib.ts
  function isIgnored(selector, ignoreList) {
    return ignoreList.some((pattern) => selector.includes(pattern));
  }
  function boxesOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function checkClipping(el) {
    if (!el.clip.isClipped || !el.clip.clippedEdges) return null;
    const edges = el.clip.clippedEdges;
    const totalClipped = edges.top + edges.bottom + edges.left + edges.right;
    if (totalClipped === 0) return null;
    if (el.position !== "absolute" && el.position !== "fixed") return null;
    const edgeStr = Object.entries(edges).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}px`).join(", ");
    return {
      category: "CLIPPING",
      severity: "error",
      selector: el.selector,
      title: "Element clipped by parent overflow",
      detail: `clipped by: ${el.clip.clippedBy}
hidden: ${edgeStr}`
    };
  }
  function checkCollapsed(el, collapsedMinSize) {
    if (!el.hasVisibleContent || el.childCount === 0) return [];
    const issues = [];
    if (el.box.width > 0 && el.box.width < collapsedMinSize) {
      issues.push({
        category: "COLLAPSED",
        severity: "error",
        selector: el.selector,
        title: "Element width collapsed",
        detail: `width: ${el.box.width}px \u2014 likely unusable
element has ${el.childCount} children`
      });
    }
    if (el.box.height > 0 && el.box.height < collapsedMinSize) {
      issues.push({
        category: "COLLAPSED",
        severity: "error",
        selector: el.selector,
        title: "Element height collapsed",
        detail: `height: ${el.box.height}px \u2014 likely unusable
element has ${el.childCount} children`
      });
    }
    return issues;
  }
  function checkOffScreen(el, viewport) {
    const fullyOff = el.box.x + el.box.width < 0 || el.box.y + el.box.height < 0 || el.box.x > viewport.width || el.box.y > viewport.height;
    if (!fullyOff) return null;
    if (el.position === "static" || !el.hasVisibleContent) return null;
    return {
      category: "OFF_SCREEN",
      severity: "warning",
      selector: el.selector,
      title: "Element positioned off-screen",
      detail: `position: (${el.box.x}, ${el.box.y})
viewport: ${viewport.width}\xD7${viewport.height}`
    };
  }
  function checkOverlap(a, b) {
    if (!boxesOverlap(a.box, b.box)) return null;
    const higher = a.zIndex > b.zIndex ? a : b;
    const lower = a.zIndex > b.zIndex ? b : a;
    if (!higher.clip.isClipped) return null;
    return {
      category: "OVERLAP",
      severity: "error",
      selector: higher.selector,
      title: "High z-index element is clipped",
      detail: `${higher.selector} (z:${higher.zIndex}) overlaps ${lower.selector} (z:${lower.zIndex})
but is clipped by: ${higher.clip.clippedBy}`
    };
  }
  function findOverlapIssues(elements, ignore) {
    const positioned = elements.filter(
      (el) => el.position !== "static" && el.zIndex > 0 && !isIgnored(el.selector, ignore)
    );
    const issues = [];
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const issue = checkOverlap(positioned[i], positioned[j]);
        if (issue) issues.push(issue);
      }
    }
    return issues;
  }

  // src/linter.ts
  function lint(model, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const filtered = model.elements.filter((el) => !isIgnored(el.selector, cfg.ignore));
    const elementIssues = filtered.flatMap((el) => [
      checkClipping(el),
      ...checkCollapsed(el, cfg.collapsedMinSize),
      checkOffScreen(el, model.viewport)
    ]).filter((issue) => issue !== null);
    const clippingIssues = elementIssues.filter((i) => i.category === "CLIPPING");
    const otherIssues = elementIssues.filter((i) => i.category !== "CLIPPING");
    const clippedSelectors = new Set(clippingIssues.map((i) => i.selector));
    const isDescendantOfClipped = (selector) => {
      const el = model.elements.find((e) => e.selector === selector);
      if (!el) return null;
      let parent = el.parentSelector;
      const visited = /* @__PURE__ */ new Set();
      while (parent && !visited.has(parent)) {
        if (clippedSelectors.has(parent)) return parent;
        visited.add(parent);
        const parentEl = model.elements.find((e) => e.selector === parent);
        parent = parentEl?.parentSelector ?? null;
      }
      return null;
    };
    const rootClipping = [];
    const childMap = /* @__PURE__ */ new Map();
    for (const issue of clippingIssues) {
      const ancestor = isDescendantOfClipped(issue.selector);
      if (ancestor) {
        if (!childMap.has(ancestor)) childMap.set(ancestor, []);
        childMap.get(ancestor).push(issue.selector);
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

  // src/regression.ts
  function compare(baseline, current, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const issues = [];
    const baseMap = new Map(baseline.elements.map((el) => [el.selector, el]));
    const currMap = new Map(current.elements.map((el) => [el.selector, el]));
    for (const [sel, baseEl] of baseMap) {
      if (isIgnored2(sel, cfg.ignore)) continue;
      if (!currMap.has(sel) && baseEl.hasVisibleContent) {
        issues.push({
          category: "VISIBILITY",
          severity: "error",
          selector: sel,
          title: "Element disappeared",
          detail: `was: ${baseEl.box.width}\xD7${baseEl.box.height} at (${baseEl.box.x}, ${baseEl.box.y})
now: not found`
        });
      }
    }
    for (const [sel, baseEl] of baseMap) {
      const currEl = currMap.get(sel);
      if (!currEl || isIgnored2(sel, cfg.ignore)) continue;
      const baseVisible = baseEl.visibility !== "hidden" && baseEl.opacity !== "0";
      const currVisible = currEl.visibility !== "hidden" && currEl.opacity !== "0";
      if (baseVisible && !currVisible) {
        issues.push({
          category: "VISIBILITY",
          severity: "error",
          selector: sel,
          title: "Element became hidden",
          detail: `visibility: ${baseEl.visibility} \u2192 ${currEl.visibility}
opacity: ${baseEl.opacity} \u2192 ${currEl.opacity}`
        });
      }
      if (baseEl.siblingSpacing.previousGap !== null && currEl.siblingSpacing.previousGap !== null) {
        const delta = Math.abs(currEl.siblingSpacing.previousGap - baseEl.siblingSpacing.previousGap);
        if (delta > cfg.spacingThreshold) {
          issues.push({
            category: "SPACING",
            severity: delta > cfg.spacingThreshold * 3 ? "error" : "warning",
            selector: sel,
            title: "Sibling spacing changed",
            detail: `gap to previous sibling: ${baseEl.siblingSpacing.previousGap}px \u2192 ${currEl.siblingSpacing.previousGap}px (${delta > 0 ? "+" : ""}${currEl.siblingSpacing.previousGap - baseEl.siblingSpacing.previousGap}px)
direction: ${currEl.siblingSpacing.direction}`
          });
        }
      }
      const dx = Math.abs(currEl.box.x - baseEl.box.x);
      const dy = Math.abs(currEl.box.y - baseEl.box.y);
      if (dx > cfg.positionThreshold || dy > cfg.positionThreshold) {
        issues.push({
          category: "POSITION",
          severity: "error",
          selector: sel,
          title: "Element position shifted",
          detail: `was: (${baseEl.box.x}, ${baseEl.box.y})
now: (${currEl.box.x}, ${currEl.box.y})
delta: x${dx > 0 ? "+" : ""}${currEl.box.x - baseEl.box.x}px, y${dy > 0 ? "+" : ""}${currEl.box.y - baseEl.box.y}px`
        });
      }
      if (baseEl.box.width > 0 && baseEl.box.height > 0) {
        const wChange = Math.abs(currEl.box.width - baseEl.box.width) / baseEl.box.width * 100;
        const hChange = Math.abs(currEl.box.height - baseEl.box.height) / baseEl.box.height * 100;
        if (wChange > cfg.sizeChangePercent || hChange > cfg.sizeChangePercent) {
          issues.push({
            category: "SIZE",
            severity: "error",
            selector: sel,
            title: "Element size changed significantly",
            detail: `width: ${baseEl.box.width}px \u2192 ${currEl.box.width}px (${wChange.toFixed(0)}% change)
height: ${baseEl.box.height}px \u2192 ${currEl.box.height}px (${hChange.toFixed(0)}% change)`
          });
        }
      }
    }
    const spacingIssues = detectSpacingInconsistency(baseline, current, cfg);
    issues.push(...spacingIssues);
    const changeCache = /* @__PURE__ */ new Map();
    for (const issue of issues) {
      const currEl = currMap.get(issue.selector);
      const baseEl = baseMap.get(issue.selector);
      const clippedBy = currEl?.clip?.clippedBy ?? baseEl?.clip?.clippedBy;
      const cacheKey = (findTestIdAncestor(issue.selector, baseMap, currMap) ?? issue.selector) + (clippedBy ? `+${clippedBy}` : "");
      let changes;
      if (changeCache.has(cacheKey)) {
        changes = changeCache.get(cacheKey);
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
  function detectSpacingInconsistency(baseline, current, cfg) {
    const issues = [];
    const parentGroups = /* @__PURE__ */ new Map();
    for (const el of current.elements) {
      if (!el.parentSelector) continue;
      if (!parentGroups.has(el.parentSelector)) parentGroups.set(el.parentSelector, []);
      parentGroups.get(el.parentSelector).push(el);
    }
    for (const [parentSel, children] of parentGroups) {
      if (isIgnored2(parentSel, cfg.ignore)) continue;
      if (children.length < 3) continue;
      const gaps = children.map((c) => c.siblingSpacing.previousGap).filter((g) => g !== null && g >= 0);
      if (gaps.length < 2) continue;
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const gap = child.siblingSpacing.previousGap;
        if (gap === null || gap < 0) continue;
        const deviation = Math.abs(gap - median);
        if (deviation > cfg.spacingThreshold && median > 0 && deviation / median > 0.3) {
          issues.push({
            category: "SPACING",
            severity: "warning",
            selector: child.selector,
            title: "Inconsistent sibling spacing",
            detail: `gap: ${gap}px (group median: ${median}px)
parent: ${parentSel}
deviation: ${deviation}px from group pattern`
          });
        }
      }
    }
    return issues;
  }
  function hasSpatialDifference(base, curr) {
    if (base.box.x !== curr.box.x || base.box.y !== curr.box.y || base.box.width !== curr.box.width || base.box.height !== curr.box.height) return true;
    if (base.visibility !== curr.visibility || base.opacity !== curr.opacity) return true;
    if (base.clip.isClipped !== curr.clip.isClipped) return true;
    if (base.clip.isClipped && curr.clip.isClipped) {
      const be = base.clip.clippedEdges;
      const ce = curr.clip.clippedEdges;
      if (be && ce && (be.top !== ce.top || be.bottom !== ce.bottom || be.left !== ce.left || be.right !== ce.right)) return true;
    }
    if (base.siblingSpacing.previousGap !== curr.siblingSpacing.previousGap || base.siblingSpacing.nextGap !== curr.siblingSpacing.nextGap) return true;
    if (base.zIndex !== curr.zIndex) return true;
    if (base.overflow !== curr.overflow) return true;
    return false;
  }
  function hasSpatialImpact(selector, baseMap, currMap) {
    const base = baseMap.get(selector);
    const curr = currMap.get(selector);
    if (!base || !curr) return true;
    if (hasSpatialDifference(base, curr)) return true;
    const isDescendant = (sel) => {
      let current = currMap.get(sel) ?? baseMap.get(sel);
      const visited = /* @__PURE__ */ new Set();
      while (current?.parentSelector) {
        if (current.parentSelector === selector) return true;
        if (visited.has(current.parentSelector)) break;
        visited.add(current.parentSelector);
        current = currMap.get(current.parentSelector) ?? baseMap.get(current.parentSelector);
      }
      return false;
    };
    for (const [sel, baseChild] of baseMap) {
      if (sel === selector) continue;
      if (!isDescendant(sel)) continue;
      const currChild = currMap.get(sel);
      if (!currChild) return true;
      if (hasSpatialDifference(baseChild, currChild)) return true;
    }
    for (const sel of currMap.keys()) {
      if (sel === selector) continue;
      if (!isDescendant(sel)) continue;
      if (!baseMap.has(sel)) return true;
    }
    return false;
  }
  function diffStyles(selector, base, curr, effective) {
    if (!base || !curr) return [];
    const changes = [];
    const allKeys = /* @__PURE__ */ new Set([...Object.keys(base), ...Object.keys(curr)]);
    for (const prop of allKeys) {
      const bv = base[prop] ?? "";
      const cv = curr[prop] ?? "";
      if (bv !== cv) {
        changes.push({ selector, property: prop, baseline: bv || "(unset)", current: cv || "(unset)", effective });
      }
    }
    return changes;
  }
  function findTestIdAncestor(selector, baseMap, currMap) {
    let sel = selector;
    const visited = /* @__PURE__ */ new Set();
    while (sel) {
      if (visited.has(sel)) break;
      visited.add(sel);
      if (sel.match(/\[data-testid="/)) return sel;
      const found = currMap.get(sel) ?? baseMap.get(sel);
      if (!found?.parentSelector || found.parentSelector === sel) break;
      sel = found.parentSelector;
    }
    return null;
  }
  function collectStyleChangesUnderTestId(selector, baseMap, currMap, clippedBy) {
    const testIdAncestor = findTestIdAncestor(selector, baseMap, currMap);
    if (!testIdAncestor) return [];
    const changes = [];
    const seen = /* @__PURE__ */ new Set();
    const diffOne = (sel) => {
      if (seen.has(sel)) return;
      seen.add(sel);
      const base = baseMap.get(sel);
      const curr = currMap.get(sel);
      if (base && curr) {
        const effective = hasSpatialImpact(sel, baseMap, currMap);
        changes.push(...diffStyles(sel, base.styles, curr.styles, effective));
      }
    };
    diffOne(testIdAncestor);
    let parent = testIdAncestor;
    for (let i = 0; i < 2; i++) {
      const ancestor = currMap.get(parent) ?? baseMap.get(parent);
      if (!ancestor?.parentSelector || ancestor.parentSelector === parent) break;
      parent = ancestor.parentSelector;
      diffOne(parent);
    }
    const prefix = testIdAncestor;
    for (const sel of baseMap.keys()) {
      if (sel === prefix || sel.startsWith(prefix + " ")) {
        diffOne(sel);
      }
    }
    for (const sel of currMap.keys()) {
      if (sel === prefix || sel.startsWith(prefix + " ")) {
        diffOne(sel);
      }
    }
    if (clippedBy) {
      const clipTestId = findTestIdAncestor(clippedBy, baseMap, currMap);
      if (clipTestId && clipTestId !== testIdAncestor) {
        diffOne(clipTestId);
        for (const sel of baseMap.keys()) {
          if (sel === clipTestId || sel.startsWith(clipTestId + " ")) {
            diffOne(sel);
          }
        }
        for (const sel of currMap.keys()) {
          if (sel === clipTestId || sel.startsWith(clipTestId + " ")) {
            diffOne(sel);
          }
        }
      }
      diffOne(clippedBy);
    }
    return changes;
  }
  function isIgnored2(selector, ignoreList) {
    return ignoreList.some((pattern) => selector.includes(pattern));
  }
  return __toCommonJS(browser_exports);
})();

/**
 * Self-contained DOM capture function.
 *
 * ALL helper functions are nested inside so this function can be:
 * 1. Passed directly to Playwright's page.evaluate() (serialized as a string)
 * 2. Called directly in browser contexts (demo, tests)
 *
 * Takes a CSS selector scope string — works in both Playwright and browser.
 * Uses only standard DOM APIs: getBoundingClientRect, getComputedStyle, querySelectorAll.
 */
export function captureScope(scope: string) {
  const STYLE_PROPS = [
    'display', 'position', 'overflow', 'overflowX', 'overflowY',
    'visibility', 'opacity', 'zIndex',
    'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
    'top', 'right', 'bottom', 'left',
    'margin', 'padding',
    'flexShrink', 'flexGrow', 'flexBasis',
    'gridTemplateColumns', 'gap',
    'transform', 'clipPath',
  ];

  function buildSelector(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const testId = current.getAttribute('data-testid');
      if (testId) {
        parts.unshift(`[data-testid="${testId}"]`);
        break;
      }
      if (current.id) {
        parts.unshift(`#${current.id}`);
        break;
      }
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

  function computeEffectiveVisibility(el: Element): { visibility: string; opacity: string } {
    let visibility = 'visible';
    let opacity = 1;
    let current: Element | null = el;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.visibility === 'hidden' || style.visibility === 'collapse') {
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
      opacity: opacity <= 0 ? '0' : String(opacity),
    };
  }

  function detectClipping(el: Element) {
    const rect = el.getBoundingClientRect();
    let parent = el.parentElement;
    while (parent) {
      const ps = window.getComputedStyle(parent);
      const hasClip = ps.overflow === 'hidden' || ps.overflow === 'auto' || ps.overflow === 'scroll' || ps.overflow === 'clip'
        || ps.overflowX === 'hidden' || ps.overflowY === 'hidden'
        || ps.overflowX === 'auto' || ps.overflowY === 'auto'
        || ps.overflowX === 'scroll' || ps.overflowY === 'scroll'
        || ps.overflowX === 'clip' || ps.overflowY === 'clip';

      if (hasClip) {
        const pr = parent.getBoundingClientRect();
        const edges = {
          top: rect.top < pr.top ? Math.round(pr.top - rect.top) : 0,
          bottom: rect.bottom > pr.bottom ? Math.round(rect.bottom - pr.bottom) : 0,
          left: rect.left < pr.left ? Math.round(pr.left - rect.left) : 0,
          right: rect.right > pr.right ? Math.round(rect.right - pr.right) : 0,
        };
        if (edges.top || edges.bottom || edges.left || edges.right) {
          return {
            isClipped: true as const,
            clippedBy: buildSelector(parent),
            clippedByBox: {
              x: Math.round(pr.x), y: Math.round(pr.y),
              width: Math.round(pr.width), height: Math.round(pr.height),
            },
            clippedEdges: edges,
          };
        }
        // Element fits within this clipping ancestor — continue checking
        // grandparents because the element might overflow a higher ancestor.
      }
      parent = parent.parentElement;
    }
    return { isClipped: false as const };
  }

  function computeSiblingSpacing(el: Element) {
    const parent = el.parentElement;
    if (!parent) return { previousGap: null, nextGap: null, direction: 'unknown' as const };

    const siblings = Array.from(parent.children).filter(child => {
      const r = child.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = window.getComputedStyle(child);
      return s.display !== 'none';
    });

    const idx = siblings.indexOf(el);
    if (idx === -1) return { previousGap: null, nextGap: null, direction: 'unknown' as const };

    const rect = el.getBoundingClientRect();
    let previousGap: number | null = null;
    let nextGap: number | null = null;
    let direction: 'horizontal' | 'vertical' | 'unknown' = 'unknown';

    if (idx > 0) {
      const prev = siblings[idx - 1].getBoundingClientRect();
      if (Math.abs(prev.top - rect.top) < 5) {
        direction = 'horizontal';
        previousGap = Math.round(rect.left - prev.right);
      } else {
        direction = 'vertical';
        previousGap = Math.round(rect.top - prev.bottom);
      }
    }

    if (idx < siblings.length - 1) {
      const next = siblings[idx + 1].getBoundingClientRect();
      if (direction === 'horizontal' || (direction === 'unknown' && Math.abs(rect.top - next.top) < 5)) {
        direction = 'horizontal';
        nextGap = Math.round(next.left - rect.right);
      } else {
        direction = 'vertical';
        nextGap = Math.round(next.top - rect.bottom);
      }
    }

    return { previousGap, nextGap, direction };
  }

  // ── Main extraction ──

  const root = document.querySelector(scope);
  if (!root) throw new Error(`Scope selector "${scope}" was not found during spatial model extraction.`);

  const elements: any[] = [];

  // Capture elements in the DOM tree OR within the spatial bounds of the scope.
  // This catches portaled elements (React portals, Radix popovers, etc.) that
  // are appended to <body> but visually appear within the scoped area.
  const scopeRect = root.getBoundingClientRect();
  const descendants = new Set<Element>([root, ...Array.from(root.querySelectorAll('*'))]);
  const allEls = Array.from(document.body.querySelectorAll('*')).filter(el => {
    if (descendants.has(el)) return true;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    // Check spatial overlap with scope bounds
    return r.x < scopeRect.x + scopeRect.width && r.x + r.width > scopeRect.x &&
           r.y < scopeRect.y + scopeRect.height && r.y + r.height > scopeRect.y;
  });

  for (const el of allEls) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const computed = window.getComputedStyle(el);
    if (computed.display === 'none') continue;

    const selector = buildSelector(el);
    const zIndex = computed.zIndex === 'auto' ? 0 : parseInt(computed.zIndex);

    let depth = 0;
    let p: Element | null = el.parentElement;
    while (p && p !== root) { depth++; p = p.parentElement; }

    const clip = detectClipping(el);
    const siblingSpacing = computeSiblingSpacing(el);

    const parentSelector = el.parentElement && el.parentElement !== document.body
      ? buildSelector(el.parentElement)
      : null;

    const { visibility, opacity } = computeEffectiveVisibility(el);

    const styles: Record<string, string> = {};
    for (const prop of STYLE_PROPS) {
      const val = computed.getPropertyValue(
        prop.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
      );
      if (val) {
        styles[prop] = val;
      }
    }

    const hasVisibleContent = el.childNodes.length > 0 && (
      el.textContent?.trim().length! > 0 ||
      el.querySelector('img, svg, canvas, video') !== null
    ) && visibility !== 'hidden' && opacity !== '0';

    const ariaHidden = el.getAttribute('aria-hidden') === 'true';
    const role = el.getAttribute('role') || null;

    const htmlEl = el as HTMLElement;
    const scroll = {
      scrollWidth: htmlEl.scrollWidth ?? Math.round(rect.width),
      scrollHeight: htmlEl.scrollHeight ?? Math.round(rect.height),
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
    };

    elements.push({
      selector,
      tag: el.tagName.toLowerCase(),
      box: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      zIndex,
      depth,
      position: computed.position,
      overflow: computed.overflow,
      scroll,
      clip,
      siblingSpacing,
      parentSelector,
      childCount: el.children.length,
      hasVisibleContent,
      visibility,
      opacity,
      ariaHidden,
      role,
      styles,
    });
  }

  // Deduplicate selectors
  const selectorCount = new Map<string, number>();
  for (const el of elements) {
    selectorCount.set(el.selector, (selectorCount.get(el.selector) || 0) + 1);
  }
  const selectorIndex = new Map<string, number>();
  for (const el of elements) {
    if (selectorCount.get(el.selector)! > 1) {
      const idx = (selectorIndex.get(el.selector) || 0) + 1;
      selectorIndex.set(el.selector, idx);
      el.selector = `${el.selector}[${idx}]`;
    }
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
    timestamp: Date.now(),
    elements,
  };
}

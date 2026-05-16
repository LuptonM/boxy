import type { Page } from 'playwright';
import type { CaptureResult, SpatialModel, ElementModel } from './types.js';

export async function capture(
  page: Page,
  { name, scope = 'body' }: { name: string; scope?: string }
): Promise<CaptureResult> {
  const elementCount = await page.locator(scope).count();
  if (elementCount === 0) {
    throw new Error(`Scope selector "${scope}" was not found while capturing "${name}".`);
  }

  // Take scoped screenshot
  const element = page.locator(scope).first();
  const screenshot = await element.screenshot().catch(() => null);

  // Extract spatial model
  const model = await page.evaluate((scope: string) => {
    const root = document.querySelector(scope);
    if (!root) throw new Error(`Scope selector "${scope}" was not found during spatial model extraction.`);

    const elements: any[] = [];
    const allEls = [root, ...Array.from(root.querySelectorAll('*'))];

    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const computed = window.getComputedStyle(el);
      if (computed.display === 'none') continue;

      const selector = buildSelector(el);
      const zIndex = computed.zIndex === 'auto' ? 0 : parseInt(computed.zIndex);

      // Depth
      let depth = 0;
      let p: Element | null = el.parentElement;
      while (p && p !== root) { depth++; p = p.parentElement; }

      // Clip detection
      const clip = detectClipping(el);

      // Sibling spacing
      const siblingSpacing = computeSiblingSpacing(el);

      // Parent selector
      const parentSelector = el.parentElement && el.parentElement !== document.body
        ? buildSelector(el.parentElement)
        : null;

      // Visibility and opacity
      const { visibility, opacity } = computeEffectiveVisibility(el);

      // Capture layout-relevant computed styles
      const styles: Record<string, string> = {};
      const styleProps = [
        'display', 'position', 'overflow', 'overflowX', 'overflowY',
        'visibility', 'opacity', 'zIndex',
        'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
        'top', 'right', 'bottom', 'left',
        'margin', 'padding',
        'flexShrink', 'flexGrow', 'flexBasis',
        'gridTemplateColumns', 'gap',
        'transform', 'clipPath',
      ];
      for (const prop of styleProps) {
        const val = computed.getPropertyValue(
          prop.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
        );
        if (val) {
          styles[prop] = val;
        }
      }

      // Has visible content
      const hasVisibleContent = el.childNodes.length > 0 && (
        el.textContent?.trim().length! > 0 ||
        el.querySelector('img, svg, canvas, video') !== null
      ) && visibility !== 'hidden' && opacity !== '0';

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
        clip,
        siblingSpacing,
        parentSelector,
        childCount: el.children.length,
        hasVisibleContent,
        visibility,
        opacity,
        styles,
      });
    }

    // Deduplicate selectors: append occurrence index for duplicates
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
        // Add nth-child for disambiguation
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

    function detectClipping(el: Element): any {
      const rect = el.getBoundingClientRect();
      let parent = el.parentElement;
      while (parent) {
        const ps = window.getComputedStyle(parent);
        const hasClip = ps.overflow === 'hidden' || ps.overflow === 'auto' || ps.overflow === 'scroll'
          || ps.overflowX === 'hidden' || ps.overflowY === 'hidden'
          || ps.overflowX === 'auto' || ps.overflowY === 'auto'
          || ps.overflowX === 'scroll' || ps.overflowY === 'scroll';

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
              isClipped: true,
              clippedBy: buildSelector(parent),
              clippedByBox: {
                x: Math.round(pr.x), y: Math.round(pr.y),
                width: Math.round(pr.width), height: Math.round(pr.height),
              },
              clippedEdges: edges,
            };
          }
        }
        parent = parent.parentElement;
      }
      return { isClipped: false };
    }

    function computeSiblingSpacing(el: Element): any {
      const parent = el.parentElement;
      if (!parent) return { previousGap: null, nextGap: null, direction: 'unknown' };

      const siblings = Array.from(parent.children).filter(child => {
        const r = child.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = window.getComputedStyle(child);
        return s.display !== 'none';
      });

      const idx = siblings.indexOf(el);
      if (idx === -1) return { previousGap: null, nextGap: null, direction: 'unknown' };

      const rect = el.getBoundingClientRect();
      let previousGap: number | null = null;
      let nextGap: number | null = null;
      let direction: 'horizontal' | 'vertical' | 'unknown' = 'unknown';

      if (idx > 0) {
        const prev = siblings[idx - 1].getBoundingClientRect();
        const hGap = rect.left - prev.right;
        const vGap = rect.top - prev.bottom;

        if (Math.abs(prev.top - rect.top) < 5) {
          // Same row — horizontal
          direction = 'horizontal';
          previousGap = Math.round(hGap);
        } else {
          // Different row — vertical
          direction = 'vertical';
          previousGap = Math.round(vGap);
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

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: window.location.href,
      timestamp: Date.now(),
      elements,
    };
  }, scope) as SpatialModel;

  return { name, scope, model, screenshot };
}

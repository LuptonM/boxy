/**
 * Helper to build ElementModel objects with sensible defaults.
 */
export function makeElement(overrides = {}) {
  const box = overrides.box || { x: 100, y: 100, width: 200, height: 50 };
  return {
    selector: '[data-testid="el"]',
    tag: 'div',
    box,
    zIndex: 0,
    depth: 1,
    position: 'static',
    overflow: 'visible',
    scroll: {
      scrollWidth: box.width,
      scrollHeight: box.height,
      overflowX: 'visible',
      overflowY: 'visible',
      ...(overrides.scroll || {}),
    },
    clip: { isClipped: false },
    siblingSpacing: { previousGap: null, nextGap: null, direction: 'unknown' },
    parentSelector: null,
    childCount: 0,
    hasVisibleContent: true,
    visibility: 'visible',
    opacity: '1',
    ariaHidden: false,
    role: null,
    styles: {},
    ...overrides,
    // Ensure scroll override merges correctly (re-apply after spread)
    scroll: {
      scrollWidth: box.width,
      scrollHeight: box.height,
      overflowX: 'visible',
      overflowY: 'visible',
      ...(overrides.scroll || {}),
    },
  };
}

export function makeModel(elements, viewport = { width: 1440, height: 900 }) {
  return {
    viewport,
    url: 'http://test.local',
    timestamp: Date.now(),
    elements,
  };
}

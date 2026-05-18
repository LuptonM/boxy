# Boxy Linter — Testing Philosophy & Design

## How detection works

Boxy builds a **spatial model** of the page — every visible element's bounding box, computed styles, overflow, z-index, scroll dimensions, and parent relationships. It then runs checks against this model without needing pixel comparison or visual baselines.

### Two detection layers

| Layer | Input | What it finds |
|-------|-------|---------------|
| **Static lint** | Single spatial model snapshot | Clipping, collapsed, off-screen, overlap — layout bugs visible right now |
| **Regression compare** | Baseline + current snapshot | Position shifts, size changes, visibility loss, spacing changes, broken scroll — things that changed |

Static lint works on first run with no setup. Regression requires a baseline captured on a known-good state.

## What each check does

### Static lint checks

**CLIPPING** — An `absolute` or `fixed` positioned element extends beyond a parent that clips it (`overflow: hidden/auto/scroll/clip`). This catches dropdowns, popovers, tooltips, and menus that are cut off.

- Only flags `absolute`/`fixed` elements (not `static`/`relative`)
- Static elements clipped by overflow are assumed intentional (text truncation, scroll containers, image crops, carousels)
- Any amount of clipping triggers the check (even 1px)
- Groups nested clipping: if a parent dropdown is clipped, child elements clipped by the same ancestor are nested under `affectedChildren` rather than reported separately

**COLLAPSED** — An element has width or height between 1px and `collapsedMinSize` (default 5px) but contains visible content (`hasVisibleContent: true` and `childCount > 0`). This catches sidebars, panels, or containers that collapsed to near-zero dimensions.

- Requires `width > 0` — zero-width elements are filtered at capture time
- Requires `hasVisibleContent` and `childCount > 0` — empty containers aren't flagged
- Threshold is exclusive: `width < collapsedMinSize` (so exactly 5px at threshold 5 is fine)

**OFF_SCREEN** — A positioned element (`absolute`/`fixed`/`relative`) with visible content is entirely outside the viewport bounds.

- Requires element to be **fully** off-screen (no partial overlap with viewport)
- `position: static` elements are never flagged (they flow naturally)
- Elements without visible content are not flagged

**OVERLAP** — Two positioned elements (both with z-index > 0) overlap spatially, and the higher z-index one is clipped by an ancestor's overflow. This catches popovers or tooltips that should render on top but are instead clipped behind other content.

- Only compares elements with z-index > 0
- Only flags when the **higher** z-index element is clipped (not the lower)
- If the higher element is not clipped, overlap is considered normal (headers over content, etc.)

### Regression checks

**VISIBILITY** — Element disappeared from the model entirely, or became `visibility: hidden` / `opacity: 0`.

**SPACING** — Gap between siblings changed beyond `spacingThreshold` (default 4px).

**POSITION** — Element moved beyond `positionThreshold` (default 20px) on either axis.

**SIZE** — Element width or height changed by more than `sizeChangePercent` (default 30%).

**BROKEN SCROLL** — A container's overflow changed from scrollable (`auto`/`scroll`) to non-scrollable (`hidden`/`clip`) while content still exceeds the visible area (`scrollHeight > height`). This definitively means content that was reachable is now inaccessible.

- Only flags in regression mode (not static lint) because a single snapshot can't distinguish broken scroll from intentional carousel/slider
- Requires overflow to have *changed* from a scrollable value — if it was always `hidden`, it's assumed intentional
- Requires content to actually overflow (`scrollHeight > height` or `scrollWidth > width`)
- `visible` to `hidden` is NOT flagged (visible never had a scrollbar, so nothing was "removed")

## Intent suppression

The linter skips checks on elements that are **intentionally invisible to all users**:

| Pattern | Detection | Suppresses |
|---------|-----------|-----------|
| Actually invisible | `visibility: hidden` or `opacity: 0` | All checks |
| No rendered content | `hasVisibleContent: false` | All checks |
| sr-only / visually-hidden | `position: absolute` + dimensions <= 1px + off-screen coordinates | All checks |
| Zero-area + aria-hidden | `aria-hidden="true"` + `width: 0, height: 0` | All checks |

### What does NOT suppress

`aria-hidden="true"` alone does **not** suppress checks. This attribute only removes an element from the accessibility tree — it does not mean the element is visually hidden. Common uses of `aria-hidden="true"` on visible elements:

- Decorative Font Awesome / SVG icons (next to text labels)
- Duplicate visual content (pullquotes)
- Visual flourishes and separators

These elements are rendered on screen and can legitimately be affected by layout bugs (clipped icons, off-screen decorations). Suppressing checks on them would create false negatives.

## Known limitations

### False positives the linter may still produce

1. **Closed menus/dropdowns captured in resting state** — An absolute-positioned dropdown that's closed (clipped by parent) looks identical to a broken one. The developer should add the selector to `config.ignore` or only capture after opening.

2. **Animation mid-states** — Elements captured during CSS transitions may appear clipped or off-screen temporarily. Capture after transitions settle.

3. **Intentional absolute-positioned content inside overflow:hidden** — Some layouts intentionally place absolute elements inside clipped containers (e.g., decorative overflow effects). Use `config.ignore` for these.

### False negatives the linter may miss

1. **Partially off-screen elements** — Only fully off-screen elements are flagged. A dropdown hanging 80% off the viewport edge is not caught.

2. **`position: relative` elements clipped by ancestors** — Only `absolute`/`fixed` elements trigger CLIPPING. Relative-positioned popovers (older patterns) clipped by overflow are missed.

3. **`contain: paint` creating clip boundaries** — This CSS property acts like `overflow: hidden` for clipping but isn't detected by the capture layer.

4. **Elements with z-index: 0 overlapping** — The overlap check only examines elements with z-index > 0. Most positioned elements in the wild have z-index: auto (resolved as 0) and are never compared.

5. **JavaScript-driven scroll containers** — Static lint can't know if `overflow: hidden` + JS provides scrollability (carousels, virtual scroll, custom scrollbars). Regression mode catches this if overflow *changed*.

6. **Color/font/border changes** — The linter only checks spatial properties. A text color changing to match the background (making content invisible) is not detected unless it causes `hasVisibleContent` to change.

### Design decisions

- **Static lint stays conservative** — It's better to miss some bugs than to flood developers with false positives. Static lint only flags patterns that are almost always bugs (positioned elements clipped, near-zero dimensions with content).

- **Regression mode can be more aggressive** — When we have a baseline to compare against, we can definitively say "this changed" which is a stronger signal than "this looks wrong."

- **Broken scroll lives in regression only** — A single snapshot of `overflow: hidden` with `scrollHeight > height` is ambiguous (carousel? broken scroll?). But `overflow: auto → hidden` with content still overflowing is definitive.

- **ARIA informs but doesn't override visual checks** — `aria-hidden` is a signal about AT intent, not visual intent. Only suppress when the element is actually invisible (hidden/transparent/zero-area).

## Test structure

```
test/
  fixtures/
    elements.mjs      ← makeElement() / makeModel() helpers
  linter.test.mjs     ← Static lint unit tests (false positives, true positives, edge cases)
  regression.test.mjs ← Regression compare tests (thresholds, broken scroll)
  unit.mjs            ← Integration tests (API, capture, module loading)
  run.mjs             ← Playwright integration tests (real browser)
  scenarios.mjs       ← Interaction-driven scenario tests
  mutations.mjs       ← Mutation testing (inject CSS bugs, verify detection)
```

The linter and regression tests are pure unit tests — they build `ElementModel` objects directly and pass them to `lint()` / `compare()`. No browser needed, fast and deterministic.

## Adding new tests

Use `makeElement()` with only the overrides relevant to your scenario:

```js
test('My scenario', () => {
  const el = makeElement({
    selector: '[data-testid="thing"]',
    position: 'absolute',                    // only override what matters
    clip: { isClipped: true, clippedBy: '...', clippedEdges: { ... } },
  });
  const issues = lint(makeModel([el]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'CLIPPING');
});
```

Everything else (box, z-index, overflow, visibility, etc.) gets sensible defaults that won't trigger any checks.

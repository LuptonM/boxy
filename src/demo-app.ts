/**
 * Demo page application logic.
 * Built alongside browser.ts into docs/demo.js.
 *
 * Expects `Boxy` global to be available (from the IIFE bundle).
 */

declare const Boxy: {
  captureFromElement(scope: string): import('./types.js').SpatialModel;
  lint(model: import('./types.js').SpatialModel): import('./types.js').Issue[];
  compare(baseline: import('./types.js').SpatialModel, current: import('./types.js').SpatialModel): import('./types.js').Issue[];
};

/**
 * Run captureFromElement inside the iframe's window context.
 * captureScope uses `document.querySelector` and `window.getComputedStyle`,
 * so we need to call it from the iframe's window, not the parent.
 */
function captureInFrame(scope: string) {
  const win = frame.contentWindow as any;
  if (!win) throw new Error('iframe not ready');
  // Inject Boxy into the iframe if not already there
  if (!win.Boxy) {
    const script = frame.contentDocument!.createElement('script');
    script.src = 'demo.js';
    frame.contentDocument!.head.appendChild(script);
    // Synchronous fallback: copy the function directly
    win.__boxyCapture = Boxy.captureFromElement;
  }
  // Call the function in the iframe's context using Function to rebind globals
  const fn = Boxy.captureFromElement;
  const result = win.Function('return (' + fn.toString() + ')("' + scope.replace(/"/g, '\\"') + '")')();
  return result;
}

interface Mutation {
  id: string;
  label: string;
  apply(doc: Document): void;
  remove(doc: Document): void;
  setup?(doc: Document): void;
}

interface Issue {
  category: string;
  severity: string;
  selector: string;
  title: string;
  detail: string;
  styleChanges?: StyleChange[];
}

interface StyleChange {
  selector: string;
  property: string;
  baseline: string;
  current: string;
  effective: boolean;
}

const mutations: Mutation[] = [
  {
    id: 'table-overflow-hidden',
    label: 'overflow:hidden on table — clips open dropdown',
    apply(doc) { doc.querySelector<HTMLElement>('[data-testid="table-area"]')!.style.overflow = 'hidden'; },
    remove(doc) { doc.querySelector<HTMLElement>('[data-testid="table-area"]')!.style.overflow = ''; },
    setup(doc) {
      // Open action menu on last row — it pops upward but gets clipped
      const btn = doc.querySelector<HTMLElement>('[data-testid="action-btn-8"]');
      if (btn) btn.click();
    }
  },
  {
    id: 'sidebar-collapse-zero',
    label: 'Sidebar collapses to 0px — clips all nav items',
    apply(doc) {
      doc.documentElement.style.setProperty('--sidebar-collapsed', '0px');
      doc.querySelector('[data-testid="sidebar"]')!.classList.add('collapsed');
    },
    remove(doc) {
      doc.documentElement.style.removeProperty('--sidebar-collapsed');
      doc.querySelector('[data-testid="sidebar"]')!.classList.remove('collapsed');
    }
  },
  {
    id: 'main-overflow-hidden',
    label: 'overflow:hidden on main — clips filter popover',
    apply(doc) {
      doc.querySelector<HTMLElement>('[data-testid="main"]')!.style.overflow = 'hidden';
    },
    remove(doc) {
      doc.querySelector<HTMLElement>('[data-testid="main"]')!.style.overflow = '';
    },
    setup(doc) {
      // Open filter popover so it gets clipped
      const chip = doc.querySelector<HTMLElement>('[data-testid="filter-status"]');
      if (chip) chip.click();
    }
  },
  {
    id: 'row-dropdown-down',
    label: 'Dropdown opens downward — clipped at viewport edge',
    apply(doc) {
      doc.querySelectorAll<HTMLElement>('.row-dropdown').forEach(d => {
        d.style.bottom = 'auto';
        d.style.top = 'calc(100% + 4px)';
      });
    },
    remove(doc) {
      doc.querySelectorAll<HTMLElement>('.row-dropdown').forEach(d => {
        d.style.bottom = '';
        d.style.top = '';
      });
    },
    setup(doc) {
      const btn = doc.querySelector<HTMLElement>('[data-testid="action-btn-8"]');
      if (btn) btn.click();
    }
  },
  {
    id: 'detail-panel-clipped',
    label: 'Detail panel overflow:hidden + short max-height',
    apply(doc) {
      const body = doc.querySelector<HTMLElement>('[data-testid="detail-body"]');
      if (body) { body.style.overflow = 'hidden'; body.style.maxHeight = '120px'; }
    },
    remove(doc) {
      const body = doc.querySelector<HTMLElement>('[data-testid="detail-body"]');
      if (body) { body.style.overflow = ''; body.style.maxHeight = ''; }
    },
    setup(doc) {
      // Open detail panel to show the clipping
      doc.querySelector<HTMLElement>('[data-testid="detail-panel"]')!.classList.add('open');
    }
  },
  {
    id: 'notif-off-screen',
    label: 'Notification dropdown pushed off-screen',
    apply(doc) {
      const dd = doc.querySelector<HTMLElement>('[data-testid="notif-dropdown"]');
      if (dd) dd.style.right = '-300px';
    },
    remove(doc) {
      const dd = doc.querySelector<HTMLElement>('[data-testid="notif-dropdown"]');
      if (dd) dd.style.right = '';
    },
    setup(doc) {
      // Open the notification dropdown so the off-screen position is visible
      doc.querySelector<HTMLElement>('[data-testid="notif-dropdown"]')!.classList.add('open');
    }
  },
];

type SpatialModel = ReturnType<typeof Boxy.captureFromElement>;
let baseline: SpatialModel | null = null;
const activeToggles = new Set<string>();

// ── Build toggle UI ──

const grid = document.getElementById('toggles-grid')!;
for (const m of mutations) {
  const div = document.createElement('div');
  div.className = 'toggle-item';
  div.dataset.id = m.id;
  div.innerHTML = '<div class="toggle-switch"></div><span class="toggle-label">' +
    escHtml(m.label) + '</span>';
  div.addEventListener('click', () => toggleMutation(m.id));
  grid.appendChild(div);
}

// ── Sample UI iframe (rendered at 1440x900, scaled to fit) ──

const frame = document.getElementById('sample-frame') as HTMLIFrameElement;
const frameContainer = document.getElementById('sample-ui-frame')!;
const frameInner = document.getElementById('sample-ui-inner')!;

function scaleFrame() {
  const containerWidth = frameContainer.clientWidth;
  const scale = Math.min(1, containerWidth / 1440);
  frameInner.style.transform = `scale(${scale})`;
  frameInner.style.height = `${900 * scale}px`;
  frameContainer.style.height = `${900 * scale}px`;
}

scaleFrame();
window.addEventListener('resize', scaleFrame);

function loadSampleUI() {
  frame.src = 'sample-ui.html';
}

frame.addEventListener('load', () => {
  setTimeout(() => { reapplyMutations(); scaleFrame(); }, 50);
});

loadSampleUI();

function getFrameDoc(): Document | null {
  try { return frame.contentDocument; } catch { return null; }
}

function toggleMutation(id: string) {
  const el = grid.querySelector(`[data-id="${id}"]`)!;
  if (activeToggles.has(id)) {
    activeToggles.delete(id);
    el.classList.remove('active');
  } else {
    activeToggles.add(id);
    el.classList.add('active');
  }
  reapplyMutations();
}

function reapplyMutations() {
  const doc = getFrameDoc();
  if (!doc?.body) return;

  for (const m of mutations) {
    try { m.remove(doc); } catch {}
  }
  doc.querySelectorAll('.row-dropdown, .filter-popover, .notif-dropdown').forEach(
    d => d.classList.remove('open')
  );

  for (const m of mutations) {
    if (activeToggles.has(m.id)) {
      try { m.apply(doc); } catch {}
      if (m.setup) {
        try { m.setup(doc); } catch {}
      }
    }
  }

  applyCustomCSS();
}

function applyCustomCSS() {
  const doc = getFrameDoc();
  if (!doc) return;
  let styleEl = doc.getElementById('user-css');
  const css = (document.getElementById('css-editor') as HTMLTextAreaElement).value.trim();
  if (css) {
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'user-css';
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  } else if (styleEl) {
    styleEl.remove();
  }
}

// ── Buttons ──

let baselineLintIssueKeys = new Set<string>();

document.getElementById('btn-baseline')!.addEventListener('click', () => {
  const doc = getFrameDoc();
  if (!doc?.body) return;
  baseline = captureInFrame('[data-testid="app"]');
  // Remember issues already present in baseline so we can filter them out
  const baselineLint = Boxy.lint(baseline);
  baselineLintIssueKeys = new Set(baselineLint.map(i => i.category + '|' + i.selector + '|' + i.title));
  showStatus('Baseline saved (' + baseline.elements.length + ' elements)');
});

document.getElementById('btn-run')!.addEventListener('click', () => {
  const doc = getFrameDoc();
  if (!doc?.body) return;

  applyCustomCSS();

  const model = captureInFrame('[data-testid="app"]');

  // Lint: only show issues NOT present in baseline (i.e. newly introduced)
  const lintIssues = Boxy.lint(model).filter(
    i => !baselineLintIssueKeys.has(i.category + '|' + i.selector + '|' + i.title)
  );

  // Regression: filter out spacing inconsistencies that also exist in baseline
  let regressionIssues: Issue[] = [];
  if (baseline) {
    const baselineRegressionKeys = new Set(
      Boxy.compare(baseline, baseline).map(i => i.category + '|' + i.selector + '|' + i.title)
    );
    regressionIssues = Boxy.compare(baseline, model).filter(
      i => !baselineRegressionKeys.has(i.category + '|' + i.selector + '|' + i.title)
    );
  }

  const allIssues = [...lintIssues, ...regressionIssues];
  renderResults(allIssues);
  highlightElements(doc, allIssues);
});

document.getElementById('btn-reset')!.addEventListener('click', () => {
  activeToggles.clear();
  grid.querySelectorAll('.toggle-item').forEach(el => el.classList.remove('active'));
  (document.getElementById('css-editor') as HTMLTextAreaElement).value = '';
  baseline = null;
  loadSampleUI();
  renderResults(null);
});

let cssTimeout: ReturnType<typeof setTimeout>;
document.getElementById('css-editor')!.addEventListener('input', () => {
  clearTimeout(cssTimeout);
  cssTimeout = setTimeout(() => applyCustomCSS(), 300);
});

// ── Render results ──

function renderResults(issues: Issue[] | null) {
  const body = document.getElementById('results-body')!;
  const count = document.getElementById('results-count')!;

  if (!issues) {
    body.innerHTML = '<div class="results-empty"><div class="icon">&#9744;</div><p>Click <strong>Save Baseline</strong>, toggle a mutation,<br>then click <strong>Run Boxy</strong></p></div>';
    count.textContent = '';
    return;
  }

  if (issues.length === 0) {
    body.innerHTML = '<div class="results-empty"><div class="icon" style="color:var(--green)">&#10003;</div><p>No issues found</p></div>';
    count.textContent = '0 issues';
    return;
  }

  count.textContent = issues.length + ' issue' + (issues.length !== 1 ? 's' : '');

  const groups: Record<string, Issue[]> = {};
  for (const issue of issues) {
    if (!groups[issue.category]) groups[issue.category] = [];
    groups[issue.category].push(issue);
  }

  let html = '';
  for (const [category, groupIssues] of Object.entries(groups)) {
    html += '<div class="issue-group">';
    html += '<div class="issue-group-title">' + escHtml(category) + ' (' + groupIssues.length + ')</div>';
    for (const issue of groupIssues) {
      html += '<div class="issue-card ' + issue.severity + '">';
      html += '<div class="issue-title"><span class="severity-dot ' + issue.severity + '"></span>' + escHtml(issue.title) + '</div>';
      html += '<div class="issue-selector">' + escHtml(issue.selector) + '</div>';
      html += '<div class="issue-detail">' + escHtml(issue.detail) + '</div>';
      if (issue.styleChanges && issue.styleChanges.length > 0) {
        html += '<div class="issue-changes">';
        html += '<div class="issue-changes-title">CSS Changes</div>';
        const shown = issue.styleChanges.slice(0, 5);
        for (const sc of shown) {
          const cls = sc.effective ? '' : ' inert';
          html += '<div class="style-change' + cls + '">';
          html += '<span class="prop">' + escHtml(sc.property) + '</span>: ';
          html += '<span class="old">' + escHtml(sc.baseline) + '</span> ';
          html += '<span class="new">' + escHtml(sc.current) + '</span>';
          html += '</div>';
        }
        if (issue.styleChanges.length > 5) {
          html += '<div class="style-change inert">...and ' + (issue.styleChanges.length - 5) + ' more</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  body.innerHTML = html;
}

function highlightElements(doc: Document, issues: Issue[]) {
  doc.querySelectorAll('.boxy-highlight').forEach(el => el.classList.remove('boxy-highlight'));

  const selectors = new Set(issues.map(i => i.selector));
  for (const sel of selectors) {
    try {
      const cleanSel = sel.replace(/\[\d+\]$/, '');
      const el = doc.querySelector(cleanSel);
      if (el) el.classList.add('boxy-highlight');
    } catch {}
  }
}

function showStatus(msg: string) {
  const count = document.getElementById('results-count')!;
  count.textContent = msg;
  setTimeout(() => {
    if (count.textContent === msg) count.textContent = '';
  }, 3000);
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

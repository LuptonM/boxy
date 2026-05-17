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
    id: 'topnav-clipped',
    label: 'Topnav height crushed — clips nav buttons',
    apply(doc) {
      const t = doc.querySelector<HTMLElement>('[data-testid="topnav"]')!;
      t.style.height = '20px';
      t.style.overflow = 'hidden';
    },
    remove(doc) {
      const t = doc.querySelector<HTMLElement>('[data-testid="topnav"]')!;
      t.style.height = '';
      t.style.overflow = '';
    }
  },
  {
    id: 'filter-bar-collapsed',
    label: 'Filter bar collapsed to 0px — clips all filters',
    apply(doc) {
      const f = doc.querySelector<HTMLElement>('[data-testid="filter-bar"]')!;
      f.style.height = '0px';
      f.style.overflow = 'hidden';
    },
    remove(doc) {
      const f = doc.querySelector<HTMLElement>('[data-testid="filter-bar"]')!;
      f.style.height = '';
      f.style.overflow = '';
    }
  },
  {
    id: 'table-clipped',
    label: 'Table area max-height too short — clips rows',
    apply(doc) {
      const t = doc.querySelector<HTMLElement>('[data-testid="table-area"]')!;
      t.style.maxHeight = '400px';
      t.style.overflow = 'hidden';
    },
    remove(doc) {
      const t = doc.querySelector<HTMLElement>('[data-testid="table-area"]')!;
      t.style.maxHeight = '';
      t.style.overflow = '';
    }
  },
  {
    id: 'pagination-offscreen',
    label: 'Pagination pushed off-screen',
    apply(doc) {
      const p = doc.querySelector<HTMLElement>('[data-testid="pagination"]')!;
      p.style.position = 'absolute';
      p.style.left = '-9999px';
    },
    remove(doc) {
      const p = doc.querySelector<HTMLElement>('[data-testid="pagination"]')!;
      p.style.position = '';
      p.style.left = '';
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
  setTimeout(() => {
    reapplyMutations();
    scaleFrame();
    // Auto-save baseline from clean state
    saveBaseline();
  }, 100);
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

}

// ── Buttons ──

let baselineLintIssueKeys = new Set<string>();

function saveBaseline() {
  const doc = getFrameDoc();
  if (!doc?.body) return;
  try {
    baseline = captureInFrame('[data-testid="app"]');
    const baselineLint = Boxy.lint(baseline);
    baselineLintIssueKeys = new Set(baselineLint.map(i => i.category + '|' + i.selector + '|' + i.title));
  } catch {
    // iframe not ready yet
  }
}

document.getElementById('btn-baseline')!.addEventListener('click', () => {
  saveBaseline();
  if (baseline) showStatus('Baseline saved (' + baseline.elements.length + ' elements)');
});

document.getElementById('btn-run')!.addEventListener('click', () => {
  const doc = getFrameDoc();
  if (!doc?.body) return;

  const model = captureInFrame('[data-testid="app"]');

  // Lint: show only issues introduced by mutations (subtract baseline issues)
  const lintIssues = Boxy.lint(model).filter(
    i => !baselineLintIssueKeys.has(i.category + '|' + i.selector + '|' + i.title)
  );

  renderResults(lintIssues);
  highlightElements(doc, lintIssues);
});

document.getElementById('btn-reset')!.addEventListener('click', () => {
  activeToggles.clear();
  grid.querySelectorAll('.toggle-item').forEach(el => el.classList.remove('active'));
  baseline = null;
  loadSampleUI();
  renderResults(null);
});

// ── Render results ──

function renderResults(issues: Issue[] | null) {
  const body = document.getElementById('results-body')!;
  const count = document.getElementById('results-count')!;

  if (!issues) {
    body.innerHTML = '<div class="results-empty"><div class="icon">&#9744;</div><p>Toggle a mutation, then click <strong>Run Boxy</strong></p></div>';
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

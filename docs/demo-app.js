"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/demo-app.ts
  var require_demo_app = __commonJS({
    "src/demo-app.ts"() {
      function captureInFrame(scope) {
        const win = frame.contentWindow;
        if (!win) throw new Error("iframe not ready");
        if (!win.Boxy) {
          const script = frame.contentDocument.createElement("script");
          script.src = "demo.js";
          frame.contentDocument.head.appendChild(script);
          win.__boxyCapture = Boxy.captureFromElement;
        }
        const fn = Boxy.captureFromElement;
        const result = win.Function("return (" + fn.toString() + ')("' + scope.replace(/"/g, '\\"') + '")')();
        return result;
      }
      var mutations = [
        {
          id: "topnav-clipped",
          label: "Topnav height crushed \u2014 clips nav buttons",
          apply(doc) {
            const t = doc.querySelector('[data-testid="topnav"]');
            t.style.height = "20px";
            t.style.overflow = "hidden";
          },
          remove(doc) {
            const t = doc.querySelector('[data-testid="topnav"]');
            t.style.height = "";
            t.style.overflow = "";
          }
        },
        {
          id: "filter-bar-collapsed",
          label: "Filter bar collapsed to 0px \u2014 clips all filters",
          apply(doc) {
            const f = doc.querySelector('[data-testid="filter-bar"]');
            f.style.height = "0px";
            f.style.overflow = "hidden";
          },
          remove(doc) {
            const f = doc.querySelector('[data-testid="filter-bar"]');
            f.style.height = "";
            f.style.overflow = "";
          }
        },
        {
          id: "table-clipped",
          label: "Table area max-height too short \u2014 clips rows",
          apply(doc) {
            const t = doc.querySelector('[data-testid="table-area"]');
            t.style.maxHeight = "400px";
            t.style.overflow = "hidden";
          },
          remove(doc) {
            const t = doc.querySelector('[data-testid="table-area"]');
            t.style.maxHeight = "";
            t.style.overflow = "";
          }
        },
        {
          id: "pagination-offscreen",
          label: "Pagination pushed off-screen",
          apply(doc) {
            const p = doc.querySelector('[data-testid="pagination"]');
            p.style.position = "absolute";
            p.style.left = "-9999px";
          },
          remove(doc) {
            const p = doc.querySelector('[data-testid="pagination"]');
            p.style.position = "";
            p.style.left = "";
          }
        }
      ];
      var baseline = null;
      var activeToggles = /* @__PURE__ */ new Set();
      var grid = document.getElementById("toggles-grid");
      for (const m of mutations) {
        const div = document.createElement("div");
        div.className = "toggle-item";
        div.dataset.id = m.id;
        div.innerHTML = '<div class="toggle-switch"></div><span class="toggle-label">' + escHtml(m.label) + "</span>";
        div.addEventListener("click", () => toggleMutation(m.id));
        grid.appendChild(div);
      }
      var frame = document.getElementById("sample-frame");
      var frameContainer = document.getElementById("sample-ui-frame");
      var frameInner = document.getElementById("sample-ui-inner");
      function scaleFrame() {
        const containerWidth = frameContainer.clientWidth;
        const scale = Math.min(1, containerWidth / 1440);
        frameInner.style.transform = `scale(${scale})`;
        frameInner.style.height = `${900 * scale}px`;
        frameContainer.style.height = `${900 * scale}px`;
      }
      scaleFrame();
      window.addEventListener("resize", scaleFrame);
      function loadSampleUI() {
        frame.src = "sample-ui.html";
      }
      frame.addEventListener("load", () => {
        setTimeout(() => {
          reapplyMutations();
          scaleFrame();
          saveBaseline();
        }, 100);
      });
      loadSampleUI();
      function getFrameDoc() {
        try {
          return frame.contentDocument;
        } catch {
          return null;
        }
      }
      function toggleMutation(id) {
        const el = grid.querySelector(`[data-id="${id}"]`);
        if (activeToggles.has(id)) {
          activeToggles.delete(id);
          el.classList.remove("active");
        } else {
          activeToggles.add(id);
          el.classList.add("active");
        }
        reapplyMutations();
      }
      function reapplyMutations() {
        const doc = getFrameDoc();
        if (!doc?.body) return;
        for (const m of mutations) {
          try {
            m.remove(doc);
          } catch {
          }
        }
        doc.querySelectorAll(".row-dropdown, .filter-popover, .notif-dropdown").forEach(
          (d) => d.classList.remove("open")
        );
        for (const m of mutations) {
          if (activeToggles.has(m.id)) {
            try {
              m.apply(doc);
            } catch {
            }
            if (m.setup) {
              try {
                m.setup(doc);
              } catch {
              }
            }
          }
        }
      }
      var baselineLintIssueKeys = /* @__PURE__ */ new Set();
      function saveBaseline() {
        const doc = getFrameDoc();
        if (!doc?.body) return;
        try {
          baseline = captureInFrame('[data-testid="app"]');
          const baselineLint = Boxy.lint(baseline);
          baselineLintIssueKeys = new Set(baselineLint.map((i) => i.category + "|" + i.selector + "|" + i.title));
        } catch {
        }
      }
      document.getElementById("btn-baseline").addEventListener("click", () => {
        saveBaseline();
        if (baseline) showStatus("Baseline saved (" + baseline.elements.length + " elements)");
      });
      document.getElementById("btn-run").addEventListener("click", () => {
        const doc = getFrameDoc();
        if (!doc?.body) return;
        const model = captureInFrame('[data-testid="app"]');
        const lintIssues = Boxy.lint(model).filter(
          (i) => !baselineLintIssueKeys.has(i.category + "|" + i.selector + "|" + i.title)
        );
        renderResults(lintIssues);
        highlightElements(doc, lintIssues);
      });
      document.getElementById("btn-reset").addEventListener("click", () => {
        activeToggles.clear();
        grid.querySelectorAll(".toggle-item").forEach((el) => el.classList.remove("active"));
        baseline = null;
        loadSampleUI();
        renderResults(null);
      });
      function renderResults(issues) {
        const body = document.getElementById("results-body");
        const count = document.getElementById("results-count");
        if (!issues) {
          body.innerHTML = '<div class="results-empty"><div class="icon">&#9744;</div><p>Toggle a mutation, then click <strong>Run Boxy</strong></p></div>';
          count.textContent = "";
          return;
        }
        if (issues.length === 0) {
          body.innerHTML = '<div class="results-empty"><div class="icon" style="color:var(--green)">&#10003;</div><p>No issues found</p></div>';
          count.textContent = "0 issues";
          return;
        }
        count.textContent = issues.length + " issue" + (issues.length !== 1 ? "s" : "");
        const groups = {};
        for (const issue of issues) {
          if (!groups[issue.category]) groups[issue.category] = [];
          groups[issue.category].push(issue);
        }
        let html = "";
        for (const [category, groupIssues] of Object.entries(groups)) {
          html += '<div class="issue-group">';
          html += '<div class="issue-group-title">' + escHtml(category) + " (" + groupIssues.length + ")</div>";
          for (const issue of groupIssues) {
            html += '<div class="issue-card ' + issue.severity + '">';
            html += '<div class="issue-title"><span class="severity-dot ' + issue.severity + '"></span>' + escHtml(issue.title) + "</div>";
            html += '<div class="issue-selector">' + escHtml(issue.selector) + "</div>";
            html += '<div class="issue-detail">' + escHtml(issue.detail) + "</div>";
            if (issue.styleChanges && issue.styleChanges.length > 0) {
              html += '<div class="issue-changes">';
              html += '<div class="issue-changes-title">CSS Changes</div>';
              const shown = issue.styleChanges.slice(0, 5);
              for (const sc of shown) {
                const cls = sc.effective ? "" : " inert";
                html += '<div class="style-change' + cls + '">';
                html += '<span class="prop">' + escHtml(sc.property) + "</span>: ";
                html += '<span class="old">' + escHtml(sc.baseline) + "</span> ";
                html += '<span class="new">' + escHtml(sc.current) + "</span>";
                html += "</div>";
              }
              if (issue.styleChanges.length > 5) {
                html += '<div class="style-change inert">...and ' + (issue.styleChanges.length - 5) + " more</div>";
              }
              html += "</div>";
            }
            html += "</div>";
          }
          html += "</div>";
        }
        body.innerHTML = html;
      }
      function highlightElements(doc, issues) {
        doc.querySelectorAll(".boxy-highlight").forEach((el) => el.classList.remove("boxy-highlight"));
        const selectors = new Set(issues.map((i) => i.selector));
        for (const sel of selectors) {
          try {
            const cleanSel = sel.replace(/\[\d+\]$/, "");
            const el = doc.querySelector(cleanSel);
            if (el) el.classList.add("boxy-highlight");
          } catch {
          }
        }
      }
      function showStatus(msg) {
        const count = document.getElementById("results-count");
        count.textContent = msg;
        setTimeout(() => {
          if (count.textContent === msg) count.textContent = "";
        }, 3e3);
      }
      function escHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
    }
  });
  require_demo_app();
})();

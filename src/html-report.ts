import type { StepResult, Issue } from './types.js';

const CATEGORY_ORDER = ['CLIPPING', 'OVERLAP', 'COLLAPSED', 'OFF_SCREEN', 'SPACING', 'POSITION', 'SIZE', 'VISIBILITY'] as const;

export function generateHTMLReport(steps: StepResult[]): string {
  const totalErrors = steps.reduce((sum, s) =>
    sum + s.issues.filter(i => i.severity === 'error').length +
    (s.notices ?? []).filter(n => n.severity === 'error').length, 0);
  const totalWarnings = steps.reduce((sum, s) => sum + s.issues.filter(i => i.severity === 'warning').length, 0);
  const passed = totalErrors === 0 && totalWarnings === 0;

  const stepsHTML = steps.map(step => {
    const errors = step.issues.filter(i => i.severity === 'error').length;
    const warnings = step.issues.filter(i => i.severity === 'warning').length;
    const notices = step.notices ?? [];
    const noticeErrors = notices.filter(n => n.severity === 'error').length;
    const hasFailed = step.issues.length > 0 || noticeErrors > 0;

    const issuesHTML = hasFailed ? renderIssues(step.issues) : '';
    const noticesHTML = notices.length > 0 ? renderNotices(notices) : '';

    let screenshotHTML = '';
    if (step.baselineScreenshotPath && step.screenshotPath) {
      screenshotHTML = `
        <div class="screenshot-compare">
          <div class="screenshot-side">
            <div class="screenshot-label">Baseline</div>
            <img src="${esc(step.baselineScreenshotPath)}" alt="Baseline">
          </div>
          <div class="screenshot-side">
            <div class="screenshot-label">Current</div>
            <img src="${esc(step.screenshotPath)}" alt="Current">
          </div>
        </div>`;
    } else if (step.screenshotPath) {
      screenshotHTML = `<div class="screenshot"><img src="${esc(step.screenshotPath)}" alt="Screenshot"></div>`;
    }

    return `
      <div class="step ${hasFailed ? 'failed' : 'passed'}">
        <div class="step-header">
          <span class="step-icon">${hasFailed ? '✗' : '✓'}</span>
          <span class="step-name">${esc(step.name)}</span>
          ${hasFailed || notices.length > 0 ? `<span class="step-count">${errors + noticeErrors} errors, ${warnings} warnings, ${notices.length} notices</span>` : ''}
        </div>
        ${screenshotHTML}
        ${noticesHTML}
        ${issuesHTML}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Layout Lint Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px}
.header{max-width:1000px;margin:0 auto 24px;display:flex;align-items:center;gap:16px}
.header h1{font-size:22px;color:white}
.badge{padding:4px 12px;border-radius:9999px;font-size:13px;font-weight:600}
.badge.pass{background:#166534;color:#bbf7d0}
.badge.fail{background:#991b1b;color:#fecaca}
.summary{max-width:1000px;margin:0 auto 24px;display:flex;gap:12px}
.stat-card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 20px;flex:1;text-align:center}
.stat-card .val{font-size:28px;font-weight:700}
.stat-card .lbl{font-size:11px;color:#94a3b8;margin-top:2px}
.val.err{color:#f87171}.val.warn{color:#fbbf24}.val.ok{color:#4ade80}.val.n{color:#60a5fa}
.steps{max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.step{background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden}
.step.failed{border-color:#dc2626}.step.passed{border-color:#16a34a}
.step-header{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #334155}
.step-icon{font-size:16px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:bold}
.step.passed .step-icon{background:#166534;color:#4ade80}
.step.failed .step-icon{background:#991b1b;color:#f87171}
.step-name{font-size:14px;font-weight:600;color:white}
.step-count{margin-left:auto;font-size:12px;color:#f87171;background:#450a0a;padding:3px 8px;border-radius:4px}
.screenshot{padding:16px}
.screenshot img{width:100%;border-radius:6px;border:1px solid #334155}
.screenshot-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}
.screenshot-side{position:relative}
.screenshot-side img{width:100%;border-radius:6px;border:1px solid #334155}
.screenshot-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:6px;text-align:center}
.issues{padding:16px 20px}
.issue-group{margin-bottom:12px}
.issue-cat{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;padding:3px 6px;background:#0f172a;border-radius:3px;display:inline-block}
.issue{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #1e293b}
.issue:last-child{border-bottom:none}
.issue-icon{font-size:13px;flex-shrink:0;margin-top:1px}
.issue.error .issue-icon{color:#f87171}
.issue.warning .issue-icon{color:#fbbf24}
.issue-body{flex:1;min-width:0}
.issue-title{font-size:13px;font-weight:600;color:white}
.issue-sel{font-size:11px;color:#60a5fa;font-family:'JetBrains Mono',monospace;word-break:break-all;margin:2px 0}
.issue-detail{font-size:11px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:pre-wrap;line-height:1.5}
.notices{padding:16px 20px;border-bottom:1px solid #334155}
.notice{padding:8px 0}
.notice-title{font-size:13px;font-weight:600;color:white}
.notice.error .notice-title{color:#f87171}
.notice.info .notice-title{color:#60a5fa}
.notice-detail{font-size:11px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:pre-wrap;line-height:1.5;margin-top:3px}
</style>
</head>
<body>
<div class="header">
  <h1>Layout Lint Report</h1>
  <span class="badge ${passed ? 'pass' : 'fail'}">${passed ? '✓ Passed' : '✗ Failed'}</span>
</div>
<div class="summary">
  <div class="stat-card"><div class="val n">${steps.length}</div><div class="lbl">Steps</div></div>
  <div class="stat-card"><div class="val err">${totalErrors}</div><div class="lbl">Errors</div></div>
  <div class="stat-card"><div class="val warn">${totalWarnings}</div><div class="lbl">Warnings</div></div>
  <div class="stat-card"><div class="val ${passed ? 'ok' : 'err'}">${passed ? 'PASS' : 'FAIL'}</div><div class="lbl">Result</div></div>
</div>
<div class="steps">${stepsHTML}</div>
</body>
</html>`;
}

function renderNotices(notices: NonNullable<StepResult['notices']>): string {
  return '<div class="notices">' + notices.map(notice => `
    <div class="notice ${notice.severity === 'error' ? 'error' : 'info'}">
      <div class="notice-title">${esc(notice.title)}</div>
      <div class="notice-detail">${esc(notice.detail)}</div>
    </div>`).join('') + '</div>';
}

function renderIssues(issues: Issue[]): string {
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (!grouped.has(issue.category)) grouped.set(issue.category, []);
    grouped.get(issue.category)!.push(issue);
  }

  return '<div class="issues">' + CATEGORY_ORDER
    .filter(cat => grouped.has(cat))
    .map(cat => {
      const items = grouped.get(cat)!;
      return `<div class="issue-group">
        <div class="issue-cat">${cat}</div>
        ${items.map(item => `
          <div class="issue ${item.severity}">
            <span class="issue-icon">${item.severity === 'error' ? '✗' : '⚠'}</span>
            <div class="issue-body">
              <div class="issue-title">${esc(item.title)}</div>
              <div class="issue-sel">${esc(item.selector)}</div>
              <div class="issue-detail">${esc(item.detail)}</div>
            </div>
          </div>`).join('')}
      </div>`;
    }).join('') + '</div>';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBoxy } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = process.argv.includes('--broken');
const HEADED = process.argv.includes('--headed');

const tableOverflow = BROKEN ? 'overflow: auto;' : '';
const actionDropdownPos = BROKEN ? 'top: calc(100% + 4px);' : 'bottom: calc(100% + 4px);';

const PAGE_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Inter, system-ui, sans-serif; background: #f8fafc; padding: 24px; }
  .header { margin-bottom: 24px; }
  .header h1 { font-size: 24px; color: #0f172a; }
  .header p { color: #64748b; margin-top: 4px; font-size: 14px; }
  .wrapper { background: white; border-radius: 12px; border: 1px solid #e2e8f0; position: relative; ${tableOverflow} }
  .toolbar { display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid #e2e8f0; }
  .toolbar-label { font-size: 14px; font-weight: 600; color: #334155; }
  .filter-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; font-size: 13px; color: #475569; cursor: pointer; position: relative; }
  .dropdown { position: absolute; top: calc(100% + 4px); left: 0; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px; min-width: 180px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 100; display: none; }
  .dropdown.open { display: block; }
  .dropdown label { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 4px; font-size: 13px; color: #334155; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 12px 16px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  td { padding: 12px 16px; font-size: 14px; color: #334155; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 500; }
  .badge-active { background: #dcfce7; color: #166534; }
  .badge-inactive { background: #fee2e2; color: #991b1b; }
  .action-wrapper { position: relative; }
  .action-btn { padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 4px; background: white; cursor: pointer; font-size: 18px; color: #64748b; }
  .action-dropdown { position: absolute; ${actionDropdownPos} right: 0; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px; min-width: 150px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 100; display: none; }
  .action-dropdown.open { display: block; }
  .action-dropdown a { display: block; padding: 8px 12px; border-radius: 4px; font-size: 13px; color: #334155; text-decoration: none; }
  .action-dropdown a.danger { color: #dc2626; }
</style></head><body>
<div class="header"><h1>Users</h1><p>Manage your team members and their account permissions.</p></div>
<div class="wrapper" data-testid="users-table">
  <div class="toolbar">
    <span class="toolbar-label">Filters:</span>
    <div class="filter-btn" data-testid="filter-status">Status ▾
      <div class="dropdown" data-testid="filter-dropdown">
        <label><input type="checkbox" checked> Active</label>
        <label><input type="checkbox" checked> Inactive</label>
        <label><input type="checkbox"> Pending</label>
      </div>
    </div>
  </div>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th style="width:80px">Actions</th></tr></thead>
    <tbody>
      <tr><td>Alice Johnson</td><td>alice@example.com</td><td>Admin</td><td><span class="badge badge-active">Active</span></td><td><div class="action-wrapper"><button class="action-btn" data-testid="action-btn-0">⋯</button><div class="action-dropdown" data-testid="action-menu-0"><a href="#">Edit</a><a href="#">Permissions</a><a href="#" class="danger">Remove</a></div></div></td></tr>
      <tr><td>Bob Smith</td><td>bob@example.com</td><td>Editor</td><td><span class="badge badge-active">Active</span></td><td><div class="action-wrapper"><button class="action-btn" data-testid="action-btn-1">⋯</button><div class="action-dropdown" data-testid="action-menu-1"><a href="#">Edit</a><a href="#">Permissions</a><a href="#" class="danger">Remove</a></div></div></td></tr>
      <tr><td>Carol Williams</td><td>carol@example.com</td><td>Viewer</td><td><span class="badge badge-inactive">Inactive</span></td><td><div class="action-wrapper"><button class="action-btn" data-testid="action-btn-2">⋯</button><div class="action-dropdown" data-testid="action-menu-2"><a href="#">Edit</a><a href="#">Permissions</a><a href="#" class="danger">Remove</a></div></div></td></tr>
      <tr><td>Eve Davis</td><td>eve@example.com</td><td>Admin</td><td><span class="badge badge-active">Active</span></td><td><div class="action-wrapper"><button class="action-btn" data-testid="action-btn-3">⋯</button><div class="action-dropdown" data-testid="action-menu-3"><a href="#">Edit</a><a href="#">Permissions</a><a href="#" class="danger">Remove</a></div></div></td></tr>
    </tbody>
  </table>
</div>
<script>
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dd = btn.querySelector('.dropdown');
      dd.classList.toggle('open');
    });
  });
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.action-dropdown').forEach(d => d.classList.remove('open'));
      btn.parentElement.querySelector('.action-dropdown').classList.add('open');
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown, .action-dropdown').forEach(d => d.classList.remove('open'));
  });
</script>
</body></html>`;

async function run() {
  const mode = BROKEN ? 'BROKEN' : 'GOOD';
  console.log(`\n  Layout Linter Test (${mode} mode)\n`);

  let browser;
  try {
    browser = await chromium.launch({ headless: !HEADED });
  } catch (error) {
    if (isSandboxedChromiumLaunchError(error)) {
      console.warn('  Skipping browser smoke test: Chromium cannot launch in this sandboxed shell.');
      return;
    }
    throw error;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.setContent(PAGE_HTML);

  const boxy = createBoxy({
    snapshotDir: path.join(__dirname, '..', '.boxy'),
    allowMissingBaseline: true,
  });

  // Step 1: Page loaded
  console.log('  → Step 1: Page loaded');
  await boxy.capture(page, { name: 'users-table', scope: '[data-testid="users-table"]' });

  // Step 2: Open filter dropdown
  console.log('  → Step 2: Click filter');
  await page.click('[data-testid="filter-status"]');
  await page.waitForTimeout(100);
  await boxy.capture(page, { name: 'filter-open', scope: '[data-testid="users-table"]' });

  // Step 3: Close filter, open last row action menu
  console.log('  → Step 3: Click action menu (last row)');
  await page.click('body');
  await page.waitForTimeout(100);
  await page.click('[data-testid="action-btn-3"]');
  await page.waitForTimeout(100);
  await boxy.capture(page, { name: 'action-menu-open', scope: '[data-testid="users-table"]' });

  await browser.close();

  // Report
  const exitCode = boxy.report();
  const reportPath = boxy.writeHTMLReport();
  console.log(`  HTML report: ${reportPath}\n`);

  process.exit(exitCode);
}

function isSandboxedChromiumLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('MachPortRendezvousServer') && message.includes('Permission denied');
}

run().catch(e => { console.error(e); process.exit(1); });

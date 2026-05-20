import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';
import type { CaptureResult, StepResult, LinterConfig, SpatialModel, StyleChange, CausationResult, Issue, StepNotice } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { capture as captureModel } from './capture.js';
import { lint } from './linter.js';
import { compare } from './regression.js';
import { printReport, printCausationReport } from './reporter.js';
import { generateHTMLReport } from './html-report.js';
import { analyzeCausation } from './causation.js';

export type { CaptureResult, StepResult, LinterConfig, SpatialModel, StyleChange, CausationResult };
export { lint, compare, printReport, printCausationReport, generateHTMLReport, analyzeCausation };

const DEFAULT_SNAPSHOT_DIR = '.boxy';

interface BoxyOptions {
  snapshotDir?: string;
  config?: Partial<LinterConfig>;
  update?: boolean;
  allowMissingBaseline?: boolean;
  acceptNewBaselines?: boolean;
}

function validateCaptureName(name: string): void {
  if (name.length === 0) {
    throw new Error('Invalid capture name: name must not be empty.');
  }

  if (path.isAbsolute(name) || path.win32.isAbsolute(name)) {
    throw new Error(`Invalid capture name "${name}": absolute paths are not allowed.`);
  }

  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid capture name "${name}": path separators are not allowed.`);
  }

  if (name.includes('..')) {
    throw new Error(`Invalid capture name "${name}": ".." sequences are not allowed.`);
  }
}

/**
 * Create a Boxy instance for use in Playwright tests.
 */
export function createBoxy(options: BoxyOptions = {}) {
  const snapshotDir = options.snapshotDir || DEFAULT_SNAPSHOT_DIR;
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const isUpdate = options.update ?? process.env.LAYOUT_UPDATE === 'true';
  const allowMissingBaseline = options.allowMissingBaseline ?? true;
  const acceptNewBaselines = options.acceptNewBaselines ?? process.env.LAYOUT_INIT === 'true';

  const baselineDir = path.join(snapshotDir, 'baseline');
  const currentDir = path.join(snapshotDir, 'current');
  const steps: StepResult[] = [];
  const stepScopes = new Map<string, string>();

  // Ensure dirs exist
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.mkdirSync(currentDir, { recursive: true });

  return {
    /**
     * Capture the spatial model at this point in the test.
     */
    async capture(page: Page, { name, scope = 'body', update }: { name: string; scope?: string; update?: boolean }): Promise<StepResult> {
      validateCaptureName(name);

      const result = await captureModel(page, { name, scope });
      const issues: Issue[] = [];
      const notices: StepNotice[] = [];

      // Always run linter
      const lintIssues = lint(result.model, config);
      issues.push(...lintIssues);

      const baselinePath = path.join(baselineDir, `${name}.json`);
      const baselineExists = fs.existsSync(baselinePath);
      const shouldUpdate = update ?? isUpdate;
      const writeBaseline = () => {
        fs.writeFileSync(baselinePath, JSON.stringify(result.model, null, 2));
        if (result.screenshot) {
          fs.writeFileSync(path.join(baselineDir, `${name}.png`), result.screenshot);
        }
      };

      if (!baselineExists) {
        if (!allowMissingBaseline) {
          throw new Error(
            `Missing layout baseline for "${name}" at ${baselinePath}. ` +
            'Run tests once to auto-save baselines, or set allowMissingBaseline: true.'
          );
        }

        // Auto-save current as baseline
        writeBaseline();
        notices.push({
          type: 'baseline-created',
          severity: acceptNewBaselines ? 'info' : 'error',
          title: 'Baseline created',
          detail: acceptNewBaselines
            ? `No existing baseline was found for "${name}", so the current layout was saved as the baseline without a regression comparison.`
            : `No existing baseline was found for "${name}", so the current layout was saved as the baseline without a regression comparison. Treating this as a failure; set LAYOUT_INIT=true or acceptNewBaselines: true for an intentional setup run.`,
        });
      } else {
        if (shouldUpdate) {
          // Overwrite baseline with current
          writeBaseline();
          notices.push({
            type: 'baseline-updated',
            severity: 'info',
            title: 'Baseline updated',
            detail: `The baseline for "${name}" was updated from the current layout; regression differences against the previous baseline were not recorded as failures.`,
          });
        } else {
          // Baseline exists — compare against it
          const baselineModel = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as SpatialModel;
          const regressionIssues = compare(baselineModel, result.model, config);
          issues.push(...regressionIssues);

          // Save current screenshot for report (no .json)
          if (result.screenshot) {
            fs.writeFileSync(path.join(currentDir, `${name}.png`), result.screenshot);
          }
        }
      }

      const hasComparison = baselineExists && !shouldUpdate;
      const step: StepResult = {
        name,
        issues,
        notices,
        screenshotPath: result.screenshot
          ? (shouldUpdate || !baselineExists ? `baseline/${name}.png` : `current/${name}.png`)
          : undefined,
        baselineScreenshotPath: hasComparison && fs.existsSync(path.join(baselineDir, `${name}.png`))
          ? `baseline/${name}.png`
          : undefined,
      };

      steps.push(step);
      stepScopes.set(name, scope);
      return step;
    },

    /**
     * Delete a specific baseline (.json + .png).
     */
    resetBaseline(name: string): void {
      validateCaptureName(name);
      const jsonPath = path.join(baselineDir, `${name}.json`);
      const pngPath = path.join(baselineDir, `${name}.png`);
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
      if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
    },

    /**
     * Delete all baselines and current snapshots, recreate empty dirs.
     */
    resetAllBaselines(): void {
      fs.rmSync(baselineDir, { recursive: true, force: true });
      fs.rmSync(currentDir, { recursive: true, force: true });
      fs.mkdirSync(baselineDir, { recursive: true });
      fs.mkdirSync(currentDir, { recursive: true });
    },

    /**
     * Print results to terminal and return exit code.
     */
    report(): number {
      return printReport(steps);
    },

    /**
     * Generate HTML report file.
     */
    writeHTMLReport(outputPath?: string): string {
      const reportPath = outputPath || path.join(snapshotDir, 'report.html');
      const html = generateHTMLReport(steps);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, html);
      return reportPath;
    },

    /**
     * Get all step results.
     */
    getSteps(): StepResult[] {
      return steps;
    },

    /**
     * Check if any errors were found.
     */
    hasErrors(): boolean {
      return steps.some(s =>
        s.issues.some(i => i.severity === 'error') ||
        s.notices?.some(n => n.severity === 'error')
      );
    },

    /**
     * Verify root causes by re-rendering with individual CSS changes.
     * Must be called while the page is still in the same state as the capture.
     * Returns a CausationResult for the given step.
     */
    async diagnoseCauses(page: Page, stepName: string): Promise<CausationResult | null> {
      const step = steps.find(s => s.name === stepName);
      if (!step) return null;

      // Collect all style changes from issues
      const allChanges: StyleChange[] = [];
      for (const issue of step.issues) {
        if (issue.styleChanges) allChanges.push(...issue.styleChanges);
      }
      if (allChanges.length === 0) return null;

      // Load the baseline model
      const baselinePath = path.join(baselineDir, `${stepName}.json`);
      if (!fs.existsSync(baselinePath)) return null;
      const baselineModel = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as SpatialModel;

      const scope = stepScopes.get(stepName) ?? 'body';

      return analyzeCausation(page, scope, baselineModel, allChanges);
    },
  };
}

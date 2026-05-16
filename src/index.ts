import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';
import type { CaptureResult, StepResult, LinterConfig, SpatialModel, StyleChange, CausationResult } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { capture as captureModel } from './capture.js';
import { lint } from './linter.js';
import { compare } from './regression.js';
import { printReport, printCausationReport } from './reporter.js';
import { generateHTMLReport } from './html-report.js';
import { analyzeCausation } from './causation.js';

export type { CaptureResult, StepResult, LinterConfig, SpatialModel, StyleChange, CausationResult };
export { lint, compare, printReport, printCausationReport, generateHTMLReport, analyzeCausation };

const DEFAULT_SNAPSHOT_DIR = '.layout-snapshots';

interface BoxyOptions {
  snapshotDir?: string;
  config?: Partial<LinterConfig>;
  baseline?: boolean;
  allowMissingBaseline?: boolean;
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
  const isBaseline = options.baseline ?? process.env.LAYOUT_BASELINE === 'true';
  const allowMissingBaseline = options.allowMissingBaseline ?? false;

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
    async capture(page: Page, { name, scope = 'body' }: { name: string; scope?: string }): Promise<StepResult> {
      validateCaptureName(name);

      const result = await captureModel(page, { name, scope });
      const issues = [];

      // Always run linter (no baseline needed)
      const lintIssues = lint(result.model, config);
      issues.push(...lintIssues);

      if (isBaseline) {
        // Save as baseline
        const modelPath = path.join(baselineDir, `${name}.json`);
        fs.writeFileSync(modelPath, JSON.stringify(result.model, null, 2));

        if (result.screenshot) {
          fs.writeFileSync(path.join(baselineDir, `${name}.png`), result.screenshot);
        }
      } else {
        // Save current
        const modelPath = path.join(currentDir, `${name}.json`);
        fs.writeFileSync(modelPath, JSON.stringify(result.model, null, 2));

        if (result.screenshot) {
          fs.writeFileSync(path.join(currentDir, `${name}.png`), result.screenshot);
        }

        // Compare against baseline if it exists
        const baselinePath = path.join(baselineDir, `${name}.json`);
        if (fs.existsSync(baselinePath)) {
          const baselineModel = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as SpatialModel;
          const regressionIssues = compare(baselineModel, result.model, config);
          issues.push(...regressionIssues);
        } else if (!allowMissingBaseline) {
          throw new Error(
            `Missing layout baseline for "${name}" at ${baselinePath}. ` +
            'Run in baseline mode first or set allowMissingBaseline: true to skip regression comparison.'
          );
        }
      }

      const screenshotPath = isBaseline
        ? path.join(baselineDir, `${name}.png`)
        : path.join(currentDir, `${name}.png`);

      const step: StepResult = {
        name,
        issues,
        screenshotPath: result.screenshot
          ? (isBaseline ? `baseline/${name}.png` : `current/${name}.png`)
          : undefined,
      };

      steps.push(step);
      stepScopes.set(name, scope);
      return step;
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
      return steps.some(s => s.issues.some(i => i.severity === 'error'));
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

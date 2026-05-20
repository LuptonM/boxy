import type { StepResult, Issue, StyleChange, CausationResult } from './types.js';

const CATEGORY_ORDER = ['CLIPPING', 'OVERLAP', 'COLLAPSED', 'OFF_SCREEN', 'SPACING', 'POSITION', 'SIZE', 'VISIBILITY'] as const;

export function printReport(steps: StepResult[]): number {
  let totalErrors = 0;
  let totalWarnings = 0;

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│              Layout Lint Results                        │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  for (const step of steps) {
    const errors = step.issues.filter(i => i.severity === 'error').length;
    const warnings = step.issues.filter(i => i.severity === 'warning').length;
    const notices = step.notices ?? [];
    const noticeErrors = notices.filter(n => n.severity === 'error').length;
    totalErrors += errors + noticeErrors;
    totalWarnings += warnings;

    if (step.issues.length === 0 && notices.length === 0) {
      console.log(`  ✓ ${step.name}`);
      continue;
    }

    const statusIcon = errors > 0 || noticeErrors > 0 ? '✗' : warnings > 0 ? '⚠' : 'ⓘ';
    const errorLabel = noticeErrors > 0 ? `${errors} errors, ${noticeErrors} baseline failures` : `${errors} errors`;
    console.log(`  ${statusIcon} ${step.name} (${errorLabel}, ${warnings} warnings, ${notices.length} notices)`);

    if (notices.length > 0) {
      console.log(`\n    ┌ BASELINE`);
      for (const notice of notices) {
        const icon = notice.severity === 'error' ? '✗' : 'ⓘ';
        const indented = notice.detail.split('\n').map(l => `    │     ${l}`).join('\n');
        console.log(`    │ ${icon} ${notice.title}`);
        console.log(indented);
      }
      console.log('    └');
    }

    // Print issues grouped by category
    const grouped = groupByCategory(step.issues);
    for (const cat of CATEGORY_ORDER) {
      const items = grouped.get(cat);
      if (!items) continue;

      console.log(`\n    ┌ ${cat}`);
      for (const item of items) {
        const icon = item.severity === 'error' ? '✗' : '⚠';
        const indented = item.detail.split('\n').map(l => `    │     ${l}`).join('\n');
        console.log(`    │ ${icon} ${item.title}`);
        console.log(`    │   ${item.selector}`);
        console.log(indented);
        if (item.affectedChildren && item.affectedChildren.length > 0) {
          console.log(`    │   also affects ${item.affectedChildren.length} children:`);
          for (const child of item.affectedChildren) {
            console.log(`    │     ├ ${child}`);
          }
        }
      }
      console.log('    └');
    }

    // Collect and dedupe all style changes across issues in this step
    const allChanges = collectUniqueStyleChanges(step.issues);
    const hasVerified = allChanges.some(sc => sc.verified !== undefined);

    if (hasVerified) {
      // Causation analysis was run — show verified results
      const verified = allChanges.filter(sc => sc.verified === true);
      const noImpact = allChanges.filter(sc => sc.verified === false);
      const unverified = allChanges.filter(sc => sc.verified === undefined && sc.effective);

      if (verified.length > 0) {
        console.log(`\n    ┌ ROOT CAUSE (verified)`);
        for (const sc of verified) {
          console.log(`    │ ${sc.selector}`);
          console.log(`    │   ${sc.property}: ${sc.baseline} → ${sc.current}`);
          if (sc.impactSummary) {
            console.log(`    │     → ${sc.impactSummary}`);
          }
        }
        console.log('    └');
      }

      if (noImpact.length > 0) {
        console.log(`\n    ┌ CSS CHANGES (verified no impact)`);
        for (const sc of noImpact) {
          console.log(`    │ ${sc.selector}`);
          console.log(`    │   ${sc.property}: ${sc.baseline} → ${sc.current}`);
        }
        console.log('    └');
      }

      if (unverified.length > 0) {
        console.log(`\n    ┌ CSS CHANGES (not tested)`);
        for (const sc of unverified) {
          console.log(`    │ ${sc.selector}`);
          console.log(`    │   ${sc.property}: ${sc.baseline} → ${sc.current}`);
        }
        console.log('    └');
      }
    } else {
      // No causation analysis — fall back to effective/inert heuristic
      const effective = allChanges.filter(sc => sc.effective);
      const inert = allChanges.filter(sc => !sc.effective);

      if (effective.length > 0) {
        console.log(`\n    ┌ CSS CHANGES (caused layout impact)`);
        for (const sc of effective) {
          console.log(`    │ ${sc.selector}`);
          console.log(`    │   ${sc.property}: ${sc.baseline} → ${sc.current}`);
        }
        console.log('    └');
      }

      if (inert.length > 0) {
        console.log(`\n    ┌ CSS CHANGES (no layout impact)`);
        for (const sc of inert) {
          console.log(`    │ ${sc.selector}`);
          console.log(`    │   ${sc.property}: ${sc.baseline} → ${sc.current}`);
        }
        console.log('    └');
      }
    }

    console.log('');
  }

  console.log('─────────────────────────────────────────────────────────');
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log('  ✓ No layout issues detected');
  } else {
    console.log(`  ${totalErrors > 0 ? '✗' : '⚠'} ${totalErrors} errors, ${totalWarnings} warnings`);
  }
  console.log('─────────────────────────────────────────────────────────\n');

  return totalErrors > 0 ? 1 : 0;
}

/**
 * Collect unique style changes across all issues in a step.
 * Dedupes by selector+property and groups by selector for clean output.
 */
function collectUniqueStyleChanges(issues: Issue[]): StyleChange[] {
  const seen = new Set<string>();
  const result: StyleChange[] = [];

  for (const issue of issues) {
    if (!issue.styleChanges) continue;
    for (const sc of issue.styleChanges) {
      const key = `${sc.selector}::${sc.property}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(sc);
    }
  }

  // Sort: group by selector, then by property name
  result.sort((a, b) => a.selector.localeCompare(b.selector) || a.property.localeCompare(b.property));
  return result;
}

export function printCausationReport(result: CausationResult): void {
  console.log(`\n┌─────────────────────────────────────────────────────────┐`);
  console.log(`│              Causation Analysis                         │`);
  console.log(`└─────────────────────────────────────────────────────────┘`);
  console.log(`  ${result.renders} re-renders performed\n`);

  if (result.causes.length > 0) {
    console.log(`  ┌ ROOT CAUSES (${result.causes.length} verified)`);
    for (const sc of result.causes) {
      console.log(`  │ ${sc.selector}`);
      console.log(`  │   ${sc.property}: ${sc.baseline} → ${sc.current}`);
      if (sc.impactSummary) {
        console.log(`  │     → ${sc.impactSummary}`);
      }
    }
    console.log(`  └`);
  }

  if (result.noImpact.length > 0) {
    console.log(`\n  ┌ NO IMPACT (${result.noImpact.length} verified)`);
    for (const sc of result.noImpact) {
      console.log(`  │ ${sc.selector}`);
      console.log(`  │   ${sc.property}: ${sc.baseline} → ${sc.current}`);
    }
    console.log(`  └`);
  }

  console.log('');
}

function groupByCategory(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (!map.has(issue.category)) map.set(issue.category, []);
    map.get(issue.category)!.push(issue);
  }
  return map;
}

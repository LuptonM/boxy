import type { Page } from 'playwright';
import type { CaptureResult, SpatialModel } from './types.js';
import { captureScope } from './capture.lib.js';

export async function capture(
  page: Page,
  { name, scope = 'body' }: { name: string; scope?: string }
): Promise<CaptureResult> {
  const elementCount = await page.locator(scope).count();
  if (elementCount === 0) {
    throw new Error(`Scope selector "${scope}" was not found while capturing "${name}".`);
  }

  const element = page.locator(scope).first();
  const screenshot = await element.screenshot().catch(() => null);

  // captureScope is self-contained (all helpers nested inside) so Playwright
  // can serialize it directly — no code duplication needed.
  const model = await page.evaluate(captureScope, scope) as SpatialModel;

  return { name, scope, model, screenshot };
}

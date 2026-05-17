/**
 * Browser entry point — exports Boxy's core analysis for in-page use.
 * No Playwright dependency. Built into docs/demo.js as an IIFE.
 */

export { captureScope as captureFromElement } from './capture.lib.js';
export { lint } from './linter.js';
export { compare } from './regression.js';
export type { SpatialModel, Issue, StyleChange, LinterConfig, ElementModel } from './types.js';
export { DEFAULT_CONFIG } from './types.js';

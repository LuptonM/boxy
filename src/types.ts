export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClippedEdges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ClipInfo {
  isClipped: boolean;
  clippedBy?: string;
  clippedByBox?: BoundingBox;
  clippedEdges?: ClippedEdges;
}

export interface SiblingSpacing {
  previousGap: number | null;
  nextGap: number | null;
  direction: 'horizontal' | 'vertical' | 'unknown';
}

export interface ScrollInfo {
  scrollWidth: number;
  scrollHeight: number;
  overflowX: string;
  overflowY: string;
}

export interface ElementModel {
  selector: string;
  tag: string;
  box: BoundingBox;
  zIndex: number;
  depth: number;
  position: string;
  overflow: string;
  scroll: ScrollInfo;
  clip: ClipInfo;
  siblingSpacing: SiblingSpacing;
  parentSelector: string | null;
  childCount: number;
  hasVisibleContent: boolean;
  visibility: string;
  opacity: string;
  ariaHidden: boolean;
  role: string | null;
  styles: Record<string, string>;
}

export interface SpatialModel {
  viewport: { width: number; height: number };
  url: string;
  timestamp: number;
  elements: ElementModel[];
}

export interface CaptureResult {
  name: string;
  scope: string;
  model: SpatialModel;
  screenshot: Buffer | null;
}

export interface StyleChange {
  selector: string;
  property: string;
  baseline: string;
  current: string;
  effective: boolean;
  /** Set by causation analysis — true = verified cause, false = verified no impact, undefined = not tested */
  verified?: boolean;
  /** Human-readable summary of what this change caused (e.g. "clipped 12 elements, shifted 4") */
  impactSummary?: string;
}

export interface CausationResult {
  /** Style changes verified as root causes */
  causes: StyleChange[];
  /** Style changes verified as having no impact */
  noImpact: StyleChange[];
  /** Total re-renders performed */
  renders: number;
}

export interface Issue {
  category: 'CLIPPING' | 'OVERLAP' | 'COLLAPSED' | 'OFF_SCREEN' | 'SPACING' | 'POSITION' | 'SIZE' | 'VISIBILITY';
  severity: 'error' | 'warning';
  selector: string;
  title: string;
  detail: string;
  styleChanges?: StyleChange[];
  /** Child elements affected by the same issue (e.g. children clipped by same ancestor) */
  affectedChildren?: string[];
}

export interface StepResult {
  name: string;
  issues: Issue[];
  screenshotPath?: string;
}

export interface LinterConfig {
  spacingThreshold: number;
  positionThreshold: number;
  sizeChangePercent: number;
  collapsedMinSize: number;
  ignore: string[];
}

export const DEFAULT_CONFIG: LinterConfig = {
  spacingThreshold: 4,
  positionThreshold: 20,
  sizeChangePercent: 30,
  collapsedMinSize: 5,
  ignore: [],
};

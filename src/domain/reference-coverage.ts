import type { Text } from './messages';

/** Kinds of reference sources the parser and scan understand. */
export type SourceKind = 'markdown' | 'canvas' | 'excalidraw' | 'base';

export type CoverageIssueCode =
  | 'unsupported-base-structure'
  | 'dynamic-base-expression'
  | 'invalid-base-yaml'
  | 'unsupported-inline-base'
  | 'source-read-failed'
  | 'source-budget-exceeded'
  | 'unsaved-source'
  | 'source-state-unverifiable'
  | 'base-state-capability-unsupported'
  | 'unresolved-base-target'
  | 'ambiguous-target'
  | 'host-resolution-mismatch'
  | 'source-analysis-failed';

export interface CoverageIssueLocation {
  /** UTF-16 half-open range in the original source string. */
  readonly start: number;
  readonly end: number;
  readonly fieldPath?: string;
}

/**
 * A global reference-coverage problem. Every issue described here blocks merging and deletion for
 * the whole vault; image-level read-only protection is expressed separately on Media.reasons.
 */
export interface CoverageIssue {
  readonly code: CoverageIssueCode;
  readonly source?: string;
  readonly sourceKind?: SourceKind;
  readonly location?: CoverageIssueLocation;
  readonly detail?: Text;
}

/** Stable reason text for read-only references, mapped from the owning source kind. */
export function readOnlyReason(kind: SourceKind): Text {
  if (kind === 'base')
    return 'Referenced by a Bases view. Retain this image; Bases references are read-only.';
  if (kind === 'excalidraw')
    return 'Referenced by an Excalidraw drawing. Retain this image; drawing references are read-only.';
  return 'Referenced by a read-only source. Retain this image; these references are read-only.';
}

/** Human category of an issue, independent of the specific source detail. */
export function coverageIssueReason(code: CoverageIssueCode): Text {
  switch (code) {
    case 'unsupported-base-structure':
      return 'A Bases reference source uses a configuration this version cannot verify.';
    case 'dynamic-base-expression':
      return 'A Bases formula uses a dynamic expression this version cannot verify.';
    case 'invalid-base-yaml':
      return 'A Bases YAML source could not be parsed reliably.';
    case 'unsupported-inline-base':
      return 'A Markdown or Canvas source executes a Bases code block.';
    case 'source-read-failed':
      return 'A reference source could not be read.';
    case 'source-budget-exceeded':
      return 'A reference source exceeds the processing limit.';
    case 'unsaved-source':
      return 'A reference source has unsaved changes.';
    case 'source-state-unverifiable':
      return 'An open view of a reference source cannot be verified.';
    case 'base-state-capability-unsupported':
      return 'This host cannot fully verify open Bases views.';
    case 'unresolved-base-target':
      return 'A fixed Bases image path does not resolve to one file.';
    case 'ambiguous-target':
      return 'A reference target is ambiguous.';
    case 'host-resolution-mismatch':
      return 'Obsidian resolves a reference source differently than this version.';
    case 'source-analysis-failed':
      return 'A reference source could not be analyzed.';
  }
}

/** Effective next step for an issue code. Never promises that rescanning fixes an unsupported format. */
export function coverageIssueNextStep(code: CoverageIssueCode): Text {
  switch (code) {
    case 'unsupported-base-structure':
      return 'Review the support scope. Rescanning does not make an unsupported format supported.';
    case 'dynamic-base-expression':
      return 'Open the source and review the listed field. This version does not evaluate dynamic expressions.';
    case 'invalid-base-yaml':
      return 'Fix the YAML in the source, then scan again. The plugin does not rewrite source files.';
    case 'unsupported-inline-base':
      return 'Open the source and review the executable block. This version does not analyze executable Bases blocks.';
    case 'source-read-failed':
      return 'Restore read access, then scan again.';
    case 'source-budget-exceeded':
      return 'No source is skipped to meet the limit. Review the source size and the support scope.';
    case 'unsaved-source':
      return 'Save the source, then scan again.';
    case 'source-state-unverifiable':
      return 'Save and close the listed context, then scan again.';
    case 'base-state-capability-unsupported':
      return 'Review the support scope. Closing windows or rescanning is not promised to fix this.';
    case 'unresolved-base-target':
      return 'Open the source and correct the fixed path, then scan again.';
    case 'ambiguous-target':
      return 'Make the target path explicit, then scan again.';
    case 'host-resolution-mismatch':
      return 'Stop and review the source and target differences before continuing.';
    case 'source-analysis-failed':
      return 'Review the source and scan again. Do not treat this as zero references.';
  }
}

export function makeIssue(
  code: CoverageIssueCode,
  source: string,
  sourceKind: SourceKind,
  detail: Text,
  location?: CoverageIssueLocation,
): CoverageIssue {
  return {
    code,
    source,
    sourceKind,
    ...(location ? { location } : {}),
    detail,
  };
}

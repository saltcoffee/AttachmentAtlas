import { basename } from '../domain/paths';
import { checkCancelled, yieldToHost } from './cancellation';

interface State {
  next: Map<number, number>;
  failure: number;
  output: number;
  paths: string[];
}

export interface ReferenceIndexStats {
  mode: 'indexed' | 'direct' | 'empty';
  fallbackReason: 'state-limit' | 'weight-limit' | 'pattern-limit' | 'invalid-uri' | null;
  pathCount: number;
  hintCount: number;
  stateCount: number;
  estimatedBytes: number;
  patternUnits: number;
}

const MAX_STATES = 65_536;
const MAX_WEIGHT = 32 * 1024 * 1024;
const MAX_PATTERN_UNITS = 1024 * 1024;
const CHUNK = 8192;

function state(): State {
  return { next: new Map(), failure: 0, output: 0, paths: [] };
}

async function build(
  paths: readonly string[],
  stats: ReferenceIndexStats,
  signal?: AbortSignal,
): Promise<State[] | null> {
  const states = [state()];
  stats.stateCount = 1;
  stats.estimatedBytes = 384;
  let work = 0;
  const fallback = (reason: ReferenceIndexStats['fallbackReason']) => {
    stats.mode = 'direct';
    stats.fallbackReason = reason;
    return null;
  };
  for (const path of paths) {
    checkCancelled(signal);
    let patterns: Set<string>;
    try {
      const name = basename(path),
        encodedPath = encodeURI(path);
      patterns = new Set([name, encodeURIComponent(name)]);
      // A raw path always contains its basename. An encoded path may need its own form
      // when encodeURI preserves reserved characters that encodeURIComponent escapes.
      if (![...patterns].some((pattern) => encodedPath.includes(pattern)))
        patterns.add(encodedPath);
    } catch (error) {
      // The original matcher only encodes after raw forms fail; preserve that behavior.
      if (error instanceof URIError) return fallback('invalid-uri');
      throw error;
    }
    for (const pattern of patterns) {
      stats.patternUnits += pattern.length;
      // Conservative accounting for strings, terminal path links, states, edges and BFS queue.
      stats.estimatedBytes += pattern.length * 2 + 64;
      if (stats.patternUnits > MAX_PATTERN_UNITS) return fallback('pattern-limit');
      if (stats.estimatedBytes > MAX_WEIGHT) return fallback('weight-limit');
      let current = 0;
      for (let offset = 0; offset < pattern.length; offset++) {
        const unit = pattern.charCodeAt(offset);
        let next = states[current]!.next.get(unit);
        if (next === undefined) {
          stats.estimatedBytes += 384;
          if (states.length >= MAX_STATES) return fallback('state-limit');
          if (stats.estimatedBytes > MAX_WEIGHT) return fallback('weight-limit');
          next = states.length;
          states[current]!.next.set(unit, next);
          states.push(state());
          stats.stateCount = states.length;
        }
        current = next;
        if (++work === CHUNK) {
          work = 0;
          await yieldToHost();
          checkCancelled(signal);
        }
      }
      states[current]!.paths.push(path);
    }
  }
  const queue = [0];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    for (const [unit, next] of states[current]!.next) {
      let failure = states[current]!.failure;
      while (failure && !states[failure]!.next.has(unit)) failure = states[failure]!.failure;
      const child = states[next]!;
      child.failure = current === 0 ? 0 : (states[failure]!.next.get(unit) ?? 0);
      child.output = child.paths.length ? next : states[child.failure]!.output;
      queue.push(next);
      if (++work === CHUNK) {
        work = 0;
        await yieldToHost();
        checkCancelled(signal);
      }
    }
  }
  return states;
}

/** Globally deduplicate protection across all hints in this scan. A terminal can be cleared
 * and skipped only after all its paths enter the global set; counts and positions are not tracked. */
function pendingOutput(states: State[], current: number): number {
  let output = states[current]!.output;
  while (output && states[output]!.output !== output) output = states[output]!.output;
  while (states[current]!.output !== output) {
    const next = states[current]!.output;
    states[current]!.output = output;
    current = next;
  }
  return output;
}

async function directMatch(
  paths: readonly string[],
  hints: readonly string[],
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  const protectedPaths = new Set<string>();
  let work = 0,
    checked = 0;
  for (const path of paths) {
    checkCancelled(signal);
    if (++checked === 256) {
      checked = 0;
      await yieldToHost();
      checkCancelled(signal);
    }
    for (const hint of hints) {
      if (
        hint.includes(path) ||
        hint.includes(basename(path)) ||
        hint.includes(encodeURI(path)) ||
        hint.includes(encodeURIComponent(basename(path)))
      ) {
        protectedPaths.add(path);
        break;
      }
      work += hint.length + 1;
      if (work >= CHUNK) {
        work = 0;
        await yieldToHost();
        checkCancelled(signal);
      }
    }
  }
  return protectedPaths;
}

/** Match the existing four literal substring forms in UTF-16, without joining independent hints. */
export async function protectedImagePaths(
  paths: readonly string[],
  hints: readonly string[],
  signal?: AbortSignal,
  observe?: (stats: Readonly<ReferenceIndexStats>) => void,
): Promise<ReadonlySet<string>> {
  checkCancelled(signal);
  const stats: ReferenceIndexStats = {
    mode: 'empty',
    fallbackReason: null,
    pathCount: paths.length,
    hintCount: hints.length,
    stateCount: 0,
    estimatedBytes: 0,
    patternUnits: 0,
  };
  if (!paths.length || !hints.length) {
    observe?.({ ...stats });
    return new Set();
  }
  stats.mode = 'indexed';
  const states = await build(paths, stats, signal);
  checkCancelled(signal);
  observe?.({ ...stats });
  if (!states) return directMatch(paths, hints, signal);
  const protectedPaths = new Set<string>();
  let work = 0;
  for (const hint of hints) {
    let current = 0;
    for (let offset = 0; offset < hint.length; offset++) {
      const unit = hint.charCodeAt(offset);
      while (current && !states[current]!.next.has(unit)) current = states[current]!.failure;
      current = states[current]!.next.get(unit) ?? 0;
      let output = pendingOutput(states, current);
      while (output) {
        const terminal = states[output]!;
        for (const path of terminal.paths) {
          protectedPaths.add(path);
          if (++work === CHUNK) {
            work = 0;
            await yieldToHost();
            checkCancelled(signal);
          }
        }
        terminal.paths = [];
        terminal.output = states[terminal.failure]!.output;
        output = pendingOutput(states, current);
      }
      if (++work === CHUNK) {
        work = 0;
        await yieldToHost();
        checkCancelled(signal);
      }
    }
  }
  return protectedPaths;
}

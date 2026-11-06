import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { parseArgs } from 'node:util';
import { cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  createPerformanceFixture,
  performanceSamples,
  selectionForFixture,
} from './performance-fixture.mjs';
import { freezePerformanceBaseline, loadPerformanceModule } from './performance-module.mjs';
import { requireCompletedResult } from './benchmark-result.mjs';

const { AbortController } = globalThis;

export function performanceOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      freeze: { type: 'boolean', default: false },
      sample: { type: 'string', default: 'B18-S1K' },
      task: { type: 'string', default: 'scan' },
      count: { type: 'string', default: '20' },
      mode: { type: 'string', default: 'refresh' },
      implementation: { type: 'string', default: 'current' },
      repetitions: { type: 'string', default: '1' },
      'timeout-ms': { type: 'string', default: '60000' },
    },
  });
  const result = {
    ...values,
    count: Number(values.count),
    repetitions: Number(values.repetitions),
    timeoutMs: Number(values['timeout-ms']),
  };
  assert(Object.hasOwn(performanceSamples, result.sample), 'Unknown performance sample.');
  assert(['scan', 'merge', 'recycle'].includes(result.task), 'Use --task=scan|merge|recycle.');
  assert([1, 20, 100].includes(result.count), 'Use --count=1|20|100.');
  assert(['refresh', 'full'].includes(result.mode), 'Use --mode=refresh|full.');
  assert(
    ['baseline', 'current'].includes(result.implementation),
    'Use --implementation=baseline|current.',
  );
  assert(
    Number.isInteger(result.repetitions) && result.repetitions >= 1 && result.repetitions <= 10,
    'Use --repetitions=1..10.',
  );
  assert(
    Number.isInteger(result.timeoutMs) && result.timeoutMs >= 1000 && result.timeoutMs <= 600000,
    'Use --timeout-ms=1000..600000.',
  );
  if (result.sample === 'B18-2M')
    assert(
      result.task !== 'recycle' && (result.task === 'scan' || result.count === 20),
      'B18-2M supports scanning or a 20-copy merge.',
    );
  return result;
}

export function summarizePerformance(rows) {
  const completed = rows.filter((row) => row.outcome === 'completed');
  if (!completed.length) return { successfulRounds: 0, timing: null };
  const timing = {};
  for (const key of ['scanMs', 'planMs', 'executeMs', 'totalMs']) {
    const values = completed
      .map((row) => row[key])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!values.length) {
      timing[key] = null;
      continue;
    }
    const middle = Math.floor(values.length / 2);
    timing[key] = {
      median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
      worst: values.at(-1),
    };
  }
  return { successfulRounds: completed.length, timing };
}

function observeVault(vault) {
  const methods = ['list', 'readText', 'readBinary', 'process', 'remove', 'exists'];
  const measured = { ...vault };
  for (const method of methods) {
    measured[method] = (...args) => {
      const row = globalThis.__atlasPerformance;
      const started = performance.now();
      if (row) row[`${method}Calls`]++;
      const finish = (value) => {
        if (row) {
          row[`${method}Ms`] += performance.now() - started;
          if (method === 'readText') row.sourceBytes += Buffer.byteLength(value);
          if (method === 'readBinary') row.imageBytes += value.byteLength;
        }
        return value;
      };
      const failed = (error) => {
        if (row) row[`${method}Ms`] += performance.now() - started;
        throw error;
      };
      try {
        const value = vault[method].apply(measured, args);
        return value?.then ? value.then(finish, failed) : finish(value);
      } catch (error) {
        return failed(error);
      }
    };
  }
  return measured;
}

async function measure(action, phases, name) {
  const row = {
    parseCalls: 0,
    parseMs: 0,
    digestCalls: 0,
    digestMs: 0,
    sourceBytes: 0,
    imageBytes: 0,
    referenceIndex: null,
  };
  for (const method of ['list', 'readText', 'readBinary', 'process', 'remove', 'exists']) {
    row[`${method}Calls`] = 0;
    row[`${method}Ms`] = 0;
  }
  globalThis.__atlasPerformance = row;
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  try {
    return await action();
  } finally {
    row.wallMs = performance.now() - started;
    row.cpuMicroseconds = process.cpuUsage(cpuStarted);
    row.memoryAfter = process.memoryUsage();
    phases[name] = row;
    delete globalThis.__atlasPerformance;
  }
}

export async function runPerformance(options) {
  if (options.freeze) {
    console.log(JSON.stringify(await freezePerformanceBaseline(), null, 2));
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let fixture,
    report,
    path,
    reportCreated = false,
    result;
  const errors = [];
  try {
    const { api, metadata } = await loadPerformanceModule(options.implementation);
    fixture = await createPerformanceFixture(options.sample, controller.signal);
    const vault = observeVault(fixture.vault);
    report = {
      schema: 1,
      state: 'running',
      measuredAt: new Date().toISOString(),
      options,
      source: metadata,
      environment: {
        node: process.version,
        system: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model,
        memoryBytes: totalmem(),
      },
      fixture: { root: fixture.root, ...fixture.inventory },
      observation: fixture.observation,
      cleanup: { state: 'pending' },
      cache:
        'Warm filesystem cache after fixture creation. The frozen revision has no analysis cache; refresh and full both read all files.',
      scope:
        'Node application functions only. No Obsidian UI, metadataCache, Worker messaging or native FileManager costs. Parse and digest wrappers add the same observation overhead to each tested revision. memoryAfter includes the fixture harness and is not a plugin memory peak.',
      stages: {
        scan: 'measured',
        plan: options.task === 'scan' ? 'not-applicable' : 'application function only',
        preview: options.task === 'merge' ? 'native UI not measured' : 'not-applicable',
        execute: options.task === 'scan' ? 'not-applicable' : 'measured',
      },
      unavailable: [
        'native-ui',
        'native-worker-transfer',
        'native-file-manager',
        'buffer-reservation-peak',
        'separate-association-cpu',
      ],
      measurements: [],
    };
    await mkdir('artifacts', { recursive: true });
    path = `artifacts/v0.1.8-${options.implementation}-${report.measuredAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    reportCreated = true;
    console.log(`Temporary fixture: ${fixture.root}\nReport: ${path}`);
    let failed = false;
    for (let repeat = 1; repeat <= options.repetitions; repeat++) {
      await fixture.restore();
      let deadlineReached = false;
      const timer = setTimeout(() => {
        deadlineReached = true;
        controller.abort();
      }, options.timeoutMs);
      const phases = {},
        row = {
          repeat,
          outcome: 'failed',
          phases,
          scanMs: null,
          planMs: null,
          executeMs: null,
          totalMs: null,
        };
      const started = performance.now();
      try {
        const snapshot = await measure(
          () =>
            api.scan(vault, api.digest, {
              revision: 1,
              settings: api.DEFAULT_SETTINGS,
              mode: options.mode,
              signal: controller.signal,
              referenceIndexStats: (stats) => {
                globalThis.__atlasPerformance.referenceIndex = stats;
              },
            }),
          phases,
          'scan',
        );
        assert.equal(snapshot.blockers.length, 0, 'Fixture reference coverage is incomplete.');
        assert.equal(snapshot.media.length, fixture.inventory.images);
        assert(
          snapshot.media.every((image) => image.digest && !image.reasons.length),
          'Fixture image analysis failed.',
        );
        row.scanMs = phases.scan.wallMs;
        if (options.task !== 'scan') {
          const selection = selectionForFixture(fixture, options.task, options.count);
          if (selection.kind === 'merge-exact')
            for (const group of selection.groups) {
              const keep = snapshot.media.find((image) => image.path === group.keepPath);
              group.groupKey = `${keep.size}:${keep.digest}`;
            }
          const plan = await measure(() => api.buildPlan(snapshot, selection), phases, 'plan');
          row.planMs = phases.plan.wallMs;
          const result = await measure(
            () =>
              new api.OperationService(vault, api.digest).execute(
                plan,
                snapshot,
                controller.signal,
              ),
            phases,
            'execute',
          );
          row.executeMs = phases.execute.wallMs;
          row.result = result;
          requireCompletedResult(result);
          clearTimeout(timer);
          row.totalMs = performance.now() - started;
          const verificationStart = performance.now();
          await fixture.verify(plan);
          row.harnessVerificationMs = performance.now() - verificationStart;
        } else row.totalMs = performance.now() - started;
        assert(
          row.totalMs <= options.timeoutMs && !controller.signal.aborted,
          'Benchmark deadline exceeded.',
        );
        row.outcome = 'completed';
      } catch (error) {
        row.outcome = 'failed';
        row.deadlineReached = deadlineReached;
        row.cancellationRequested = controller.signal.aborted;
        row.issue = error.message;
        row.observedMs = performance.now() - started;
        failed = true;
      } finally {
        clearTimeout(timer);
      }
      report.measurements.push(row);
      report.summary = summarizePerformance(report.measurements);
      report.state = failed ? 'failed' : repeat === options.repetitions ? 'completed' : 'running';
      if (report.state !== 'running') report.finishedAt = new Date().toISOString();
      await writeFile(path, JSON.stringify(report, null, 2) + '\n');
      console.log(
        JSON.stringify({
          repeat,
          outcome: row.outcome,
          scanMs: row.scanMs,
          planMs: row.planMs,
          executeMs: row.executeMs,
          totalMs: row.totalMs,
          executionTextReads: phases.execute?.readTextCalls,
          executionBinaryReads: phases.execute?.readBinaryCalls,
          issue: row.issue,
        }),
      );
      if (failed) break;
    }
    if (failed) throw new Error(`Benchmark did not complete successfully. Inspect ${path}`);
    result = { report, path };
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await fixture?.dispose();
      if (report) report.cleanup = { state: 'removed' };
    } catch (error) {
      errors.push(error);
      if (report) report.cleanup = { state: 'failed', issue: error.message };
    }
    try {
      if (reportCreated) await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    } catch (error) {
      errors.push(error);
    }
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Benchmark and cleanup failed.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runPerformance(performanceOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

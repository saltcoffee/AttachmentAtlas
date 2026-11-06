# Performance measurements

Run a single explicit workload with the current source:

```sh
npm run bench:perf -- --sample=B18-S1K --task=scan --repetitions=3
npm run bench:perf -- --sample=B18-L10K --task=scan --repetitions=3 --timeout-ms=180000
```

The default is one thousand-image scan, not a full matrix. Merge and recycle accept `--count=1|20|100`. All generated images and documents are synthetic. Each invocation creates one temporary vault, reuses it between rounds, and removes it after success, failure, timeout, SIGINT, or SIGTERM. Partial fixture generation is also cleaned up. Tests use the same cleanup policy. There is no keep-fixture option.

Cleanup removes explicit files and empty directories individually and does not follow symlinks. It is outside measured application time. The JSON report records `cleanup.state`; cleanup failure exits nonzero. Forced process termination or a machine crash can prevent cleanup.

Raw reports and frozen local bundles remain in the ignored `artifacts/` directory. Fixture paths in those reports are temporary locators and will no longer exist after cleanup. Reports retain the sample specification and deterministic inventory digest; they do not retain image bytes or source documents.

The scan phase reports `referenceIndex.mode` (`indexed`, `direct`, or `empty`), `fallbackReason`, path/hint counts, state count, pattern units, and estimated bytes. Reasons distinguish state, weight, pattern, and URI limits. The estimate is not a heap peak. Older baselines without this observation hook report null; their index path must not be inferred from timing alone. The native application exposes a progress message and an optional scan statistics callback, without persistent diagnostic logs.

## Evidence and reproduction

[0.1.8 scan evidence](0.1.8-scan.json) records the baseline revision, bundle and dependency SHA-256, current source/tool checksums, fixture digests, environment, commands, and individual successful rounds. These are Node application measurements with a warm filesystem cache, without Obsidian UI, Worker transfer, or FileManager costs. They do not certify native application latency or memory peaks.

The baseline is commit `b3d93813562ee848fa8156fe5a89a9f188f7a533`. To reconstruct it, use a separate clean checkout of that commit with its unchanged `src/` and `package-lock.json`, and copy the `scripts/` directory from the revision containing this benchmark. Untracked scripts are allowed; modified or untracked production source is rejected. Install locked dependencies, then run:

```sh
node scripts/benchmark-performance.mjs --freeze
node scripts/benchmark-performance.mjs --implementation=baseline --sample=B18-S1K --task=scan --repetitions=3
node scripts/benchmark-performance.mjs --implementation=baseline --sample=B18-L10K --task=scan --repetitions=3 --timeout-ms=180000
```

Back in the current checkout, run the first two commands at the top of this document. Use the same machine and environment, run workloads sequentially, and keep tests/builds out of the measurement interval. Fixture generation, restoration, verification by the harness, and cleanup are outside application timings. Verify equal sample digests, successful outcomes, source/image bytes, parser/hash counts, and index mode when comparing results. Exact timings vary between machines and runs.

`--freeze` refuses to overwrite an existing baseline. Loading a baseline checks its bundle and dependency digest and never rebuilds it from optimized current code. Source checksums in the tracked evidence identify the measured working tree even before it has a commit ID.

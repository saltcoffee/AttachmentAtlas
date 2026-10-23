# Contributing to Attachment Atlas

Thanks for helping improve reliable image management in Obsidian. The project currently has a 0.1.0 development build. Check the supported behavior in the [README](README.md) and the conventions below before changing implementation. Contributions and discussions in English or Chinese are welcome.

## Useful contributions now

- Describe concrete duplicate-image or unreferenced-image workflows.
- Provide small, synthetic examples of unusual links or Canvas references.
- Review recovery behavior, conflicts, accessibility, and performance constraints.
- Improve documentation without presenting planned features as implemented.

Use the issue templates for reproducible bugs and feature proposals. For sensitive issues, follow [SECURITY.md](SECURITY.md).

## Development status

Use Node.js 22+ and npm for plugin development; Python 3.10+ is needed for documentation checks:

```sh
npm ci
npm run check
npm run package
node scripts/dev-vault.mjs
```

`npm run dev` watches plugin sources. After changing the Worker source, restart the development build. Open the generated `dev-vault/` folder as a vault in Obsidian and enable Attachment Atlas to check the native interface. The generator preserves existing fixture edits and recovery records while refreshing the plugin files.

In that test vault, verify duplicate merging, reference updates, restoration, and recovery-area cleanup. Confirm that successful restoration removes only that operation's recovery data, while conflicts preserve later edits and recovery materials. Automated tests do not replace real-app checks of previews, confirmation, cancellation, keyboard interaction, and application restart.

For documentation only:

```sh
python3 scripts/check_docs.py
```

The documentation check validates public Markdown for UTF-8, final newlines, trailing whitespace, code-fence closure, and local inline-link targets. It rejects links to local-only planning documents. It does not fetch external links, validate heading anchors, or test plugin behavior. The full check also runs types, lint, core tests, production build, and release-structure validation.

## Implementation conventions

- Keep domain rules independent from Obsidian, storage DTOs, Worker messages, and UI models.
- Validate external data at boundaries, then convert it into independent models.
- Keep files below 600 lines; split by responsibility, not arbitrary line count.
- Add abstractions only when a second real use case requires them.
- Remove obsolete internal implementations instead of adding compatibility layers.
- Use precise source patches for links; never globally replace attachment filenames.
- Keep scanning read-only with respect to notes and attachments.
- Require explicit plans and verified recovery copies before user-content writes or recycling.
- Keep recycled resources only in `.attachment-atlas-recovery/`: verify durable copies before removing active files with `Vault.delete`; never use Obsidian or system trash.
- Manual recovery-data cleanup requires explicit permanent-deletion consent and a revalidated manifest. Verified full restoration authorizes automatic disposal of that operation only. Both paths require persisted interruption state and per-file removal, never recursive directory deletion.
- Do not add unattended expiry of unrestored resources, telemetry, or runtime dependency downloads. Disposal after a user-confirmed, fully verified restore is part of the recovery lifecycle.

## Tests and fixtures

The UI reads Obsidian's public `getLanguage()` API. Chinese locales use Simplified Chinese; all other locales use the canonical English templates. Keep translations in `src/i18n/`, route UI text through `src/ui/i18n.ts`, and use structured domain messages for dynamic diagnostics and progress. Paths and note content are literal values and must never be translated. Keep persisted operation kinds and states unchanged. Translation tests check locale fallback, placeholders, coverage, and confirmation controls.

For reference or mutation changes, include a small reproducible vault fixture and the expected final content. Cover relevant failures such as interrupted writes, storage errors, changed references, modified original images, restoration conflicts, and interrupted recovery-data cleanup. UI-only or documentation changes need proportionate verification.

Use generated assets or clearly licensed fixtures. Do not include real notes, private images, authentication data, recovery archives, user paths, or personal vault configuration. Never run failure injection against a personal vault.

## Pull requests

Explain the user-visible problem, resulting behavior, applicable support boundaries, and verification. Update the README and changelog when behavior changes. Keep unrelated cleanup out of a focused change. Follow the [pull request template](.github/pull_request_template.md).

Do not edit generated release assets as source. Maintainers decide when to commit release changes, push a version tag, and submit the plugin to the community directory. No contribution requires signing over copyright; contributed material must be compatible with the [MIT license](LICENSE), and third-party material must retain required notices.

## Publishing a release

The Release workflow runs only when a version tag such as `0.1.0` is pushed. Ordinary branch pushes and pull requests run checks. Publishing a tag authorizes automatic publication after the release checks pass.

1. Finish real-app acceptance in a separate test vault before tagging.
2. Set the same `x.y.z` version in `manifest.json` and `package.json`, keep the lockfile version consistent, and add its minimum-app-version mapping in `versions.json`. Tags have no `v` prefix, leading zeroes, or prerelease suffix.
3. Move the relevant changes out of `Unreleased` into exactly one matching heading in `CHANGELOG.md`, for example `## [0.1.0]` or `## [0.1.0] - 2026-10-22`. Include actual changes beneath it; a missing, duplicate, or empty entry stops publishing.
4. Preview the release notes and run local checks:

   ```sh
   RELEASE_TAG=0.1.0 npm run release:notes
   npm run check
   ```

   Review `build/release-notes.md`, then commit and push the prepared source changes through the normal review process.

5. When ready to publish that committed version, create and push the matching tag:

   ```sh
   git tag -a 0.1.0 -m "Release 0.1.0"
   git push origin 0.1.0
   ```

Use the intended version in place of `0.1.0`. The workflow checks the tagged source, builds once, packages the verified output, and hands an explicit artifact list to a separate publishing job. Only that job receives `contents: write`; it uses GitHub's automatic `GITHUB_TOKEN`, with no personal token required. GitHub Actions must be enabled and repository/organization policy must allow that permission and the pinned official actions.

The published release contains `main.js`, `manifest.json`, `styles.css`, and `attachment-atlas-<version>.zip`. The ZIP contains the `attachment-atlas/` installation folder with the three plugin files and license notices. The body comes from that version's changelog section. GitHub supplies the source ZIP and tarball. Local-only `docs/`, test vaults, and recovery data are excluded from the uploaded assets.

Assets are uploaded to a draft first, and the workflow publishes only after all uploads succeed. It verifies that the remote tag still resolves to the built commit, supports annotated tags, and stops if an existing release prevents creation. If an interrupted upload leaves a draft, inspect and complete that draft manually or remove that specific draft before rerunning the failed job. Do not move a published version tag; publish a new version for corrections. Creating a GitHub Release does not submit the plugin to the Obsidian community directory.

## Community

Follow the [code of conduct](CODE_OF_CONDUCT.md). Discuss the behavior and evidence, respect private data, and prefer concrete reproductions over assumptions about another person's vault.

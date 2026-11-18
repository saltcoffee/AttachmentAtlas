import { FileView, MarkdownView, TextFileView, type App } from 'obsidian';
import { basename, sourcePath } from '../domain/paths';
import { SourceStateError, message } from '../domain/messages';
import { parseSource } from '../references';
import { externalLink } from '../references/urls';

/** Inspect current public view data, including decoded Canvas strings, without source-file I/O. */
export function assertBaseContextsClosed(app: App, paths: readonly string[]): void {
  if (!paths.length) return;
  const path = paths[0]!;
  const capabilityUnsupported = () =>
    new SourceStateError(
      'base-state-capability-unsupported',
      message('This host cannot verify open Bases contexts: {path}', { path }),
    );
  const unverifiable = (hostPath: string) =>
    new SourceStateError(
      'source-state-unverifiable',
      message('Save and close the note or Canvas that embeds this Bases source: {path}', {
        path: hostPath,
      }),
    );
  try {
    const names = paths.map(basename);
    app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      const type = view.getViewType();
      const file = view instanceof FileView ? view.file : undefined;
      if (type === 'bases' || (file && paths.includes(file.path)))
        throw new SourceStateError(
          'source-state-unverifiable',
          message('Open Bases view must be saved and closed: {path}', { path: file?.path ?? path }),
        );
      if (type !== 'markdown' && type !== 'canvas') return;
      if (leaf.isDeferred) {
        const state: unknown = leaf.getViewState().state?.file;
        if (typeof state !== 'string') throw capabilityUnsupported();
        throw unverifiable(state);
      }
      // No disk fallback: a host without the public in-memory capability cannot prove closure.
      if (!(view instanceof TextFileView) || !file) throw capabilityUnsupported();
      if (view instanceof MarkdownView && view.hoverPopover) throw unverifiable(file.path);
      const text = view instanceof MarkdownView ? view.editor.getValue() : view.getViewData();
      const parsed = parseSource(file.path, text);
      if (parsed.issues.length) throw unverifiable(file.path);
      const references = parsed.references.map((ref) =>
        ref.style === 'markdown' ? decodeURIComponent(ref.linkpath) : ref.linkpath,
      );
      // A linked source can itself embed a Base. Public leaf data cannot expose that nested
      // renderer's state, so require the hosting view to close rather than guessing from disk.
      if (
        references.some(
          (value) => !externalLink(value) && (sourcePath(value) || !basename(value).includes('.')),
        )
      )
        throw unverifiable(file.path);
      // Source parsers decode Markdown destinations and JSON strings. Unknown constructs stay
      // conservative hints; they cannot establish that an embedding context is closed.
      const candidates = [...references, ...parsed.hints];
      if (
        candidates.some((value) =>
          names.some((name) => value.includes(name) || value.includes(encodeURI(name))),
        )
      )
        throw unverifiable(file.path);
    });
  } catch (error) {
    if (error instanceof SourceStateError) throw error;
    throw capabilityUnsupported();
  }
}

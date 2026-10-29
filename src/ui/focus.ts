export interface SavedFocus {
  readonly keys: readonly string[];
  readonly start?: number | null;
  readonly end?: number | null;
}

/** Capture against the owning document so organizer popout windows work as well. */
export function captureFocus(root: HTMLElement): SavedFocus | null {
  const active = root.ownerDocument.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return null;
  const keys = active.dataset.focusKey ? [active.dataset.focusKey] : [];
  for (let element: HTMLElement | null = active; element; element = element.parentElement) {
    if (element.dataset.focusFallback) keys.push(element.dataset.focusFallback);
    if (element === root) break;
  }
  const input = active.tagName === 'INPUT' ? (active as HTMLInputElement) : null;
  return { keys, start: input?.selectionStart, end: input?.selectionEnd };
}

export function restoreFocus(root: HTMLElement, saved: SavedFocus | null): void {
  if (!saved) return;
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-focus-key]')).filter(
    (element) => !('disabled' in element && element.disabled),
  );
  const target = saved.keys
    .map((key) => candidates.find((element) => element.dataset.focusKey === key))
    .find((element) => !!element);
  target?.focus();
  if (
    target?.tagName === 'INPUT' &&
    target.dataset.focusKey === saved.keys[0] &&
    saved.start != null &&
    saved.end != null
  )
    (target as HTMLInputElement).setSelectionRange(saved.start, saved.end);
}

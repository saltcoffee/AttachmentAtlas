import { describe, expect, it } from 'vitest';
import { captureFocus, restoreFocus } from '../src/ui/focus';
import { UiElement } from './ui-elements';

describe('focus restoration boundaries', () => {
  it.each([{ keys: [] }, { keys: ['missing'] }])(
    'leaves existing focus alone when no saved key matches: %j',
    ({ keys }) => {
      const root = new UiElement();
      root.createEl('button', { attr: { 'data-focus-key': 'scan' } });
      const current = root.createEl('button');
      current.focus();
      restoreFocus(root as unknown as HTMLElement, { keys });
      expect(root.ownerDocument.activeElement).toBe(current);
    },
  );

  it('uses an explicit fallback when the original control is disabled', () => {
    const root = new UiElement();
    const original = root.createEl('button', {
      attr: { 'data-focus-key': 'next', 'data-focus-fallback': 'previous' },
    });
    original.focus();
    const saved = captureFocus(root as unknown as HTMLElement);
    original.disabled = true;
    root.createEl('button', { attr: { 'data-focus-key': 'unrelated' } });
    const previous = root.createEl('button', { attr: { 'data-focus-key': 'previous' } });
    restoreFocus(root as unknown as HTMLElement, saved);
    expect(root.ownerDocument.activeElement).toBe(previous);
  });

  it('restores the input cursor using its owning document', () => {
    const root = new UiElement();
    const input = root.createEl('input', { attr: { 'data-focus-key': 'search' } });
    input.focus();
    input.setSelectionRange(2, 4);
    const saved = captureFocus(root as unknown as HTMLElement);
    root.empty();
    const replacement = root.createEl('input', { attr: { 'data-focus-key': 'search' } });
    restoreFocus(root as unknown as HTMLElement, saved);
    expect(root.ownerDocument.activeElement).toBe(replacement);
    expect([replacement.selectionStart, replacement.selectionEnd]).toEqual([2, 4]);
  });
});

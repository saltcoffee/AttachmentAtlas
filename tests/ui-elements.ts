/** Minimal rendering recorder for UI text and consent tests; it does not simulate native layout. */
export class UiElement {
  children: UiElement[] = [];
  text = '';
  value = '';
  disabled = false;
  checked = false;
  open = false;
  attrs: Record<string, string> = {};
  onclick?: () => void;
  onchange?: () => void;
  ontoggle?: () => void;
  constructor(readonly tag = 'div') {}
  get dataset(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.attrs)
        .filter(([key]) => key.startsWith('data-'))
        .map(([key, value]) => [key.slice(5), value]),
    );
  }
  createEl(
    tag: string,
    options: { text?: string; value?: string; type?: string; attr?: Record<string, string> } = {},
  ): UiElement {
    const element = new UiElement(tag);
    element.text = options.text ?? '';
    element.value = options.value ?? '';
    element.attrs = { ...options.attr, ...(options.type ? { type: options.type } : {}) };
    this.children.push(element);
    return element;
  }
  createDiv(options = {}): UiElement {
    return this.createEl('div', options);
  }
  createSpan(options = {}): UiElement {
    return this.createEl('span', options);
  }
  setText(text: string): void {
    this.text = text;
  }
  addClass(): void {
    /* Layout is verified in native Obsidian separately. */
  }
  focus(): void {}
  empty(): void {
    this.children = [];
    this.text = '';
  }
  all(): UiElement[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  contents(): string {
    return this.all()
      .map((child) => child.text)
      .join('\n');
  }
  querySelectorAll(selector: string): UiElement[] {
    const attribute = /^input\[([\w-]+)\]$/.exec(selector)?.[1];
    return this.all().filter(
      (child) => child.tag === 'input' && attribute && Object.hasOwn(child.attrs, attribute),
    );
  }
}

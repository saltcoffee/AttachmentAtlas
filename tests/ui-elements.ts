/** Records rendering, focus and events for UI tests; native layout remains outside this mock. */
export class UiElement {
  children: UiElement[] = [];
  text = '';
  value = '';
  disabled = false;
  checked = false;
  open = false;
  hidden = false;
  scrollTop = 0;
  scrollLeft = 0;
  ownerDocument: { activeElement: UiElement | null } = { activeElement: null };
  parentElement: UiElement | null = null;
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  attrs: Record<string, string> = {};
  onclick?: () => void;
  onchange?: () => void;
  oninput?: () => void;
  ontoggle?: () => void;
  constructor(readonly tag = 'div') {}
  get firstElementChild(): UiElement | null {
    return this.children[0] ?? null;
  }
  get nextElementSibling(): UiElement | null {
    const siblings = this.parentElement?.children;
    return siblings?.[siblings.indexOf(this) + 1] ?? null;
  }
  insertBefore(element: UiElement, next: UiElement | null): UiElement {
    if (element === next) return element;
    const previous = element.parentElement?.children;
    if (previous) previous.splice(previous.indexOf(element), 1);
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, element);
    element.parentElement = this;
    return element;
  }
  get tagName(): string {
    return this.tag.toUpperCase();
  }
  get id(): string {
    return this.attrs.id ?? '';
  }
  set id(value: string) {
    this.attrs.id = value;
  }
  get dataset(): Record<string, string> {
    const attribute = (key: string) =>
      `data-${key.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}`;
    return new Proxy<Record<string, string>>(
      {},
      {
        get: (_target, key: string) => this.attrs[attribute(key)],
        set: (_target, key: string, value: string) => {
          this.attrs[attribute(key)] = value;
          return true;
        },
        deleteProperty: (_target, key: string) => {
          delete this.attrs[attribute(key)];
          return true;
        },
      },
    );
  }
  createEl(
    tag: string,
    options: {
      text?: string;
      value?: string;
      type?: string;
      cls?: string;
      attr?: Record<string, string>;
    } = {},
  ): UiElement {
    const element = new UiElement(tag);
    element.text = options.text ?? '';
    element.value = options.value ?? '';
    element.attrs = { ...options.attr, ...(options.type ? { type: options.type } : {}) };
    if (options.cls) element.attrs.class = options.cls;
    element.ownerDocument = this.ownerDocument;
    element.parentElement = this;
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
  focus(): void {
    if (!this.disabled) this.ownerDocument.activeElement = this;
  }
  contains(element: UiElement | null): boolean {
    return !!element && this.all().includes(element);
  }
  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  setAttribute(key: string, value: string): void {
    this.attrs[key] = value;
  }
  removeAttribute(key: string): void {
    delete this.attrs[key];
  }
  remove(): void {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null;
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  empty(): void {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null;
    for (const child of this.children) child.parentElement = null;
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
    const parts = selector.trim().split(/\s+/);
    return this.all()
      .slice(1)
      .filter((element) => {
        if (!element.matches(parts.at(-1)!)) return false;
        let ancestor = element.parentElement;
        for (const part of parts.slice(0, -1).reverse()) {
          while (ancestor && !ancestor.matches(part)) ancestor = ancestor.parentElement;
          if (!ancestor) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      });
  }
  querySelector(selector: string): UiElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  private matches(selector: string): boolean {
    if (selector.startsWith('.'))
      return (this.attrs.class ?? '').split(' ').includes(selector.slice(1));
    const attribute = /^([\w-]+)?\[([\w-]+)(?:=["']([^"']*)["'])?\]$/.exec(selector);
    if (attribute)
      return (
        (!attribute[1] || this.tag === attribute[1]) &&
        Object.hasOwn(this.attrs, attribute[2]!) &&
        (attribute[3] === undefined || this.attrs[attribute[2]!] === attribute[3])
      );
    return this.tag === selector;
  }
}

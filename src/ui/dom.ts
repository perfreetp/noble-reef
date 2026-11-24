export type Cleanup = () => void;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendAll(node, children);
  return node;
}

export function applyAttrs(node: HTMLElement, attrs: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign((node as HTMLElement).style, value as Record<string, string>);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const type = key.slice(2).toLowerCase();
      node.addEventListener(type, value as EventListener);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

export function appendAll(node: Node, children: (Node | string | null | undefined)[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export interface CardOptions {
  title: string;
  accent?: string;
  collapsed?: boolean;
  id?: string;
}

/** Thin wrapper over <bonsai-card> so panels keep a plain DOM API. */
export class Card {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private element: HTMLElement;
  private accentEl: HTMLElement | null;
  private titleEl: HTMLElement | null;

  constructor(opts: CardOptions) {
    const card = document.createElement('bonsai-card');
    card.dataset.card = opts.id ?? opts.title;
    // Attributes are set after the element is in the document is fine too, but setting them
    // here lets the element apply them on upgrade; textContent is written lazily in setAccent.
    card.setAttribute('title', opts.title);
    if (opts.accent) card.setAttribute('accent', opts.accent);
    if (opts.collapsed) card.setAttribute('collapsed', '');
    this.root = card;
    this.element = card;
    this.body = card;
    this.accentEl = null;
    this.titleEl = null;
  }

  /** The card's accent label element, resolved through the shadow root once upgraded. */
  accentElement(): HTMLElement | null {
    const shadow = (this.element as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot;
    this.accentEl = this.accentEl ?? shadow?.querySelector('.accent') ?? null;
    return this.accentEl;
  }

  setAccent(text: string): void {
    this.element.setAttribute('accent', text);
    // The element may not have upgraded yet; attributeChangedCallback covers that case.
    const shadow = (this.element as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot;
    const accentEl = this.accentEl ?? shadow?.querySelector('.accent') ?? null;
    this.accentEl = accentEl;
    if (accentEl) accentEl.textContent = text;
  }

  setBody(nodes: (Node | string)[]): void {
    clear(this.body);
    appendAll(this.body, nodes);
  }
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  digits?: number;
  unit?: string;
  format?: (v: number) => string;
  onInput: (v: number) => void;
  /** Fires once the value settles (drag end / keyboard commit). */
  onCommit?: (v: number) => void;
}

export function slider(opts: SliderOptions): HTMLElement {
  const el = document.createElement('bonsai-slider');
  el.setAttribute('label', opts.label);
  el.setAttribute('min', String(opts.min));
  el.setAttribute('max', String(opts.max));
  el.setAttribute('step', String(opts.step));
  el.setAttribute('value', String(opts.value));
  if (opts.digits !== undefined) el.setAttribute('digits', String(opts.digits));
  if (opts.unit) el.setAttribute('unit', opts.unit);
  if (opts.format) {
    (el as HTMLElement & { formatter: ((v: number) => string) | null }).formatter = opts.format;
    // Re-render the initial readout now that the formatter is installed.
    (el as HTMLElement & { setValue?: (v: number) => void }).setValue?.(opts.value);
  }
  el.addEventListener('slider-input', (ev) => opts.onInput((ev as CustomEvent).detail.value));
  if (opts.onCommit) el.addEventListener('slider-commit', (ev) => opts.onCommit!((ev as CustomEvent).detail.value));
  return el;
}

export function syncSlider(field: HTMLElement, value: number): void {
  const fn = (field as unknown as { setValue?: (v: number) => void }).setValue;
  if (fn) fn.call(field, value);
}

export interface ToggleOptions {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function toggle(opts: ToggleOptions): HTMLElement {
  const el = document.createElement('bonsai-toggle');
  el.setAttribute('label', opts.label);
  if (opts.checked) el.setAttribute('checked', '');
  el.addEventListener('toggle-change', (ev) => opts.onChange((ev as CustomEvent).detail.checked));
  return el;
}

export function syncToggle(field: HTMLElement, checked: boolean): void {
  (field as unknown as { setChecked?: (v: boolean) => void }).setChecked?.(checked);
}

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export function chips<T extends string>(
  options: readonly ChipOption<T>[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const el = document.createElement('bonsai-chips') as HTMLElement & {
    setOptions(o: { value: string; label: string; title?: string }[], v: string): void;
    setValue(v: string): void;
  };
  el.setOptions(options.map((o) => ({ value: o.value, label: o.label, title: o.title })), value);
  el.addEventListener('chip-select', (ev) => onChange((ev as CustomEvent).detail.value as T));
  return el;
}

export function syncChips(field: HTMLElement, value: string): void {
  (field as unknown as { setValue?: (v: string) => void }).setValue?.(value);
}

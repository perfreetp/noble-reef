/**
 * Custom elements for the editor's controls. Each one owns a shadow root with its own
 * encapsulated styles and reads the shell's design tokens through CSS custom properties,
 * which inherit across the shadow boundary.
 */

/** Registers a element once, tolerating double-imports during hot reload. */
function define<T extends CustomElementConstructor>(tag: string, ctor: T): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

// ---------------------------------------------------------------------------
// <bonsai-card>
// ---------------------------------------------------------------------------

const CARD_CSS = `
:host {
  display: block;
  background: var(--bg-2);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  margin-bottom: 10px;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  background: linear-gradient(180deg, #1b242b, #182127);
  border-bottom: 1px solid var(--line-soft);
  cursor: pointer;
  user-select: none;
}
.chev { color: var(--text-2); font-size: 10px; transition: transform 150ms ease; width: 10px; }
:host([collapsed]) .chev { transform: rotate(-90deg); }
:host([collapsed]) .body { display: none; }
.title { font-weight: 600; font-size: 12.5px; letter-spacing: 0.02em; color: var(--text-0); }
.accent { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--text-2); }
.body { padding: 11px; }
`;

export class BonsaiCard extends HTMLElement {
  static observedAttributes = ['title', 'accent', 'collapsed'];
  private root: ShadowRoot;
  private accentEl!: HTMLElement;
  /** Where panels put their content: lives in light DOM so global layout styles apply. */
  readonly content: HTMLElement;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.adoptedStyleSheets = [cardSheet()];
    this.root.innerHTML = `
      <div class="head" part="head">
        <span class="chev">▾</span>
        <span class="title"></span>
        <span class="accent"></span>
      </div>
      <div class="body"><slot></slot></div>`;
    this.content = this;
    this.root.querySelector('.head')!.addEventListener('click', () => {
      this.toggleAttribute('collapsed');
      this.dispatchEvent(new CustomEvent('card-toggle', { bubbles: true, detail: this.hasAttribute('collapsed') }));
    });
    this.accentEl = this.root.querySelector('.accent') as HTMLElement;
  }

  connectedCallback(): void {
    this.syncTitle();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'title') this.syncTitle();
    if (name === 'accent') this.accentEl.textContent = this.getAttribute('accent') ?? '';
  }

  private syncTitle(): void {
    const el = this.root.querySelector('.title');
    if (el) el.textContent = this.getAttribute('title') ?? '';
    const accent = this.getAttribute('accent');
    if (accent !== null) this.accentEl.textContent = accent;
  }

  get body(): HTMLElement {
    return this;
  }

  setAccent(text: string): void {
    this.setAttribute('accent', text);
  }
}

// ---------------------------------------------------------------------------
// <bonsai-slider>
// ---------------------------------------------------------------------------

const SLIDER_CSS = `
:host { display: block; margin-bottom: 10px; }
:host(:last-child) { margin-bottom: 0; }
.head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.label { color: var(--text-1); font-size: 12px; }
.value { font-family: var(--mono); font-size: 11px; color: var(--accent); min-width: 42px; text-align: right; }
input {
  -webkit-appearance: none; appearance: none; width: 100%; height: 18px;
  background: transparent; cursor: pointer; margin: 0; display: block;
}
input::-webkit-slider-runnable-track {
  height: 4px; border-radius: 3px;
  background: linear-gradient(90deg, var(--accent-dim) var(--fill, 40%), #26333c var(--fill, 40%));
}
input::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 13px; height: 13px; margin-top: -4.5px;
  border-radius: 50%; background: #d6ecf7; border: 1px solid #6ea9c2;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
input::-moz-range-track { height: 4px; border-radius: 3px; background: #26333c; }
input::-moz-range-progress { height: 4px; border-radius: 3px; background: var(--accent-dim); }
input::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #d6ecf7; border: 1px solid #6ea9c2; }
input:focus-visible { outline: 1px solid var(--accent); outline-offset: 3px; }
`;

export interface SliderDetail {
  value: number;
}

export class BonsaiSlider extends HTMLElement {
  static observedAttributes = ['label', 'min', 'max', 'step', 'value'];
  private root: ShadowRoot;
  private input!: HTMLInputElement;
  private valueEl!: HTMLElement;
  private labelEl!: HTMLElement;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.adoptedStyleSheets = [sliderSheet()];
    this.root.innerHTML = `
      <div class="head"><span class="label"></span><span class="value"></span></div>
      <input type="range">`;
    this.input = this.root.querySelector('input') as HTMLInputElement;
    this.valueEl = this.root.querySelector('.value') as HTMLElement;
    this.labelEl = this.root.querySelector('.label') as HTMLElement;
    this.input.addEventListener('input', () => {
      this.setAttribute('value', this.input.value);
      this.dispatchEvent(new CustomEvent<SliderDetail>('slider-input', {
        bubbles: true, composed: true, detail: { value: Number(this.input.value) },
      }));
    });
    this.input.addEventListener('change', () => {
      this.dispatchEvent(new CustomEvent<SliderDetail>('slider-commit', {
        bubbles: true, composed: true, detail: { value: Number(this.input.value) },
      }));
    });
  }

  connectedCallback(): void {
    this.applyAttrs();
  }

  attributeChangedCallback(): void {
    if (this.input) this.applyAttrs();
  }

  private applyAttrs(): void {
    const min = Number(this.getAttribute('min') ?? 0);
    const max = Number(this.getAttribute('max') ?? 100);
    const step = Number(this.getAttribute('step') ?? 1);
    const value = Number(this.getAttribute('value') ?? min);
    this.labelEl.textContent = this.getAttribute('label') ?? '';
    this.input.min = String(min);
    this.input.max = String(max);
    this.input.step = String(step);
    if (document.activeElement !== this.input) this.input.value = String(value);
    this.setFill(Number(this.input.value));
    this.renderValue(Number(this.input.value));
  }

  private setFill(v: number): void {
    const min = Number(this.getAttribute('min') ?? 0);
    const max = Number(this.getAttribute('max') ?? 100);
    const pct = ((v - min) / Math.max(1e-9, max - min)) * 100;
    this.input.style.setProperty('--fill', `${pct.toFixed(1)}%`);
  }

  /** Optional formatter supplied by the panel; falls back to a numeric readout. */
  formatter: ((v: number) => string) | null = null;

  private renderValue(v: number): void {
    if (this.formatter) {
      this.valueEl.textContent = this.formatter(v);
      return;
    }
    const digits = Number(this.getAttribute('digits') ?? '');
    const suffix = this.getAttribute('unit') ?? '';
    const text = Number.isFinite(digits)
      ? `${v.toFixed(Math.max(0, Math.min(4, digits)))}${suffix}`
      : `${Math.round(v * 100) / 100}${suffix}`;
    this.valueEl.textContent = text;
  }

  /** External updates skip the DOM while the user is dragging this very slider. */
  setValue(v: number): void {
    if (document.activeElement === this.input) return;
    this.setAttribute('value', String(v));
    this.input.value = String(v);
    this.setFill(v);
    this.renderValue(v);
  }

  get slider(): HTMLInputElement {
    return this.input;
  }
}

// ---------------------------------------------------------------------------
// <bonsai-toggle>
// ---------------------------------------------------------------------------

const TOGGLE_CSS = `
:host { display: block; }
label { display: flex; align-items: center; gap: 8px; padding: 5px 0; cursor: pointer; user-select: none; }
input {
  appearance: none; width: 32px; height: 18px; border-radius: 999px; background: #2a363f;
  position: relative; cursor: pointer; transition: background 150ms ease; flex: none; margin: 0;
  border: 1px solid #35434d;
}
input::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  border-radius: 50%; background: #9fb3bf; transition: transform 150ms ease, background 150ms ease;
}
input:checked { background: #2c6d8a; border-color: #3d829f; }
input:checked::after { transform: translateX(14px); background: #e6f7ff; }
span { font-size: 12px; color: var(--text-1); }
`;

export class BonsaiToggle extends HTMLElement {
  static observedAttributes = ['label', 'checked'];
  private root: ShadowRoot;
  private input!: HTMLInputElement;
  private labelEl!: HTMLElement;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.adoptedStyleSheets = [toggleSheet()];
    this.root.innerHTML = '<label><input type="checkbox"><span></span></label>';
    this.input = this.root.querySelector('input') as HTMLInputElement;
    this.labelEl = this.root.querySelector('span') as HTMLElement;
    this.input.addEventListener('change', () => {
      this.toggleAttribute('checked', this.input.checked);
      this.dispatchEvent(new CustomEvent('toggle-change', {
        bubbles: true, composed: true, detail: { checked: this.input.checked },
      }));
    });
  }

  connectedCallback(): void {
    this.labelEl.textContent = this.getAttribute('label') ?? '';
    this.input.checked = this.hasAttribute('checked');
  }

  attributeChangedCallback(name: string): void {
    if (!this.input) return;
    if (name === 'label') this.labelEl.textContent = this.getAttribute('label') ?? '';
    if (name === 'checked') this.input.checked = this.hasAttribute('checked');
  }

  setChecked(v: boolean): void {
    this.toggleAttribute('checked', v);
  }
}

// ---------------------------------------------------------------------------
// <bonsai-chips>
// ---------------------------------------------------------------------------

const CHIPS_CSS = `
:host { display: block; }
.row { display: flex; flex-wrap: wrap; gap: 5px; }
button {
  appearance: none; font: inherit; font-size: 11.5px; color: var(--text-1);
  background: var(--bg-3); border: 1px solid var(--line); border-radius: 999px;
  padding: 4px 11px; cursor: pointer; transition: all 130ms ease; white-space: nowrap;
}
button:hover { color: var(--text-0); border-color: #3b4c57; }
button[aria-pressed='true'] { background: #24404f; border-color: #3c657a; color: #d5efff; }
`;

export class BonsaiChips extends HTMLElement {
  private root: ShadowRoot;
  private row!: HTMLElement;
  private options: { value: string; label: string; title?: string }[] = [];
  private value = '';
  private rendered = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.adoptedStyleSheets = [chipsSheet()];
    this.root.innerHTML = '<div class="row" role="radiogroup"></div>';
    this.row = this.root.querySelector('.row') as HTMLElement;
  }

  setOptions(options: { value: string; label: string; title?: string }[], value: string): void {
    this.options = options;
    this.value = value;
    this.render();
  }

  setValue(value: string): void {
    if (this.value === value) return;
    this.value = value;
    this.syncPressed();
  }

  private render(): void {
    this.row.replaceChildren();
    for (const opt of this.options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.title = opt.title ?? opt.label;
      btn.dataset.value = opt.value;
      btn.setAttribute('aria-pressed', String(opt.value === this.value));
      btn.addEventListener('click', () => {
        this.value = opt.value;
        this.syncPressed();
        this.dispatchEvent(new CustomEvent('chip-select', {
          bubbles: true, composed: true, detail: { value: opt.value },
        }));
      });
      this.row.appendChild(btn);
    }
    this.rendered = true;
  }

  private syncPressed(): void {
    for (const btn of this.row.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === this.value));
    }
  }
}

// ---------------------------------------------------------------------------
// shared sheets
// ---------------------------------------------------------------------------

let cardSheetCache: CSSStyleSheet | null = null;
let sliderSheetCache: CSSStyleSheet | null = null;
let toggleSheetCache: CSSStyleSheet | null = null;
let chipsSheetCache: CSSStyleSheet | null = null;

function makeSheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}
function cardSheet(): CSSStyleSheet {
  return (cardSheetCache ??= makeSheet(CARD_CSS));
}
function sliderSheet(): CSSStyleSheet {
  return (sliderSheetCache ??= makeSheet(SLIDER_CSS));
}
function toggleSheet(): CSSStyleSheet {
  return (toggleSheetCache ??= makeSheet(TOGGLE_CSS));
}
function chipsSheet(): CSSStyleSheet {
  return (chipsSheetCache ??= makeSheet(CHIPS_CSS));
}

export function registerControls(): void {
  define('bonsai-card', BonsaiCard);
  define('bonsai-slider', BonsaiSlider);
  define('bonsai-toggle', BonsaiToggle);
  define('bonsai-chips', BonsaiChips);
}

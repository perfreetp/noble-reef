import type { AssetLibrary, AssetEntry } from '../render/assets';
import type { OrnamentKind } from '../core/types';
import { sharedCss } from './sharedCss';

/**
 * 素材面板:展示三类可拖入素材(翠片、珠串、錾片)。
 * dragstart 携带 assetId/kind,画布侧 drop 后落入对应层。
 */
export class AssetPanelElement extends HTMLElement {
  static tag = 'fg-asset-panel';

  private lib!: AssetLibrary;

  constructor(lib?: AssetLibrary) {
    super();
    if (lib) this.lib = lib;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (this.lib) this.render();
  }

  private render(): void {
    const groups: { kind: OrnamentKind; title: string }[] = [
      { kind: 'kingfisher', title: '翠片 · 点翠底' },
      { kind: 'pearl', title: '珠串 · 珠串层' },
      { kind: 'champleve', title: '錾片 · 金银饰片' },
    ];
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        ${sharedCss}
        h3 { margin: 0 0 4px; font-size: 14px; }
        h4 { margin: 14px 0 8px; font-weight: 600; }
        .hint { color: var(--muted); margin: 0 0 8px; font-size: 11px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .card {
          background: var(--panel-2);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 8px 6px;
          text-align: center;
          cursor: grab;
          user-select: none;
          transition: border-color .15s, transform .1s;
        }
        .card:hover { border-color: var(--accent); }
        .card:active { cursor: grabbing; transform: scale(.96); }
        .card img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 6px; }
        .card span { display: block; margin-top: 6px; font-size: 12px; color: var(--muted); }
      </style>
      <h3>素材面板</h3>
      <p class="hint">拖入画布即放入对应图层</p>
      ${groups
        .map(
          (g) => `
        <section>
          <h4><span class="tag ${g.kind}">${g.title}</span></h4>
          <div class="grid">
            ${this.lib.byKind(g.kind).map((a) => this.card(a)).join('')}
          </div>
        </section>`,
        )
        .join('')}`;
    this.wireDrag();
  }

  private card(a: AssetEntry): string {
    return `
      <div class="card" draggable="true" data-asset="${a.id}" data-kind="${a.kind}">
        <img src="${a.thumb}" alt="${a.name}" />
        <span>${a.name}</span>
      </div>`;
  }

  private wireDrag(): void {
    this.shadowRoot!.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      el.addEventListener('dragstart', (ev) => {
        ev.dataTransfer!.setData('application/x-fg-asset', el.dataset.asset!);
        ev.dataTransfer!.setData('application/x-fg-kind', el.dataset.kind!);
        ev.dataTransfer!.effectAllowed = 'copy';
      });
    });
  }
}

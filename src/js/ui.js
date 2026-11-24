/** Small shared UI helpers: toasts, icons, dialogs. */

import { TYPES } from '../geometry/solids.js';

const ICON_PATHS = {
  undo: 'M9 7h6.5A4.5 4.5 0 0 1 20 11.5A4.5 4.5 0 0 1 15.5 16H8M11.5 4 8 7l3.5 3',
  redo: 'M15 7H8.5A4.5 4.5 0 0 0 4 11.5A4.5 4.5 0 0 0 8.5 16H16M12.5 4 16 7l-3.5 3',
  group:
    'M4 8.5 12 4l8 4.5v7L12 20l-8-4.5zM4 8.5 12 13l8-4.5M12 13v7',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  trash: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v6M14 11v6',
  duplicate: 'M9 9h11v11H9zM4 15V4h11',
  ungroup:
    'M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4M9 9h6v6H9z',
  merge:
    'M4 12h5M15 12h5M12 4v5M12 15v5M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  cut: 'M6 4l12 12M18 4 6 16M7 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  wand: 'M5 19 17 7M14 4l1.5 3.5L19 9l-3.5 1.5L14 14l-1.5-3.5L9 9l3.5-1.5z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 8h.01',
};

export function icon(name, extraClass = '') {
  const d = ICON_PATHS[name];
  if (!d) return '';
  return `<svg class="${extraClass}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" /></svg>`;
}

export function typeIcon(type) {
  const def = TYPES[type];
  if (!def) return icon('layers');
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${def.icon}" /></svg>`;
}

let toastHost = null;

export function initToasts(host) {
  toastHost = host;
}

export function toast(message, kind = 'info', ms = 3400) {
  if (!toastHost) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  toastHost.appendChild(el);
  while (toastHost.children.length > 4) toastHost.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, ms);
  return el;
}

export function setPressed(el, active) {
  if (!el) return;
  el.dataset.active = active ? 'true' : 'false';
}

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

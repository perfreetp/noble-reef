import { el } from './dom';

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (!host) {
    host = el('div', { class: 'toast-host' });
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info', ms = 2600): void {
  const node = el('div', { class: `toast ${kind}`, text: message });
  ensureHost().appendChild(node);
  window.setTimeout(() => {
    node.style.transition = 'opacity 220ms ease, transform 220ms ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    window.setTimeout(() => node.remove(), 240);
  }, ms);
}

export interface ModalAction {
  label: string;
  primary?: boolean;
  onClick?: () => void;
  close?: boolean;
}

export function modal(title: string, buildBody: (body: HTMLElement) => void, actions: ModalAction[] = []): () => void {
  const body = el('div', { class: 'modal-body' });
  buildBody(body);
  const foot = el('div', { class: 'modal-foot' });
  const backdrop = el('div', { class: 'modal-backdrop' });
  const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'modal-head', text: title }),
    body,
    foot,
  ]);
  backdrop.appendChild(dialog);

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  for (const action of actions) {
    const btn = el('button', {
      class: `btn${action.primary ? ' primary' : ''}`,
      type: 'button',
      text: action.label,
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      action.onClick?.();
      if (action.close !== false) close();
    });
    foot.appendChild(btn);
  }
  if (!actions.length) {
    const btn = el('button', { class: 'btn primary', type: 'button', text: '知道了' });
    btn.addEventListener('click', close);
    foot.appendChild(btn);
  }
  document.body.appendChild(backdrop);
  return close;
}

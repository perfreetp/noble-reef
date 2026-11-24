import { createSignal } from 'solid-js';
import type { JSX } from 'solid-js';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
let toastId = 0;

export const pushToast = (message: string, kind: Toast['kind'] = 'info'): void => {
  const id = ++toastId;
  setToasts((list) => [...list, { id, kind, message }]);
  setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3600);
};

export const ToastHost = (): JSX.Element => (
  <div class="toast">
    {toasts().map((t) => (
      <div class={`toast-item ${t.kind}`}>{t.message}</div>
    ))}
  </div>
);

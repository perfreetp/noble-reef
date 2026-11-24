import type { ReactNode } from 'react';
import { useHistory } from '../state/HistoryContext';

export function PanelSection({ title, icon, children, hint }: { title: string; icon?: string; children: ReactNode; hint?: string }) {
  return (
    <section className="panel-section">
      <header className="panel-section-header">
        <span className="panel-section-icon" aria-hidden>{icon}</span>
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
      </header>
      <div className="panel-section-body">{children}</div>
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  digits = 1,
  historyLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  historyLabel?: string;
  onChange: (value: number) => void;
}) {
  const { beginGesture, endGesture } = useHistory();
  return (
    <label className="slider-row">
      <span className="slider-label">
        <span>{label}</span>
        <output>{Number.isInteger(step) ? value.toFixed(0) : value.toFixed(digits)}{unit}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onFocus={beginGesture}
        onPointerDown={beginGesture}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => endGesture(historyLabel ?? `调整${label}`)}
        onBlur={() => endGesture(historyLabel ?? `调整${label}`)}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <button type="button" className={`toggle-row ${checked ? 'is-on' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <i className="toggle-track"><b /></i>
    </button>
  );
}

export function ActionButton({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'success' | 'default';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type="button" className={`action-button variant-${variant}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'red' | 'amber' | 'cyan' | 'violet'; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

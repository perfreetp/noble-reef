import type { JSX } from 'solid-js';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  disabled?: boolean;
  onInput: (v: number) => void;
}

/** 带标签与数值的滑杆（受控组件） */
export function Slider(props: SliderProps): JSX.Element {
  return (
    <div class="row">
      <label>{props.label}</label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onInput={(e) => props.onInput(Number(e.currentTarget.value))}
      />
      <span class="value">
        {props.value.toFixed(props.decimals ?? 0)}
        {props.unit ?? ''}
      </span>
    </div>
  );
}

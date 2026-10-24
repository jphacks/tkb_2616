import { useState, type CSSProperties } from 'react';
import type { SliderControlProps } from './SliderControl';

// ブラウザ標準のドラッグ・タッチ・キーボード操作を使う。保存は操作完了時だけ。
export function SliderControl({ value, max, color, trackColor, label, valueText, height, onChange }: SliderControlProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const current = dragValue ?? value;
  const commit = (next: number) => {
    setDragValue(null);
    const rounded = Math.max(0, Math.min(max, Math.round(next)));
    if (rounded !== value) onChange(rounded);
  };
  return <>
    <style>{`
      .shumitomo-slider { appearance: none; -webkit-appearance: none; flex: 1; min-width: 0; margin: 0; background: transparent; cursor: pointer; touch-action: pan-y; }
      .shumitomo-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: var(--slider-track); }
      .shumitomo-slider::-moz-range-track { height: 4px; border-radius: 2px; background: var(--slider-track); }
      .shumitomo-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; height: 18px; width: 18px; margin-top: -7px; border-radius: 50%; border: 2px solid var(--slider-color); background: var(--slider-color); }
      .shumitomo-slider::-moz-range-thumb { height: 14px; width: 14px; border-radius: 50%; border: 2px solid var(--slider-color); background: var(--slider-color); }
      .shumitomo-slider:focus-visible { outline: 2px solid var(--slider-color); outline-offset: 3px; border-radius: 6px; }
    `}</style>
    <input className="shumitomo-slider" type="range" min={0} max={max} step="any" value={current}
      aria-label={label} aria-valuetext={dragValue === null ? valueText : undefined}
      style={{ height, '--slider-color': color, '--slider-track': `linear-gradient(to right, ${color} ${current / max * 100}%, ${trackColor} ${current / max * 100}%)` } as CSSProperties}
      onChange={event => setDragValue(event.currentTarget.valueAsNumber)}
      onPointerUp={event => commit(event.currentTarget.valueAsNumber)}
      onPointerCancel={() => setDragValue(null)}
      onBlur={event => { if (dragValue !== null) commit(event.currentTarget.valueAsNumber); }}
      onKeyDown={event => {
        const moves: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 };
        const delta = moves[event.key];
        if (delta !== undefined || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          setDragValue(event.key === 'Home' ? 0 : event.key === 'End' ? max : Math.max(0, Math.min(max, Math.round(current) + delta)));
        }
      }}
      onKeyUp={event => { if (dragValue !== null) commit(event.currentTarget.valueAsNumber); }} />
  </>;
}

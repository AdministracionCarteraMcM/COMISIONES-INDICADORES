import React, { useState } from 'react';
import { fmtMoneyCompact, fmtPct1 } from '../utils/mcmData';

export interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

export const TrendLineChart: React.FC<{
  labels: string[];
  series: LineSeries[];
  valueFormat?: 'pct' | 'money' | 'num';
  referenceLine?: { value: number; label: string; color?: string };
  height?: number;
}> = ({ labels, series, valueFormat = 'pct', referenceLine, height = 240 }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!labels.length || !series.length) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-400">
        Sin datos suficientes para graficar.
      </div>
    );
  }

  const allVals = series
    .flatMap((s) => s.values)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (referenceLine) allVals.push(referenceLine.value);
  if (!allVals.length) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-400">
        Sin valores numéricos para graficar.
      </div>
    );
  }

  let minV = Math.min(...allVals);
  let maxV = Math.max(...allVals);
  if (valueFormat === 'pct') {
    minV = Math.max(0, Math.min(minV, 0.75));
    maxV = Math.max(maxV, 1);
  } else {
    minV = Math.min(0, minV);
  }
  const padV = (maxV - minV) * 0.1 || 0.05;
  const lo = valueFormat === 'pct' ? Math.max(0, minV - padV * 0.5) : minV;
  const hi = maxV + padV * 0.5;

  const w = 640;
  const h = height;
  const padL = 54;
  const padR = 18;
  const padT = 22;
  const padB = 38;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xAt = (i: number) =>
    labels.length === 1 ? padL + plotW / 2 : padL + (i / (labels.length - 1)) * plotW;
  const yAt = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const fmt = (v: number) => {
    if (valueFormat === 'pct') return fmtPct1(v);
    if (valueFormat === 'money') return fmtMoneyCompact(v);
    return Math.round(v).toLocaleString('es-MX');
  };

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);

  return (
    <div className="w-full relative">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        {series.map((s) => (
          <div key={s.name} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: s.color }}
            />
            <span>{s.name}</span>
          </div>
        ))}
        {referenceLine && (
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span
              className="w-4 h-0.5 inline-block border-t-2 border-dashed"
              style={{ borderColor: referenceLine.color || '#16A34A' }}
            />
            <span>{referenceLine.label}</span>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto overflow-hidden select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {tickValues.map((tv, i) => {
          const y = yAt(tv);
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray="3 3"
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[10px] tabular-nums"
              >
                {fmt(tv)}
              </text>
            </g>
          );
        })}

        {referenceLine && (
          <line
            x1={padL}
            x2={w - padR}
            y1={yAt(referenceLine.value)}
            y2={yAt(referenceLine.value)}
            stroke={referenceLine.color || '#16A34A'}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {labels.map((lbl, i) => {
          const showLbl =
            labels.length <= 10 || i === 0 || i === labels.length - 1 || i % Math.ceil(labels.length / 7) === 0;
          if (!showLbl) return null;
          return (
            <text
              key={i}
              x={xAt(i)}
              y={h - 13}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {lbl}
            </text>
          );
        })}

        {series.map((s) => {
          const pts: string[] = [];
          s.values.forEach((v, i) => {
            if (v !== null && Number.isFinite(v)) {
              pts.push(`${pts.length === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
            }
          });
          return (
            <g key={s.name}>
              {pts.length > 0 && (
                <path
                  d={pts.join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.25}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {s.values.map((v, i) =>
                v !== null && Number.isFinite(v) ? (
                  <circle
                    key={i}
                    cx={xAt(i)}
                    cy={yAt(v)}
                    r={hoverIdx === i ? 5 : 3}
                    fill="#FFFFFF"
                    stroke={s.color}
                    strokeWidth={2}
                  />
                ) : null
              )}
            </g>
          );
        })}

        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={padT}
            y2={padT + plotH}
            stroke="#94A3B8"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {labels.map((_, i) => (
          <rect
            key={i}
            x={labels.length === 1 ? padL : xAt(i) - plotW / Math.max(2, labels.length * 2)}
            y={padT}
            width={labels.length === 1 ? plotW : plotW / Math.max(1, labels.length)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}
      </svg>

      {hoverIdx !== null && (
        <div className="mt-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs inline-flex flex-wrap items-center gap-3 tabular-nums">
          <span className="font-semibold">{labels[hoverIdx]}</span>
          {series.map((s) => {
            const val = s.values[hoverIdx];
            if (val === null || val === undefined) return null;
            return (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-slate-300">{s.name}:</span>
                <span className="font-semibold">{fmt(val)}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export interface BarGroupItem {
  label: string;
  values: Array<{ name: string; value: number; color: string; count?: number; countLabel?: string }>;
}

export const GroupedBarChart: React.FC<{
  items: BarGroupItem[];
  valueFormat?: 'pct' | 'money' | 'num';
  height?: number;
}> = ({ items, valueFormat = 'money', height = 230 }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!items.length) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-400">
        Sin datos para mostrar.
      </div>
    );
  }
  const maxVal = Math.max(
    valueFormat === 'pct' ? 1 : 1,
    ...items.flatMap((it) => it.values.map((v) => v.value))
  );
  const hi = valueFormat === 'pct' ? Math.max(1, maxVal) : maxVal * 1.12;
  const needsRotate = items.length > 5;
  const w = 640;
  const h = needsRotate ? Math.max(height, 255) : height;
  const padL = 56;
  const padR = 14;
  const padT = 16;
  const padB = needsRotate ? 64 : 40;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const groupW = plotW / items.length;
  const seriesNames = items[0]?.values || [];

  const fmt = (v: number) => {
    if (valueFormat === 'pct') return fmtPct1(v);
    if (valueFormat === 'money') {
      if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
      if (Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3)}K`;
      return `$${Math.round(v)}`;
    }
    return Math.round(v).toLocaleString('es-MX');
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        {seriesNames.map((s) => (
          <div key={s.name} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            <span>{s.name}</span>
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
          const tv = hi * f;
          const y = padT + plotH * (1 - f);
          return (
            <g key={idx}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
              <text x={padL - 8} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
                {fmt(tv)}
              </text>
            </g>
          );
        })}

        {items.map((item, gi) => {
          const gx = padL + gi * groupW;
          const barCount = Math.max(1, item.values.length);
          const barGap = barCount >= 4 && groupW < 64 ? 1.5 : 2;
          const maxGroupInnerW = Math.min(groupW * 0.8, 62);
          const barW = Math.max(3.5, (maxGroupInnerW - barGap * (barCount - 1)) / barCount);
          const actualGroupW = barCount * barW + barGap * (barCount - 1);
          const startX = gx + (groupW - actualGroupW) / 2;
          const labelX = gx + groupW / 2;
          const labelY = needsRotate ? padT + plotH + 14 : h - 14;
          const maxLblLen = needsRotate ? 16 : 20;
          const shortLbl = item.label.length > maxLblLen ? `${item.label.slice(0, maxLblLen - 1)}…` : item.label;
          return (
            <g key={`${item.label}-${gi}`} onMouseEnter={() => setHoverIdx(gi)}>
              <rect x={gx} y={padT} width={groupW} height={plotH} fill="transparent" />
              {item.values.map((v, bi) => {
                const safeVal = Math.max(0, v.value);
                const bh = Math.max(1, (safeVal / (hi || 1)) * plotH);
                const bx = startX + bi * (barW + barGap);
                const by = padT + plotH - bh;
                return (
                  <rect
                    key={v.name}
                    x={bx}
                    y={by}
                    width={barW}
                    height={bh}
                    rx={3}
                    fill={v.color}
                    opacity={hoverIdx === null || hoverIdx === gi ? 0.92 : 0.45}
                  />
                );
              })}
              <text
                x={labelX}
                y={labelY}
                textAnchor={needsRotate ? 'end' : 'middle'}
                transform={needsRotate ? `rotate(-28 ${labelX} ${labelY})` : undefined}
                className={needsRotate ? 'fill-slate-600 text-[9px]' : 'fill-slate-600 text-[9.5px]'}
              >
                {shortLbl}
              </text>
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && items[hoverIdx] && (
        <div className="mt-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs inline-flex flex-wrap items-center gap-3 tabular-nums">
          <span className="font-semibold">{items[hoverIdx].label}</span>
          {items[hoverIdx].values.map((v) => (
            <span key={v.name}>
              <span className="text-slate-300">{v.name}: </span>
              <span className="font-semibold">
                {valueFormat === 'money'
                  ? fmtMoneyCompact(v.value)
                  : valueFormat === 'pct'
                  ? fmtPct1(v.value)
                  : Math.round(v.value).toLocaleString('es-MX')}
              </span>
              {v.count !== undefined && (
                <span className="text-slate-400 ml-1">
                  ({Math.round(v.count).toLocaleString('es-MX')} {v.countLabel || 'reg.'})
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export const MultiSegmentDonutChart: React.FC<{
  segments: DonutSegment[];
  valueFormat?: 'money' | 'num';
  centerLabel?: string;
}> = ({ segments, valueFormat = 'money', centerLabel = 'Total' }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const valid = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = valid.reduce((acc, s) => acc + s.value, 0);

  if (!valid.length || total <= 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-400">
        Sin datos suficientes para graficar.
      </div>
    );
  }

  const fmtVal = (v: number) =>
    valueFormat === 'money'
      ? fmtMoneyCompact(v)
      : Math.round(v).toLocaleString('es-MX');

  const r = 52;
  const c = 2 * Math.PI * r;
  let offsetAcc = 0;

  const slices = valid.map((s) => {
    const frac = s.value / total;
    const len = frac * c;
    const slice = { ...s, frac, len, offset: offsetAcc };
    offsetAcc += len;
    return slice;
  });

  const active = hoverIdx !== null ? slices[hoverIdx] : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-4">
      <div className="relative w-[164px] h-[164px] mx-auto shrink-0">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90 select-none">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#F1F5F9" strokeWidth="18" />
          {slices.map((s, idx) => (
            <circle
              key={`${s.label}-${idx}`}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={hoverIdx === idx ? 21 : 18}
              strokeDasharray={`${s.len} ${c}`}
              strokeDashoffset={-s.offset}
              opacity={hoverIdx === null || hoverIdx === idx ? 0.95 : 0.4}
              className="transition-all cursor-pointer"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate max-w-[96px]">
            {active ? active.label : centerLabel}
          </span>
          <span className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
            {active ? fmtVal(active.value) : fmtVal(total)}
          </span>
          <span className="text-[11px] font-semibold text-blue-600 tabular-nums">
            {active ? `${(active.frac * 100).toFixed(1)}%` : '100%'}
          </span>
        </div>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {slices.map((s, idx) => (
          <div
            key={`${s.label}-${idx}`}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
              hoverIdx === idx ? 'bg-slate-100' : 'hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="font-medium text-slate-700 truncate">{s.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 tabular-nums">
              <span className="font-semibold text-slate-900">{fmtVal(s.value)}</span>
              <span className="text-[11px] text-slate-500 w-11 text-right">
                {(s.frac * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export interface HorizontalBarItem {
  label: string;
  sublabel?: string;
  value: number;
  color: string;
  displayValue: string;
}

export const HorizontalBarChart: React.FC<{
  items: HorizontalBarItem[];
  referenceValue?: number;
  diverging?: boolean;
}> = ({ items, referenceValue, diverging = false }) => {
  if (!items.length) {
    return <p className="text-xs text-slate-400 py-6 text-center">Sin registros.</p>;
  }
  const maxAbs = diverging
    ? Math.max(0.01, ...items.map((i) => Math.abs(i.value)))
    : Math.max(0.01, referenceValue || 0, ...items.map((i) => i.value));

  return (
    <div className="space-y-2.5">
      {items.map((item, idx) => {
        if (diverging) {
          const pct = Math.min(100, (Math.abs(item.value) / maxAbs) * 50);
          const isNeg = item.value < 0;
          return (
            <div key={`${item.label}-${idx}`} className="grid grid-cols-[135px_1fr_72px] items-center gap-3 text-xs">
              <span className="truncate font-medium text-slate-700" title={item.label}>
                {item.label}
              </span>
              <div className="relative h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" />
                <div
                  className="absolute top-0 bottom-0 rounded-full"
                  style={{
                    backgroundColor: item.color,
                    width: `${pct}%`,
                    left: isNeg ? `${50 - pct}%` : '50%',
                  }}
                />
              </div>
              <span className="text-right font-semibold tabular-nums text-slate-800">
                {item.displayValue}
              </span>
            </div>
          );
        }

        const widthPct = Math.max(2, Math.min(100, (item.value / maxAbs) * 100));
        const refPct =
          referenceValue !== undefined ? Math.min(100, (referenceValue / maxAbs) * 100) : null;

        return (
          <div key={`${item.label}-${idx}`} className="space-y-1">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="font-medium text-slate-700 truncate">
                {item.label}
                {item.sublabel && <span className="text-slate-400 ml-1.5 font-normal">{item.sublabel}</span>}
              </span>
              <span className="font-semibold tabular-nums text-slate-900 shrink-0">
                {item.displayValue}
              </span>
            </div>
            <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${widthPct}%`, backgroundColor: item.color }}
              />
              {refPct !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-700/60"
                  style={{ left: `${refPct}%` }}
                  title="Meta"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const DonutRingChart: React.FC<{
  percent: number;
  centerLabel: string;
  centerSublabel?: string;
  color?: string;
  size?: number;
}> = ({ percent, centerLabel, centerSublabel, color = '#2563EB', size = 144 }) => {
  const clamped = Math.max(0, Math.min(1, percent));
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = clamped * c;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 130 130" className="w-full h-full -rotate-90">
        <circle cx="65" cy="65" r={r} fill="none" stroke="#E2E8F0" strokeWidth="12" />
        <circle
          cx="65"
          cy="65"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        <span className="text-xl font-bold text-slate-900 tabular-nums">{centerLabel}</span>
        {centerSublabel && (
          <span className="text-[11px] font-medium text-slate-500 mt-0.5">{centerSublabel}</span>
        )}
      </div>
    </div>
  );
};

export const SemiGaugeChart: React.FC<{
  value: number;
  target: number;
  title: string;
  subtitle: string;
  color: string;
}> = ({ value, target, title, subtitle, color }) => {
  const clamped = Math.max(0, Math.min(1, value));
  const r = 56;
  const halfC = Math.PI * r;
  const fill = clamped * halfC;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col items-center text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{title}</p>
      <div className="relative w-44 h-24">
        <svg viewBox="0 0 140 80" className="w-full h-full">
          <path
            d="M 14 70 A 56 56 0 0 1 126 70"
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M 14 70 A 56 56 0 0 1 126 70"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${fill} ${halfC}`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
          <span className="text-2xl font-bold text-slate-900 tabular-nums">
            {(value * 100).toFixed(1)}%
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-1 tabular-nums">{subtitle}</p>
      <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
        Meta: {(target * 100).toFixed(0)}%
      </p>
    </div>
  );
};

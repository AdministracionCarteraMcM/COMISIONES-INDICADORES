import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CorteRow, IndicadorRow } from '../types/mcm';
import {
  fmtMoney,
  fmtMoneyCompact,
  fmtNum,
  fmtPct1,
  METAS,
  num,
  shortPeriodo,
  weightedNormalidad,
} from '../utils/mcmData';

type IndicatorMetricKey =
  | 'cobranza'
  | 'cartera'
  | 'colocacion'
  | 'normalidad'
  | 'clientes';

interface IndicadoresEvolutionChartProps {
  cortes: CorteRow[];
  rowsAllCortes: IndicadorRow[];
  selectedCortes: number[];
}

interface ChartPoint {
  corte: number;
  label: string;
  periodo: string;
  isSelected: boolean;
  montoRecibido: number;
  montoEsperado: number;
  saldoTotal: number;
  moraTotal: number;
  colocacion: number;
  desembolso: number;
  normalidadPct: number;
  clientesVigentes: number;
}

const METRIC_OPTIONS: Array<{ id: IndicatorMetricKey; label: string }> = [
  { id: 'cobranza', label: 'Cobranza $' },
  { id: 'cartera', label: 'Saldo y Mora' },
  { id: 'colocacion', label: 'Colocación $' },
  { id: 'normalidad', label: '% Normalidad' },
  { id: 'clientes', label: 'Clientes' },
];

export const IndicadoresEvolutionChart: React.FC<IndicadoresEvolutionChartProps> = ({
  cortes,
  rowsAllCortes,
  selectedCortes,
}) => {
  const [metric, setMetric] = useState<IndicatorMetricKey>('cobranza');
  const [onlySelectedCortes, setOnlySelectedCortes] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedCortes), [selectedCortes]);

  const data = useMemo<ChartPoint[]>(() => {
    const sorted = [...cortes].sort((a, b) => a.CORTE - b.CORTE);
    const byCorte = new Map<number, IndicadorRow[]>();
    rowsAllCortes.forEach((r) => {
      const list = byCorte.get(r.corte) || [];
      list.push(r);
      byCorte.set(r.corte, list);
    });

    return sorted
      .filter((c) => {
        if (!byCorte.has(c.CORTE)) return false;
        if (onlySelectedCortes && selectedSet.size > 0 && !selectedSet.has(c.CORTE)) {
          return false;
        }
        return true;
      })
      .map((c) => {
        const list = byCorte.get(c.CORTE) || [];
        const sum = (f: keyof IndicadorRow) =>
          list.reduce((acc, r) => acc + num(r[f]), 0);
        const norm = weightedNormalidad(list);
        const coloc = sum('monto_colocacion_semanal');
        const desem = sum('desembolso');
        return {
          corte: c.CORTE,
          label: `S${c.SEMANA}`,
          periodo: shortPeriodo(c.PERIODO),
          isSelected: selectedSet.size === 0 || selectedSet.has(c.CORTE),
          montoRecibido: sum('monto_recibido'),
          montoEsperado: sum('monto_esperado'),
          saldoTotal: sum('saldo_total'),
          moraTotal: sum('mora_total'),
          colocacion: coloc || desem,
          desembolso: desem,
          normalidadPct: norm !== null ? Number((norm * 100).toFixed(2)) : 0,
          clientesVigentes: sum('clientes_vigentes'),
        };
      });
  }, [cortes, rowsAllCortes, onlySelectedCortes, selectedSet]);

  const formatYAxis = (value: number) => {
    if (metric === 'normalidad') return `${value.toFixed(0)}%`;
    if (metric === 'clientes') return Math.round(value).toLocaleString('es-MX');
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${Math.round(value / 1e3)}K`;
    return `$${Math.round(value)}`;
  };

  const formatTooltipValue = (value: number) => {
    if (metric === 'normalidad') return fmtPct1(value / 100);
    if (metric === 'clientes') return fmtNum(value);
    return fmtMoney(value);
  };

  const seriesConfig = useMemo(() => {
    switch (metric) {
      case 'cobranza':
        return [
          { key: 'montoRecibido', name: '$ Recibido', color: '#2563EB', dashed: false },
          { key: 'montoEsperado', name: '$ Esperado', color: '#94A3B8', dashed: true },
        ];
      case 'cartera':
        return [
          { key: 'saldoTotal', name: 'Saldo Total', color: '#6366F1', dashed: false },
          { key: 'moraTotal', name: 'Mora Total', color: '#EF4444', dashed: false },
        ];
      case 'colocacion':
        return [
          { key: 'colocacion', name: 'Colocación Semanal', color: '#10B981', dashed: false },
          { key: 'desembolso', name: 'Pagaré / Desembolso', color: '#0EA5E9', dashed: true },
        ];
      case 'normalidad':
        return [
          { key: 'normalidadPct', name: '% Normalidad', color: '#2563EB', dashed: false },
        ];
      case 'clientes':
        return [
          { key: 'clientesVigentes', name: 'Clientes Vigentes', color: '#0F172A', dashed: false },
        ];
    }
  }, [metric]);

  const selectedLabels = useMemo(
    () => data.filter((d) => d.isSelected).map((d) => d.label),
    [data]
  );

  return (
    <div className="lg:col-span-2 border border-slate-200 rounded-xl p-4 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Evolución del Total de Indicadores por Corte
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Total agregado de los filtros activos a través de {data.length} cortes disponibles
            {selectedSet.size > 0 && (
              <span className="text-blue-600 font-medium ml-1">
                · Corte activo resaltado ({selectedLabels.join(', ') || 'ninguno'})
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 gap-0.5">
            {METRIC_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMetric(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  metric === opt.id
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {selectedSet.size > 1 && (
            <button
              type="button"
              onClick={() => setOnlySelectedCortes((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                onlySelectedCortes
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {onlySelectedCortes ? 'Mostrando seleccionados' : 'Ver todos los cortes'}
            </button>
          )}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-xs text-slate-400">
          Sin datos suficientes en los cortes seleccionados para graficar evolución.
        </div>
      ) : (
        <div className="w-full h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 10, right: 20, left: 6, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#64748B' }}
                axisLine={{ stroke: '#CBD5E1' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatYAxis}
                tick={{ fontSize: 11, fill: '#64748B' }}
                axisLine={false}
                tickLine={false}
                width={64}
                domain={metric === 'normalidad' ? ['auto', 'auto'] : [0, 'auto']}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const point = payload[0].payload as ChartPoint;
                  return (
                    <div className="bg-slate-900 text-white rounded-lg px-3 py-2 shadow-lg text-xs space-y-1 border border-slate-700">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-700 pb-1">
                        <span className="font-semibold">
                          {point.label} · {point.periodo || `Corte ${point.corte}`}
                        </span>
                        {point.isSelected && selectedSet.size > 0 && (
                          <span className="text-[10px] font-semibold text-blue-300">
                            Seleccionado
                          </span>
                        )}
                      </div>
                      {payload.map((entry) => (
                        <div
                          key={String(entry.dataKey)}
                          className="flex items-center justify-between gap-4 tabular-nums"
                        >
                          <span className="inline-flex items-center gap-1.5 text-slate-300">
                            <span
                              className="w-2 h-2 rounded-full inline-block"
                              style={{ backgroundColor: entry.color }}
                            />
                            {entry.name}:
                          </span>
                          <span className="font-semibold">
                            {formatTooltipValue(Number(entry.value ?? 0))}
                          </span>
                        </div>
                      ))}
                      {metric === 'cobranza' && point.montoEsperado > 0 && (
                        <div className="text-[11px] text-slate-400 pt-0.5 tabular-nums">
                          Recuperación:{' '}
                          {fmtPct1(point.montoRecibido / point.montoEsperado)} (
                          {fmtMoneyCompact(point.montoRecibido)})
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }}
                iconType="circle"
              />
              {metric === 'normalidad' && (
                <ReferenceLine
                  y={METAS.normalidad * 100}
                  stroke="#16A34A"
                  strokeDasharray="5 4"
                  label={{
                    value: `Meta ${(METAS.normalidad * 100).toFixed(0)}%`,
                    position: 'insideTopRight',
                    fill: '#16A34A',
                    fontSize: 11,
                  }}
                />
              )}
              {selectedSet.size > 0 &&
                selectedLabels.map((lbl) => (
                  <ReferenceLine
                    key={lbl}
                    x={lbl}
                    stroke="#2563EB"
                    strokeDasharray="3 3"
                    strokeOpacity={0.45}
                  />
                ))}
              {seriesConfig.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2.25}
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                  dot={(dotProps) => {
                    const { cx, cy, payload, index } = dotProps;
                    if (cx == null || cy == null) return <g key={index} />;
                    const isActive =
                      selectedSet.size > 0 && (payload as ChartPoint)?.isSelected;
                    return (
                      <circle
                        key={`${s.key}-${index}`}
                        cx={cx}
                        cy={cy}
                        r={isActive ? 5 : 3}
                        fill="#FFFFFF"
                        stroke={s.color}
                        strokeWidth={isActive ? 2.5 : 1.75}
                      />
                    );
                  }}
                  activeDot={{ r: 5.5, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

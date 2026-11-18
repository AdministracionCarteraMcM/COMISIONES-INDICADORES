import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, Download, Info, Loader2, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { NormalidadRawRow } from '../types/mcm';
import {
  aggregateNormalidadMonth,
  fmtMoneyCompact,
  fmtNum,
  fmtPct,
  fmtPct1,
  getSemaforoLevel,
  mesLabel,
  regionDisplayName,
} from '../utils/mcmData';
import { GroupedBarChart, HorizontalBarChart, TrendLineChart } from './Charts';

interface ReportesViewProps {
  normalidadRaw: NormalidadRawRow[];
  availableMonths?: Array<{ key: string; label: string; rows?: number }>;
  loading?: boolean;
  loadingMonth?: string | null;
  error?: string;
  onSelectMonth?: (monthKey: string) => void;
  onRetry?: () => void;
}

const REGION_COLORS = [
  '#2563EB',
  '#16A34A',
  '#D97706',
  '#0EA5E9',
  '#7C3AED',
  '#EC4899',
  '#14B8A6',
  '#F97316',
];

export const ReportesView: React.FC<ReportesViewProps> = ({
  normalidadRaw,
  availableMonths,
  loading,
  loadingMonth,
  error,
  onSelectMonth,
  onRetry,
}) => {
  const loadedMonths = useMemo(
    () => Array.from(new Set(normalidadRaw.map((r) => r.monthKey))).sort().reverse(),
    [normalidadRaw]
  );
  const loadedMonthSet = useMemo(() => new Set(loadedMonths), [loadedMonths]);

  const months = useMemo(() => {
    const merged = new Set<string>(loadedMonths);
    (availableMonths || []).forEach((m) => {
      if (m.key) merged.add(m.key);
    });
    return Array.from(merged).sort().reverse();
  }, [loadedMonths, availableMonths]);

  const monthLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    (availableMonths || []).forEach((item) => {
      if (item.key && item.label) m.set(item.key, item.label);
    });
    return m;
  }, [availableMonths]);

  const [selectedMonth, setSelectedMonth] = useState<string>(
    () => loadedMonths[0] || months[0] || ''
  );
  const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
  const [verdePct, setVerdePct] = useState<number>(95);
  const [ambarPct, setAmbarPct] = useState<number>(90);

  useEffect(() => {
    if (!selectedMonth) {
      const def = loadedMonths[0] || months[0] || '';
      if (def) setSelectedMonth(def);
    } else if (months.length && !months.includes(selectedMonth)) {
      setSelectedMonth(loadedMonths[0] || months[0]);
    }
  }, [months, loadedMonths, selectedMonth]);

  const verde = verdePct / 100;
  const ambar = ambarPct / 100;

  const monthRows = useMemo(
    () =>
      normalidadRaw.filter(
        (r) =>
          (!selectedMonth || r.monthKey === selectedMonth) &&
          (selectedRegion === 'ALL' || r.region === selectedRegion)
      ),
    [normalidadRaw, selectedMonth, selectedRegion]
  );

  const monthAllRegions = useMemo(
    () => normalidadRaw.filter((r) => !selectedMonth || r.monthKey === selectedMonth),
    [normalidadRaw, selectedMonth]
  );

  const availableRegions = useMemo(
    () => Array.from(new Set(monthAllRegions.map((r) => r.region))).sort(),
    [monthAllRegions]
  );

  const report = useMemo(
    () => aggregateNormalidadMonth(selectedMonth, monthRows),
    [selectedMonth, monthRows]
  );

  const statusCounts = useMemo(() => {
    let ok = 0;
    let mid = 0;
    let bad = 0;
    report.agencies.forEach((a) => {
      const lvl = getSemaforoLevel(a.normality, verde, ambar);
      if (lvl === 'ok') ok++;
      else if (lvl === 'mid') mid++;
      else if (lvl === 'bad') bad++;
    });
    return { ok, mid, bad };
  }, [report.agencies, verde, ambar]);

  const regionChartItems = useMemo(
    () =>
      [...report.regions]
        .sort((a, b) => (b.normality || 0) - (a.normality || 0))
        .map((r) => {
          const lvl = getSemaforoLevel(r.normality, verde, ambar);
          return {
            label: regionDisplayName(r.name),
            value: r.normality || 0,
            color: lvl === 'ok' ? '#16A34A' : lvl === 'mid' ? '#D97706' : '#DC2626',
            displayValue: fmtPct(r.normality),
          };
        }),
    [report.regions, verde, ambar]
  );

  const weeklyTrendSeries = useMemo(() => {
    const topRegions = [...report.regions]
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 6);
    return topRegions.map((r, idx) => ({
      name: regionDisplayName(r.name),
      color: REGION_COLORS[idx % REGION_COLORS.length],
      values: report.weeks.map((w) => report.weeklyRegion.get(`${r.name}||${w.date}`) ?? null),
    }));
  }, [report]);

  const recoveryBarItems = useMemo(
    () =>
      [...report.regions]
        .sort((a, b) => b.expectedAmt - a.expectedAmt)
        .slice(0, 8)
        .map((r) => ({
          label: regionDisplayName(r.name),
          values: [
            { name: '$ Esperada Recibida', value: r.receivedExpected, color: '#2563EB' },
            { name: '$ Faltante', value: Math.max(0, r.missing), color: '#CBD5E1' },
          ],
        })),
    [report.regions]
  );

  const regionWeekBars = useMemo(
    () =>
      [...report.regions]
        .sort((a, b) => (b.normality || 0) - (a.normality || 0))
        .slice(0, 8)
        .map((r) => ({
          label: regionDisplayName(r.name),
          values: report.weeks.map((w, idx) => ({
            name: w.date.slice(5),
            value: report.weeklyRegion.get(`${r.name}||${w.date}`) ?? 0,
            color: REGION_COLORS[idx % REGION_COLORS.length],
          })),
        })),
    [report]
  );

  const agencyRankingItems = useMemo(
    () =>
      [...report.agencies]
        .sort((a, b) => (b.normality || 0) - (a.normality || 0))
        .slice(0, 15)
        .map((a) => {
          const lvl = getSemaforoLevel(a.normality, verde, ambar);
          return {
            label: a.name,
            sublabel: regionDisplayName(a.region),
            value: a.normality || 0,
            color: lvl === 'ok' ? '#16A34A' : lvl === 'mid' ? '#D97706' : '#DC2626',
            displayValue: fmtPct(a.normality),
          };
        }),
    [report.agencies, verde, ambar]
  );

  const deltaItems = useMemo(() => {
    if (report.weeks.length < 2) return [];
    const w0 = report.weeks[0].date;
    const wN = report.weeks[report.weeks.length - 1].date;
    return report.agencies
      .map((a) => {
        const first = report.weeklyAgency.get(`${a.region}||${a.name}||${w0}`);
        const last = report.weeklyAgency.get(`${a.region}||${a.name}||${wN}`);
        if (first == null || last == null) return null;
        const diffPp = (last - first) * 100;
        return {
          label: a.name,
          value: diffPp,
          color: diffPp >= 0 ? '#16A34A' : '#DC2626',
          displayValue: `${diffPp >= 0 ? '+' : ''}${diffPp.toFixed(1)} pp`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 14);
  }, [report]);

  const exportMonthlyExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        report.regions.map((r) => ({
          Región: regionDisplayName(r.name),
          'Pagos Esperados': r.expected,
          'Pagos Recibidos': r.received,
          '% Normalidad': r.normality != null ? Number((r.normality * 100).toFixed(2)) : 0,
          '$ Esperada': r.expectedAmt,
          '$ Recibida Esperada': r.receivedExpected,
          '$ Faltante': r.missing,
          '% Recuperación $': r.recovery != null ? Number((r.recovery * 100).toFixed(2)) : 0,
        }))
      ),
      'Regiones'
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        report.agencies.map((a) => ({
          Región: regionDisplayName(a.region),
          Agencia: a.name,
          'Pagos Esperados': a.expected,
          'Pagos Recibidos': a.received,
          '% Normalidad': a.normality != null ? Number((a.normality * 100).toFixed(2)) : 0,
          '$ Esperada': a.expectedAmt,
          '$ Recibida Esperada': a.receivedExpected,
          '$ Faltante': a.missing,
        }))
      ),
      'Agencias'
    );
    XLSX.writeFile(wb, `Normalidad_Mensual_${selectedMonth}.xlsx`);
  };

  if (!normalidadRaw.length) {
    const targetLabel =
      (loadingMonth && (monthLabelMap.get(loadingMonth) || mesLabel(loadingMonth))) ||
      (months[0] && (monthLabelMap.get(months[0]) || mesLabel(months[0]))) ||
      '';
    if (loading || loadingMonth) {
      return (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col items-center justify-center gap-2.5 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-800">
            {targetLabel
              ? `Cargando ${targetLabel} (mes más reciente)...`
              : 'Cargando el mes más reciente de Reportes Mensuales...'}
          </p>
          <p className="text-xs text-slate-500 max-w-md">
            Por defecto se descarga únicamente el último mes publicado en NORMALIDAD para agilizar la consulta.
          </p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="bg-white border border-red-200 rounded-xl p-6 sm:p-8 flex flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="w-6 h-6 text-red-600" />
          <p className="text-sm font-semibold text-slate-900">
            No se pudieron cargar los reportes mensuales
          </p>
          <p className="text-xs text-red-700 max-w-md">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reintentar carga
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 text-center space-y-2.5">
        <p className="text-sm font-semibold text-slate-800">
          {months.length
            ? `Mes más reciente disponible: ${targetLabel}`
            : 'Sin datos publicados en la hoja NORMALIDAD'}
        </p>
        <p className="text-xs text-slate-500">
          {months.length
            ? 'Pulsa cargar para obtener el reporte de este mes.'
            : 'El Administrador puede cargar un mes en Administración → Reportes Mensuales.'}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {months.length ? `Cargar ${targetLabel}` : 'Actualizar consulta'}
          </button>
        )}
      </div>
    );
  }

  const isSelectedMonthPending = Boolean(
    selectedMonth && !loadedMonthSet.has(selectedMonth)
  );
  const hasMoreMonths = months.length > loadedMonthSet.size;

  return (
    <div className="space-y-5">
      {/* Header Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <select
              value={selectedMonth}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedMonth(next);
                setSelectedRegion('ALL');
                if (next && !loadedMonthSet.has(next) && onSelectMonth) {
                  onSelectMonth(next);
                }
              }}
              className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabelMap.get(m) || mesLabel(m)}
                  {loadedMonthSet.has(m) ? '' : ' (cargar)'}
                </option>
              ))}
            </select>
          </div>

          <select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700"
          >
            <option value="ALL">Todas las regiones</option>
            {availableRegions.map((r) => (
              <option key={r} value={r}>
                {regionDisplayName(r)}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 text-xs text-slate-600 pl-2 border-l border-slate-200">
            <label className="inline-flex items-center gap-1">
              <span className="font-medium text-emerald-700">Verde ≥</span>
              <input
                type="number"
                min={50}
                max={100}
                step={0.5}
                value={verdePct}
                onChange={(e) => setVerdePct(Number(e.target.value) || 95)}
                className="w-14 px-1.5 py-1 border border-slate-200 rounded text-center tabular-nums"
              />
              %
            </label>
            <label className="inline-flex items-center gap-1">
              <span className="font-medium text-amber-700">Ámbar ≥</span>
              <input
                type="number"
                min={50}
                max={100}
                step={0.5}
                value={ambarPct}
                onChange={(e) => setAmbarPct(Number(e.target.value) || 90)}
                className="w-14 px-1.5 py-1 border border-slate-200 rounded text-center tabular-nums"
              />
              %
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={exportMonthlyExcel}
          disabled={isSelectedMonthPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-emerald-600" />
          Exportar Excel
        </button>
      </div>

      {hasMoreMonths && (
        <div className="px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Nota:</strong> Por defecto se carga el último mes publicado. Hay{' '}
            <strong>{months.length} meses</strong> disponibles en <code>NORMALIDAD</code>: selecciona otro mes en el filtro superior si deseas consultarlo.
          </span>
        </div>
      )}

      {error && (
        <div className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 flex items-center justify-between gap-2 text-xs text-red-800">
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2.5 py-1 font-semibold bg-red-600 text-white rounded hover:bg-red-700"
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {isSelectedMonthPending || loadingMonth === selectedMonth ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center gap-2.5 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-800">
            Cargando {monthLabelMap.get(selectedMonth) || mesLabel(selectedMonth)}...
          </p>
        </div>
      ) : (
        <>

      {/* 6 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Normalidad McM</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
            {fmtPct(report.total.normality)}
          </p>
          <p className="text-[11px] text-slate-400 tabular-nums mt-1">
            {fmtNum(report.total.received)} / {fmtNum(report.total.expected)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">% Recuperación $</p>
          <p className="text-xl font-bold text-blue-700 tabular-nums mt-1">
            {fmtPct(report.total.recovery)}
          </p>
          <p className="text-[11px] text-slate-400 tabular-nums mt-1">
            {fmtMoneyCompact(report.total.receivedExpected)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">$ Esperado Mes</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
            {fmtMoneyCompact(report.total.expectedAmt)}
          </p>
          <p className="text-[11px] text-red-600 tabular-nums mt-1">
            Faltante: {fmtMoneyCompact(report.total.missing)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-emerald-700 font-medium">Agencias en Verde</p>
          <p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">{statusCounts.ok}</p>
          <p className="text-[11px] text-slate-400 mt-1">≥ {verdePct}% normalidad</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-amber-700 font-medium">Agencias en Ámbar</p>
          <p className="text-2xl font-bold text-amber-600 tabular-nums mt-1">{statusCounts.mid}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            {ambarPct}% – {verdePct}%
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-red-700 font-medium">Agencias en Rojo</p>
          <p className="text-2xl font-bold text-red-600 tabular-nums mt-1">{statusCounts.bad}</p>
          <p className="text-[11px] text-slate-400 mt-1">&lt; {ambarPct}%</p>
        </div>
      </div>

      {/* 6 Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            % Normalidad por Región vs Promedio McM ({fmtPct1(report.total.normality)})
          </h3>
          <HorizontalBarChart
            items={regionChartItems}
            referenceValue={report.total.normality || verde}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Tendencia Semanal de % Normalidad por Región
          </h3>
          <TrendLineChart
            labels={report.weeks.map((w) => w.date.slice(5))}
            series={weeklyTrendSeries}
            valueFormat="pct"
            referenceLine={{ value: verde, label: `Meta ${verdePct}%`, color: '#16A34A' }}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            $ Esperado: Recibido vs Faltante por Región
          </h3>
          <GroupedBarChart items={recoveryBarItems} valueFormat="money" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            % Normalidad por Región y Semana
          </h3>
          <GroupedBarChart items={regionWeekBars} valueFormat="pct" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Top Agencias por % Normalidad Mensual
          </h3>
          <HorizontalBarChart items={agencyRankingItems} referenceValue={verde} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            ¿Quién Mejoró o Empeoró? (pp última vs primera semana)
          </h3>
          <HorizontalBarChart items={deltaItems} diverging />
        </div>
      </div>

      {/* Heat Map: Agency x Week */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Mapa de Calor Semanal (Agencia × Semana)
          </h3>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
              <tr>
                <th className="py-2.5 px-3">Región</th>
                <th className="py-2.5 px-3">Agencia</th>
                {report.weeks.map((w) => (
                  <th key={w.date} className="py-2.5 px-3 text-center tabular-nums">
                    {w.date.slice(5)}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right">Mes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {[...report.agencies]
                .sort((a, b) => (b.normality || 0) - (a.normality || 0))
                .map((a) => (
                  <tr key={`${a.region}-${a.name}`} className="hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-500">{regionDisplayName(a.region)}</td>
                    <td className="py-2 px-3 font-semibold text-slate-900">{a.name}</td>
                    {report.weeks.map((w) => {
                      const val = report.weeklyAgency.get(`${a.region}||${a.name}||${w.date}`);
                      const lvl = getSemaforoLevel(val, verde, ambar);
                      const cellCls =
                        lvl === 'ok'
                          ? 'bg-emerald-50 text-emerald-800'
                          : lvl === 'mid'
                          ? 'bg-amber-50 text-amber-800'
                          : lvl === 'bad'
                          ? 'bg-red-50 text-red-800'
                          : 'bg-slate-50 text-slate-400';
                      return (
                        <td
                          key={w.date}
                          className={`py-2 px-3 text-center font-semibold ${cellCls}`}
                        >
                          {val != null ? fmtPct1(val) : '—'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-right font-bold text-slate-900">
                      {fmtPct(a.normality)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Region Detail Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Detalle por Región</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="py-2.5 px-3">Región</th>
                <th className="py-2.5 px-3 text-right">Recibidos / Esperados</th>
                <th className="py-2.5 px-3 text-right">% Normalidad</th>
                <th className="py-2.5 px-3 text-right">$ Esperado</th>
                <th className="py-2.5 px-3 text-right">$ Recibido Esp.</th>
                <th className="py-2.5 px-3 text-right">$ Faltante</th>
                <th className="py-2.5 px-3 text-right">% Recuperación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {[...report.regions]
                .sort((a, b) => (b.normality || 0) - (a.normality || 0))
                .map((r) => (
                  <tr key={r.name} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      {regionDisplayName(r.name)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {fmtNum(r.received)} / {fmtNum(r.expected)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                      {fmtPct(r.normality)}
                    </td>
                    <td className="py-2.5 px-3 text-right">{fmtMoneyCompact(r.expectedAmt)}</td>
                    <td className="py-2.5 px-3 text-right">{fmtMoneyCompact(r.receivedExpected)}</td>
                    <td className="py-2.5 px-3 text-right text-red-600">
                      {fmtMoneyCompact(r.missing)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold">{fmtPct(r.recovery)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}
    </div>
  );
};

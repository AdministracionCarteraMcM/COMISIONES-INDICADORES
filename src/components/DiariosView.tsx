import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, Download, Info, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import type { DailyRow } from '../types/mcm';
import {
  computeDailyMetrics,
  fmtMoney,
  fmtMoneyCompact,
  fmtNum,
  fmtPct,
  num,
  regionDisplayName,
} from '../utils/mcmData';
import {
  DonutRingChart,
  HorizontalBarChart,
  SemiGaugeChart,
  TrendLineChart,
} from './Charts';

interface DiariosViewProps {
  scopedDailyRows: DailyRow[];
  availableDates?: string[];
  historyLoaded?: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string;
  onLoadDate?: (date: string) => void;
  onLoadHistory?: () => void;
  onRetry?: () => void;
}

export const DiariosView: React.FC<DiariosViewProps> = ({
  scopedDailyRows,
  availableDates,
  historyLoaded = true,
  loading,
  loadingMore,
  error,
  onLoadDate,
  onLoadHistory,
  onRetry,
}) => {
  const loadedDates = useMemo(
    () =>
      Array.from(new Set(scopedDailyRows.map((r) => r.FECHACORTE).filter(Boolean))).sort(),
    [scopedDailyRows]
  );

  const loadedDateSet = useMemo(() => new Set(loadedDates), [loadedDates]);

  const dates = useMemo(() => {
    const merged = new Set<string>(loadedDates);
    (availableDates || []).forEach((d) => {
      if (d) merged.add(d);
    });
    return Array.from(merged).sort();
  }, [loadedDates, availableDates]);

  const [selectedDate, setSelectedDate] = useState<string>(
    () => loadedDates[loadedDates.length - 1] || dates[dates.length - 1] || ''
  );
  const [region, setRegion] = useState<string>('ALL');
  const [sucursal, setSucursal] = useState<string>('ALL');
  const [asesor, setAsesor] = useState<string>('ALL');

  useEffect(() => {
    if (!selectedDate) {
      const def = loadedDates[loadedDates.length - 1] || dates[dates.length - 1] || '';
      if (def) setSelectedDate(def);
    } else if (dates.length && !dates.includes(selectedDate)) {
      setSelectedDate(loadedDates[loadedDates.length - 1] || dates[dates.length - 1]);
    }
  }, [dates, loadedDates, selectedDate]);

  const rowsAtDate = useMemo(
    () => scopedDailyRows.filter((r) => !selectedDate || r.FECHACORTE === selectedDate),
    [scopedDailyRows, selectedDate]
  );

  const regions = useMemo(
    () => Array.from(new Set(rowsAtDate.map((r) => r.REGIONAL).filter(Boolean))).sort(),
    [rowsAtDate]
  );

  const sucursales = useMemo(
    () =>
      Array.from(
        new Set(
          rowsAtDate
            .filter((r) => region === 'ALL' || r.REGIONAL === region)
            .map((r) => r.SUCURSAL)
            .filter(Boolean)
        )
      ).sort(),
    [rowsAtDate, region]
  );

  const asesores = useMemo(
    () =>
      Array.from(
        new Set(
          rowsAtDate
            .filter(
              (r) =>
                (region === 'ALL' || r.REGIONAL === region) &&
                (sucursal === 'ALL' || r.SUCURSAL === sucursal)
            )
            .map((r) => r.ASESOR)
            .filter(Boolean)
        )
      ).sort(),
    [rowsAtDate, region, sucursal]
  );

  const filteredCurrent = useMemo(
    () =>
      rowsAtDate.filter((r) => {
        if (region !== 'ALL' && r.REGIONAL !== region) return false;
        if (sucursal !== 'ALL' && r.SUCURSAL !== sucursal) return false;
        if (asesor !== 'ALL' && r.ASESOR !== asesor) return false;
        return true;
      }),
    [rowsAtDate, region, sucursal, asesor]
  );

  const metrics = useMemo(() => computeDailyMetrics(filteredCurrent), [filteredCurrent]);

  // Historical evolution inside same ID_PERIODO up to selectedDate
  const history = useMemo(() => {
    const activePeriodo =
      filteredCurrent[0]?.ID_PERIODO || rowsAtDate[0]?.ID_PERIODO || '';
    const histRows = scopedDailyRows.filter((r) => {
      if (activePeriodo && r.ID_PERIODO !== activePeriodo) return false;
      if (selectedDate && r.FECHACORTE > selectedDate) return false;
      if (region !== 'ALL' && r.REGIONAL !== region) return false;
      if (sucursal !== 'ALL' && r.SUCURSAL !== sucursal) return false;
      if (asesor !== 'ALL' && r.ASESOR !== asesor) return false;
      return true;
    });
    const histDates = Array.from(new Set(histRows.map((r) => r.FECHACORTE))).sort();
    return histDates
      .map((d) => {
        const m = computeDailyMetrics(histRows.filter((r) => r.FECHACORTE === d));
        return {
          date: d,
          normalidad: m.normalidad,
          cobranza: m.cobranza,
          real: m.real,
          desembolso: m.desembolso,
        };
      })
      .filter((h) => h.normalidad > 0 || h.cobranza > 0 || h.real > 0 || h.desembolso > 0);
  }, [scopedDailyRows, filteredCurrent, rowsAtDate, selectedDate, region, sucursal, asesor]);

  if (!scopedDailyRows.length) {
    if (loading || loadingMore) {
      return (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-800">
            Cargando último corte de INDICADORES_DIARIOS...
          </p>
          <p className="text-xs text-slate-500">
            Se descarga únicamente el corte más reciente para agilizar la consulta.
          </p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="w-6 h-6 text-red-600" />
          <p className="text-sm font-semibold text-slate-900">
            No se pudieron cargar los indicadores diarios
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
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <p className="text-sm font-semibold text-slate-800">
          Sin cortes en la hoja INDICADORES_DIARIOS
        </p>
        <p className="text-xs text-slate-500 mt-1">
          El administrador puede cargar el archivo diario desde Administración → Indicadores Diarios.
        </p>
      </div>
    );
  }

  const hasUnloadedDates = dates.length > loadedDateSet.size;
  const hasMoreCutsAvailable = !historyLoaded && hasUnloadedDates;
  const isSelectedDatePending = Boolean(selectedDate && !loadedDateSet.has(selectedDate));

  return (
    <div className="space-y-5">
      {/* Daily Filter Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center gap-2.5">
        <div className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
          <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
          <select
            value={selectedDate}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedDate(next);
              if (next && !loadedDateSet.has(next) && onLoadDate) {
                onLoadDate(next);
              }
            }}
            aria-label="Fecha de corte diario"
            className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none"
          >
            {[...dates].reverse().map((d) => (
              <option key={d} value={d}>
                Corte {d}
                {loadedDateSet.has(d) ? '' : ' (cargar)'}
              </option>
            ))}
          </select>
        </div>

        <select
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            setSucursal('ALL');
            setAsesor('ALL');
          }}
          className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700"
        >
          <option value="ALL">Todas las regiones</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {regionDisplayName(r)}
            </option>
          ))}
        </select>

        <select
          value={sucursal}
          onChange={(e) => {
            setSucursal(e.target.value);
            setAsesor('ALL');
          }}
          className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700"
        >
          <option value="ALL">Todas las sucursales</option>
          {sucursales.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={asesor}
          onChange={(e) => setAsesor(e.target.value)}
          className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 min-w-[190px]"
        >
          <option value="ALL">Todos los asesores ({asesores.length})</option>
          {asesores.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {(region !== 'ALL' || sucursal !== 'ALL' || asesor !== 'ALL') && (
          <button
            type="button"
            onClick={() => {
              setRegion('ALL');
              setSucursal('ALL');
              setAsesor('ALL');
            }}
            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Limpiar
          </button>
        )}

        {(hasMoreCutsAvailable || loadingMore) && onLoadHistory && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={onLoadHistory}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-60"
          >
            {loadingMore ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>
              {loadingMore
                ? 'Cargando cortes Lun-Vie...'
                : `Cargar más cortes (${dates.length} disponibles)`}
            </span>
          </button>
        )}
      </div>

      {/* Note + Disclaimer */}
      <div className="space-y-2">
        {hasUnloadedDates && (
          <div className="px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Nota:</strong> Por defecto se carga el último corte disponible (
                <strong>{loadedDates[loadedDates.length - 1]}</strong>) y la evolución de lunes a viernes del período activo. Hay{' '}
                <strong>{dates.length} cortes</strong> registrados en total: si requieres consultar fechas de semanas anteriores, selecciónalas en el selector de fecha.
              </span>
            </div>
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

        <div className="px-4 py-2.5 rounded-lg bg-blue-50/70 border border-blue-200 flex items-center gap-2 text-xs text-blue-800">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <span>
            Cálculo aproximado de desempeño y proyección diaria ({filteredCurrent.length} registros activos en el corte {selectedDate}).
          </span>
        </div>
      </div>

      {isSelectedDatePending ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center gap-2.5 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-800">
            Cargando corte {selectedDate}...
          </p>
        </div>
      ) : (
        <>

      {/* 3 Semi-Circular Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SemiGaugeChart
          value={metrics.normalidad}
          target={0.95}
          title="Normalidad Acumulada"
          subtitle={`${fmtNum(metrics.sum('PAGOS_RECIBIDOS_ACUM'))} / ${fmtNum(
            metrics.sum('PAGOS_ESPERADOS_ACUM')
          )} pagos`}
          color={metrics.normalidad >= 0.95 ? '#16A34A' : metrics.normalidad >= 0.9 ? '#D97706' : '#DC2626'}
        />
        <SemiGaugeChart
          value={metrics.cobranza}
          target={0.95}
          title="Recuperación Cobranza $"
          subtitle={`${fmtMoneyCompact(metrics.sum('COBRANZA_RECIBIDA_ACUM'))} / ${fmtMoneyCompact(
            metrics.sum('COBRANZA_ESPERADA_ACUM')
          )}`}
          color="#2563EB"
        />
        <SemiGaugeChart
          value={metrics.renovaciones}
          target={0.85}
          title="Renovaciones en Tiempo"
          subtitle={`${fmtNum(metrics.sum('RENOVACIONES_EN_TIEMPO_ACUM'))} / ${fmtNum(
            metrics.sum('CLIENTES_RENOVADOS_ACUM')
          )} renovados`}
          color="#0EA5E9"
        />
      </div>

      {/* Income Potential & Opportunity + Desembolso / Neto */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row items-center gap-6">
          <DonutRingChart
            percent={metrics.advance}
            centerLabel={`${(metrics.advance * 100).toFixed(0)}%`}
            centerSublabel="del potencial"
            color="#2563EB"
          />
          <div className="flex-1 w-full space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Avance de Comisión Real vs Potencial
                </p>
                <p className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                  {fmtMoney(metrics.real)}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    de {fmtMoney(metrics.potential)}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-slate-500">Oportunidad por capturar</p>
                <p className="text-sm font-bold text-amber-600 tabular-nums">
                  {fmtMoney(metrics.opportunity)}
                </p>
              </div>
            </div>

            <HorizontalBarChart
              items={[
                {
                  label: 'Comisión Cobranza',
                  sublabel: `Pot. ${fmtMoneyCompact(metrics.sum('COMISION_COBRANZA_POTENCIAL'))}`,
                  value: metrics.sum('COMISION_COBRANZA_REAL'),
                  color: '#2563EB',
                  displayValue: fmtMoneyCompact(metrics.sum('COMISION_COBRANZA_REAL')),
                },
                {
                  label: 'Bono Excelencia',
                  sublabel: `Pot. ${fmtMoneyCompact(metrics.sum('BONO_EXCELENCIA_POTENCIAL'))}`,
                  value: metrics.sum('BONO_EXCELENCIA_REAL'),
                  color: '#16A34A',
                  displayValue: fmtMoneyCompact(metrics.sum('BONO_EXCELENCIA_REAL')),
                },
                {
                  label: 'Más por Ti',
                  sublabel: `Pot. ${fmtMoneyCompact(metrics.sum('COMISION_MAS_POR_TI_POTENCIAL'))}`,
                  value: metrics.sum('COMISION_MAS_POR_TI_REAL'),
                  color: '#0EA5E9',
                  displayValue: fmtMoneyCompact(metrics.sum('COMISION_MAS_POR_TI_REAL')),
                },
              ]}
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Colocación y Proyección Neta
            </p>
            <p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">
              {fmtMoney(metrics.neto)}
            </p>
            <p className="text-xs text-slate-500">Neto estimado (Com. final - descuentos)</p>
          </div>
          <div className="space-y-1.5 text-xs border-t border-slate-100 pt-3 tabular-nums">
            <div className="flex justify-between">
              <span className="text-slate-600">Desembolso acumulado</span>
              <span className="font-semibold text-slate-900">{fmtMoneyCompact(metrics.desembolso)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Comisión colocación</span>
              <span className="font-semibold text-slate-900">{fmtMoneyCompact(metrics.colocacion)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Otros incentivos</span>
              <span className="font-semibold text-slate-900">{fmtMoneyCompact(metrics.otros)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Descuentos totales</span>
              <span className="font-semibold text-red-600">
                -{fmtMoneyCompact(Math.abs(metrics.sum('DESCUENTOS_TOTALES')))}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Historical Evolution Chart + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Evolución Diaria del Periodo
            </h3>
            {hasMoreCutsAvailable && history.length <= 1 && onLoadHistory && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={onLoadHistory}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'Cargando histórico...' : 'Cargar histórico para graficar días'}
              </button>
            )}
          </div>
          <TrendLineChart
            labels={history.map((h) => h.date.slice(5))}
            series={[
              { name: 'Normalidad %', color: '#16A34A', values: history.map((h) => h.normalidad) },
              { name: 'Cobranza $ %', color: '#2563EB', values: history.map((h) => h.cobranza) },
            ]}
            valueFormat="pct"
            referenceLine={{ value: 0.95, label: 'Meta 95%', color: '#94A3B8' }}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">Bitácora de Cortes Diarios</h3>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                  <th className="py-2 px-3">Fecha</th>
                  <th className="py-2 px-3 text-right">Normalidad</th>
                  <th className="py-2 px-3 text-right">Cobranza $</th>
                  <th className="py-2 px-3 text-right">Com. Real</th>
                  <th className="py-2 px-3 text-right">Desembolso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {[...history].reverse().map((h) => (
                  <tr key={h.date} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium text-slate-900">{h.date}</td>
                    <td className="py-2 px-3 text-right font-semibold">{fmtPct(h.normalidad)}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{fmtPct(h.cobranza)}</td>
                    <td className="py-2 px-3 text-right text-slate-700">{fmtMoneyCompact(h.real)}</td>
                    <td className="py-2 px-3 text-right text-slate-700">
                      {fmtMoneyCompact(h.desembolso)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Asesor Detail Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Detalle por Asesor ({filteredCurrent.length})
          </h3>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
              <tr>
                <th className="py-2.5 px-3">Asesor</th>
                <th className="py-2.5 px-3">Región / Sucursal</th>
                <th className="py-2.5 px-3">Esquema</th>
                <th className="py-2.5 px-3 text-right">Normalidad</th>
                <th className="py-2.5 px-3 text-right">Pagos Rec / Esp</th>
                <th className="py-2.5 px-3 text-right">Com. Real</th>
                <th className="py-2.5 px-3 text-right">Potencial</th>
                <th className="py-2.5 px-3 text-right">Total a Cobrar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCurrent.slice(0, 100).map((r, i) => {
                const pe = num(r.PAGOS_ESPERADOS_ACUM);
                const pr = num(r.PAGOS_RECIBIDOS_ACUM);
                const norm = pe > 0 ? pr / pe : num(r.NORMALIDAD_ACUM);
                const rl =
                  num(r.COMISION_COBRANZA_REAL) +
                  num(r.BONO_EXCELENCIA_REAL) +
                  num(r.COMISION_MAS_POR_TI_REAL);
                const pot =
                  num(r.COMISION_COBRANZA_POTENCIAL) +
                  num(r.BONO_EXCELENCIA_POTENCIAL) +
                  num(r.COMISION_MAS_POR_TI_POTENCIAL);
                return (
                  <tr key={`${r.COD_ASESOR}-${i}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{r.ASESOR}</td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {regionDisplayName(r.REGIONAL)} · {r.SUCURSAL}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{r.MODELO_COMISION_PAGADO || '-'}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                      {fmtPct(norm)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                      {fmtNum(pr)} / {fmtNum(pe)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtMoneyCompact(rl)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                      {fmtMoneyCompact(pot)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700">
                      {fmtMoneyCompact(num(r.TOTAL_A_COBRAR))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Filter, RotateCcw, Search, X } from 'lucide-react';
import type { CorteRow, FilterState } from '../types/mcm';
import { regionDisplayName, shortPeriodo } from '../utils/mcmData';

interface FilterBarProps {
  cortes: CorteRow[];
  filters: FilterState;
  regions: string[];
  agencies: string[];
  statuses: string[];
  staffOptions: Array<{ name: string; roleHint?: string }>;
  hideHierarchyFilters?: boolean;
  onChange: (next: FilterState) => void;
  onReset: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  cortes,
  filters,
  regions,
  agencies,
  statuses,
  staffOptions,
  hideHierarchyFilters = false,
  onChange,
  onReset,
}) => {
  const [corteOpen, setCorteOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setCorteOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sortedCortes = [...cortes].sort((a, b) => b.SEMANA - a.SEMANA);
  const allCorteIds = sortedCortes.map((c) => c.CORTE);

  const corteLabel = () => {
    if (!cortes.length) return 'Sin cortes';
    if (filters.selectedCortes.length === 0 || filters.selectedCortes.length === cortes.length) {
      return `Todos los cortes (${cortes.length})`;
    }
    if (filters.selectedCortes.length === 1) {
      const c = cortes.find((x) => x.CORTE === filters.selectedCortes[0]);
      return c ? `Sem ${c.SEMANA} · ${shortPeriodo(c.PERIODO)}` : `Corte ${filters.selectedCortes[0]}`;
    }
    const sel = cortes
      .filter((x) => filters.selectedCortes.includes(x.CORTE))
      .sort((a, b) => a.SEMANA - b.SEMANA);
    return `${sel.length} semanas (S${sel[0]?.SEMANA}–S${sel[sel.length - 1]?.SEMANA})`;
  };

  const toggleCorte = (corteId: number) => {
    const has = filters.selectedCortes.includes(corteId);
    const next = has
      ? filters.selectedCortes.filter((id) => id !== corteId)
      : [...filters.selectedCortes, corteId];
    onChange({
      ...filters,
      selectedCortes: next.length ? next : [corteId],
    });
  };

  const hasCustomFilters =
    filters.region !== 'ALL' ||
    filters.agencia !== 'ALL' ||
    filters.estatus !== 'ALL' ||
    filters.ejecutivo.trim() !== '';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Multi-Corte Popover */}
        <div className="relative" ref={popRef}>
          <button
            type="button"
            onClick={() => setCorteOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>{corteLabel()}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {corteOpen && (
            <div className="absolute left-0 mt-1.5 w-80 max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden">
              <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const last = sortedCortes[0];
                    if (last) onChange({ ...filters, selectedCortes: [last.CORTE] });
                  }}
                  className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-700"
                >
                  Último corte
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const last4 = sortedCortes.slice(0, 4).map((c) => c.CORTE);
                    if (last4.length) onChange({ ...filters, selectedCortes: last4 });
                  }}
                  className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-700"
                >
                  Últimas 4 semanas
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, selectedCortes: allCorteIds })}
                  className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-700"
                >
                  Todas
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {sortedCortes.map((c) => {
                  const checked = filters.selectedCortes.includes(c.CORTE);
                  return (
                    <label
                      key={c.CORTE}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCorte(c.CORTE)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-semibold text-slate-800 w-14 shrink-0 tabular-nums">
                        Sem {c.SEMANA}
                      </span>
                      <span className="text-slate-500 truncate">{c.PERIODO}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!hideHierarchyFilters && (
          <>
            {/* Región */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400 hidden sm:inline" />
              <select
                value={filters.region}
                onChange={(e) =>
                  onChange({ ...filters, region: e.target.value, agencia: 'ALL' })
                }
                aria-label="Filtrar por región"
                className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="ALL">Todas las regiones</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {regionDisplayName(r)}
                  </option>
                ))}
              </select>
            </div>

            {/* Agencia */}
            <select
              value={filters.agencia}
              onChange={(e) => onChange({ ...filters, agencia: e.target.value })}
              aria-label="Filtrar por agencia"
              className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="ALL">Todas las agencias</option>
              {agencies.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            {/* Estatus */}
            <select
              value={filters.estatus}
              onChange={(e) => onChange({ ...filters, estatus: e.target.value })}
              aria-label="Filtrar por estatus"
              className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="ALL">Todos los estatus</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Searchable Staff / Ejecutivo */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                list="mcm-staff-datalist"
                value={filters.ejecutivo}
                onChange={(e) => onChange({ ...filters, ejecutivo: e.target.value })}
                placeholder="Buscar regional, gerente, coordinador o ejecutivo..."
                className="w-full pl-8 pr-7 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              {filters.ejecutivo && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, ejecutivo: '' })}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <datalist id="mcm-staff-datalist">
                {staffOptions.map((opt) => (
                  <option
                    key={`${opt.name}-${opt.roleHint || ''}`}
                    value={opt.name}
                    label={opt.roleHint ? `${opt.name} (${opt.roleHint})` : opt.name}
                  />
                ))}
              </datalist>
            </div>
          </>
        )}

        {hasCustomFilters && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  ListFilter,
  Shield,
  Trophy,
} from 'lucide-react';
import type {
  CorteRow,
  DirectorioRow,
  FilterState,
  IndicadorRow,
  MetaRow,
  Role,
  ScopeEntry,
} from '../types/mcm';
import {
  aggregateIndicadoresByEjecutivo,
  buildTerritoryTree,
  fmtMoney,
  fmtMoneyCompact,
  fmtMoneyShort,
  fmtNum,
  fmtPct,
  getSemaforoLabel,
  getSemaforoLevel,
  isSinRoster,
  METAS,
  MIN_PAGOS_RANK,
  num,
  personKey,
  regionDisplayName,
  regionMatchesFilter,
  resolveStaffSearchScope,
  ROLE_LABELS,
  rowMatchesStaffScope,
  shortPeriodo,
  type TreeNode,
  weightedNormalidad,
} from '../utils/mcmData';
import {
  exportIndicadoresCSV,
  exportIndicadoresEstructuraCSV,
  exportIndicadoresExcel,
  exportIndicadoresPDF,
  exportIndicadoresRankingCSV,
} from '../utils/exports';
import {
  GroupedBarChart,
  HorizontalBarChart,
  MultiSegmentDonutChart,
  TrendLineChart,
} from './Charts';
import { IndicadoresEvolutionChart } from './IndicadoresEvolutionChart';

interface IndicadoresViewProps {
  cortes: CorteRow[];
  scopedRows: IndicadorRow[];
  scopedDirRows?: DirectorioRow[];
  scopes?: {
    coordinador: ScopeEntry[];
    gerente: ScopeEntry[];
    regional: ScopeEntry[];
  };
  filters: FilterState;
  role: Role;
  userNombre: string;
  metas?: MetaRow[];
}

type IndSubTab = 'estructura' | 'ranking' | 'tabla';
type SortKey =
  | 'ejecutivo'
  | 'region'
  | 'agencia'
  | 'pct_normalidad'
  | 'monto_recibido'
  | 'clientes_vigentes'
  | 'saldo_total'
  | 'mora_total'
  | 'monto_colocacion_semanal';

const PALETTE = [
  '#2563EB',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#EF4444',
  '#14B8A6',
  '#6366F1',
  '#84CC16',
  '#F97316',
  '#64748B',
];

const SemaforoBadge: React.FC<{ pct: number | null }> = ({ pct }) => {
  const lvl = getSemaforoLevel(pct);
  const label = getSemaforoLabel(pct);
  const cls =
    lvl === 'ok'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : lvl === 'mid'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : lvl === 'bad'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded border ${cls}`}
    >
      {label}
    </span>
  );
};

export const IndicadoresView: React.FC<IndicadoresViewProps> = ({
  cortes,
  scopedRows,
  scopedDirRows = [],
  scopes,
  filters,
  role,
  userNombre,
  metas = [],
}) => {
  const [subTab, setSubTab] = useState<IndSubTab>('estructura');
  const [showCharts, setShowCharts] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['root', 't:1', 't:2', 't:3'])
  );
  const [sortKey, setSortKey] = useState<SortKey>('monto_recibido');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [tableSearch, setTableSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const corteSet = useMemo(
    () => new Set(filters.selectedCortes),
    [filters.selectedCortes]
  );

  const resolvedStaff = useMemo(
    () => resolveStaffSearchScope(filters.ejecutivo, scopedDirRows, scopes),
    [filters.ejecutivo, scopedDirRows, scopes]
  );

  // Filter rows by hierarchy + staff search (all cortes, used for historical trend)
  const hierarchyFilteredAllCortes = useMemo(() => {
    return scopedRows.filter((r) => {
      if (!regionMatchesFilter(r.region, filters.region)) return false;
      if (filters.agencia !== 'ALL' && r.agencia !== filters.agencia) return false;
      if (filters.estatus !== 'ALL' && r.estatus !== filters.estatus) return false;
      if (!rowMatchesStaffScope(r, filters.ejecutivo, resolvedStaff)) return false;
      return true;
    });
  }, [
    scopedRows,
    filters.region,
    filters.agencia,
    filters.estatus,
    filters.ejecutivo,
    resolvedStaff,
  ]);

  const activeRowsRaw = useMemo(
    () =>
      hierarchyFilteredAllCortes.filter(
        (r) => corteSet.size === 0 || corteSet.has(r.corte)
      ),
    [hierarchyFilteredAllCortes, corteSet]
  );

  const aggRows = useMemo(
    () => aggregateIndicadoresByEjecutivo(activeRowsRaw),
    [activeRowsRaw]
  );

  const rosterAggRows = useMemo(
    () => aggRows.filter((r) => !isSinRoster(r)),
    [aggRows]
  );

  // KPI calculations
  const kpis = useMemo(() => {
    const ejecCount = rosterAggRows.length;
    const sum = (f: keyof IndicadorRow) =>
      aggRows.reduce((a, r) => a + num(r[f]), 0);
    const desembolso = sum('desembolso');
    const saldoTotal = sum('saldo_total');
    const moraTotal = sum('mora_total');
    const clientesVigentes = sum('clientes_vigentes');
    const pagosEsperados = sum('pagos_esperados');
    const pagosRecibidos = sum('pagos_recibidos');
    const montoEsperado = sum('monto_esperado');
    const montoRecibido = sum('monto_recibido');
    const montoNuevos = aggRows.reduce(
      (a, r) => a + num(r.monto_nuevos_dashboard ?? r.monto_nuevos),
      0
    );
    const montoRenov = aggRows.reduce(
      (a, r) => a + num(r.monto_renovaciones_dashboard ?? r.monto_renovaciones),
      0
    );
    const clientesNuevos = sum('clientes_nuevos');
    const renovaciones = sum('renovaciones');
    const colocacionSemanal = sum('monto_colocacion_semanal');

    const totalPagare = sum('pagare');
    const promedioEjecutivo = ejecCount > 0 ? totalPagare / ejecCount : 0;
    const numCreditosTotal = sum('num_creditos') || clientesVigentes;

    const pctNorm = pagosEsperados > 0 ? pagosRecibidos / pagosEsperados : 0;
    const pctMora = saldoTotal > 0 ? moraTotal / saldoTotal : 0;
    const montoPromCliente = clientesVigentes > 0 ? saldoTotal / clientesVigentes : 0;
    const carteraPromEj = ejecCount > 0 ? saldoTotal / ejecCount : 0;
    const clientesPromEj = ejecCount > 0 ? clientesVigentes / ejecCount : 0;
    const pctRecibido = montoEsperado > 0 ? montoRecibido / montoEsperado : 0;

    return {
      ejecCount,
      desembolso,
      colocacionSemanal,
      saldoTotal,
      moraTotal,
      pctMora,
      clientesVigentes,
      numCreditosTotal,
      pagosEsperados,
      pagosRecibidos,
      pctNorm,
      montoEsperado,
      montoRecibido,
      pctRecibido,
      montoPromCliente,
      carteraPromEj,
      clientesPromEj,
      montoNuevos,
      montoRenov,
      clientesNuevos,
      renovaciones,
      totalPagare,
      promedioEjecutivo,
    };
  }, [aggRows, rosterAggRows]);

  // Territory tree
  const tree = useMemo(() => buildTerritoryTree(aggRows), [aggRows]);

  const toggleNode = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandOnlyRegions = () => {
    const next = new Set<string>(['root']);
    tree.territorios.forEach((t) => next.add(t.id));
    setExpanded(next);
  };

  const expandAllNodes = () => {
    const next = new Set<string>(['root']);
    const walk = (n: TreeNode) => {
      next.add(n.id);
      n.kids.forEach(walk);
    };
    tree.root.kids.forEach(walk);
    setExpanded(next);
  };

  const collapseAllNodes = () => setExpanded(new Set(['root']));

  // Ranking Top 10 / Bottom 10
  const ranking = useMemo(() => {
    const eligible = rosterAggRows.filter(
      (r) => r.pagos_esperados >= MIN_PAGOS_RANK && r.pct_normalidad !== null
    );
    const best = [...eligible]
      .sort((a, b) => (b.pct_normalidad || 0) - (a.pct_normalidad || 0))
      .slice(0, 10);
    const worst = [...eligible]
      .sort((a, b) => (a.pct_normalidad || 0) - (b.pct_normalidad || 0))
      .slice(0, 10);
    return { best, worst };
  }, [rosterAggRows]);

  // Comprehensive chart datasets (matching all original HTML charts)
  const chartsData = useMemo(() => {
    const recentCortes = [...cortes].sort((a, b) => a.CORTE - b.CORTE).slice(-12);
    const labels = recentCortes.map((c) => `S${c.SEMANA}`);
    const normSeries = recentCortes.map((c) => {
      const rows = hierarchyFilteredAllCortes.filter((r) => r.corte === c.CORTE);
      return rows.length ? weightedNormalidad(rows) : null;
    });

    const last6Cortes = recentCortes.slice(-6);

    // Desembolsos por tipo (Nuevos vs Renovaciones con conteo)
    const placementBars = last6Cortes.map((c) => {
      const rows = hierarchyFilteredAllCortes.filter((r) => r.corte === c.CORTE);
      return {
        label: `Sem ${c.SEMANA}`,
        values: [
          {
            name: 'Nuevos $',
            value: rows.reduce(
              (s, r) => s + num(r.monto_nuevos_dashboard ?? r.monto_nuevos),
              0
            ),
            count: rows.reduce((s, r) => s + r.clientes_nuevos, 0),
            countLabel: 'nuevos',
            color: '#2563EB',
          },
          {
            name: 'Renovaciones $',
            value: rows.reduce(
              (s, r) =>
                s + num(r.monto_renovaciones_dashboard ?? r.monto_renovaciones),
              0
            ),
            count: rows.reduce((s, r) => s + r.renovaciones, 0),
            countLabel: 'renov.',
            color: '#10B981',
          },
        ],
      };
    });

    // Cobranza semanal: Esperada vs Recibida
    const cobranzaBars = last6Cortes.map((c) => {
      const rows = hierarchyFilteredAllCortes.filter((r) => r.corte === c.CORTE);
      return {
        label: `Sem ${c.SEMANA}`,
        values: [
          {
            name: 'Esperada $',
            value: rows.reduce((s, r) => s + r.monto_esperado, 0),
            color: '#94A3B8',
          },
          {
            name: 'Recibida $',
            value: rows.reduce((s, r) => s + r.monto_recibido, 0),
            color: '#2563EB',
          },
        ],
      };
    });

    // Saldo Total y Mora Total por corte
    const saldoMoraBars = last6Cortes.map((c) => {
      const rows = hierarchyFilteredAllCortes.filter((r) => r.corte === c.CORTE);
      return {
        label: `Sem ${c.SEMANA}`,
        values: [
          {
            name: 'Saldo Total',
            value: rows.reduce((s, r) => s + r.saldo_total, 0),
            color: '#6366F1',
          },
          {
            name: 'Mora Total',
            value: rows.reduce((s, r) => s + r.mora_total, 0),
            color: '#EF4444',
          },
        ],
      };
    });

    // Colocación semanal por Región (Donut)
    const regColMap = new Map<string, number>();
    aggRows.forEach((r) => {
      const k = regionDisplayName(r.region || 'SIN REGIÓN');
      regColMap.set(k, (regColMap.get(k) || 0) + r.monto_colocacion_semanal);
    });
    const colocacionRegionDonut = Array.from(regColMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], idx) => ({
        label,
        value,
        color: PALETTE[idx % PALETTE.length],
      }));

    // Top 10 Sucursales por $ Cobranza recibida
    const sucMap = new Map<
      string,
      { region: string; monto: number; normRec: number; normEsp: number }
    >();
    aggRows.forEach((r) => {
      const k = r.agencia || 'SIN AGENCIA';
      const cur = sucMap.get(k) || {
        region: regionDisplayName(r.region || ''),
        monto: 0,
        normRec: 0,
        normEsp: 0,
      };
      cur.monto += r.monto_recibido;
      cur.normRec += r.pagos_recibidos;
      cur.normEsp += r.pagos_esperados;
      sucMap.set(k, cur);
    });
    const topSucursales = Array.from(sucMap.entries())
      .sort((a, b) => b[1].monto - a[1].monto)
      .slice(0, 10)
      .map(([name, d]) => {
        const p = d.normEsp > 0 ? d.normRec / d.normEsp : 0;
        const lvl = getSemaforoLevel(p);
        return {
          label: name,
          sublabel: `${d.region} · ${(p * 100).toFixed(1)}%`,
          value: d.monto,
          color: lvl === 'ok' ? '#10B981' : lvl === 'mid' ? '#F59E0B' : '#2563EB',
          displayValue: fmtMoneyCompact(d.monto),
        };
      });

    // Top 10 Ejecutivos por $ Cobranza recibida
    const topExecCobranza = [...rosterAggRows]
      .sort((a, b) => b.monto_recibido - a.monto_recibido)
      .slice(0, 10)
      .map((r) => ({
        label: r.ejecutivo,
        sublabel: r.agencia,
        value: r.monto_recibido,
        color: getSemaforoLevel(r.pct_normalidad) === 'bad' ? '#DC2626' : '#2563EB',
        displayValue: fmtMoneyCompact(r.monto_recibido),
      }));

    // Pagaré y Normalidad por Región
    const regMap = new Map<
      string,
      { pagare: number; normRec: number; normEsp: number }
    >();
    aggRows.forEach((r) => {
      const k = regionDisplayName(r.region || 'SIN REGIÓN');
      const cur = regMap.get(k) || { pagare: 0, normRec: 0, normEsp: 0 };
      cur.pagare += r.pagare;
      cur.normRec += r.pagos_recibidos;
      cur.normEsp += r.pagos_esperados;
      regMap.set(k, cur);
    });
    const regionBars = Array.from(regMap.entries())
      .sort((a, b) => b[1].pagare - a[1].pagare)
      .slice(0, 12)
      .map(([name, d]) => {
        const p = d.normEsp > 0 ? d.normRec / d.normEsp : 0;
        const lvl = getSemaforoLevel(p);
        return {
          label: name,
          sublabel: `${(p * 100).toFixed(1)}% norm.`,
          value: d.pagare,
          color: lvl === 'ok' ? '#16A34A' : lvl === 'mid' ? '#D97706' : '#DC2626',
          displayValue: fmtMoneyShort(d.pagare),
        };
      });

    // Meta Mensual (Hoja Metas) vs Colocación Real
    const activeExecPks = new Set(aggRows.map((r) => personKey(r.ejecutivo)));

    let relevantMetas = metas || [];
    if (filters.ejecutivo || role === 'ejecutivo') {
      const targetPk = personKey(filters.ejecutivo || userNombre);
      const filtered = (metas || []).filter((m) => personKey(m.asesor) === targetPk);
      if (filtered.length) relevantMetas = filtered;
    } else if (filters.region !== 'ALL' || filters.agencia !== 'ALL') {
      const filtered = (metas || []).filter((m) => activeExecPks.has(personKey(m.asesor)));
      if (filtered.length) relevantMetas = filtered;
    }

    const totalMetaMensual = relevantMetas.reduce((acc, m) => acc + num(m.metaTotal), 0);
    const getPlacementVal = (r: IndicadorRow) =>
      num(r.monto_colocacion_semanal) ||
      (num(r.monto_nuevos) + num(r.monto_renovaciones)) ||
      num(r.desembolso);

    const totalRealPlacement = aggRows.reduce((a, r) => a + getPlacementVal(r), 0);

    const pctCumplimiento = totalMetaMensual > 0 ? totalRealPlacement / totalMetaMensual : 0;
    const brechaMeta = totalMetaMensual - totalRealPlacement;

    const metaVsRealItems = [
      {
        label: 'Colocación Real',
        value: totalRealPlacement,
        color: '#2563EB',
        displayValue: fmtMoneyCompact(totalRealPlacement),
      },
      {
        label: 'Meta Mensual (H + I + J)',
        value: totalMetaMensual,
        color: '#16A34A',
        displayValue: fmtMoneyCompact(totalMetaMensual),
      },
    ];

    const advisorMap = new Map<
      string,
      { label: string; colAsesor: number; metaAsesor: number }
    >();

    aggRows
      .filter((r) => !isSinRoster(r))
      .forEach((r) => {
        const pk = personKey(r.ejecutivo);
        if (!pk) return;
        const col = getPlacementVal(r);
        const existing = advisorMap.get(pk);
        if (existing) {
          existing.colAsesor += col;
        } else {
          advisorMap.set(pk, {
            label: r.ejecutivo.length > 18 ? `${r.ejecutivo.slice(0, 16)}...` : r.ejecutivo,
            colAsesor: col,
            metaAsesor: 0,
          });
        }
      });

    relevantMetas.forEach((m) => {
      const pk = personKey(m.asesor);
      if (!pk) return;
      const existing = advisorMap.get(pk);
      if (existing) {
        existing.metaAsesor += num(m.metaTotal);
      } else if (!filters.ejecutivo && filters.region === 'ALL' && filters.agencia === 'ALL') {
        advisorMap.set(pk, {
          label: m.asesor.length > 18 ? `${m.asesor.slice(0, 16)}...` : m.asesor,
          colAsesor: 0,
          metaAsesor: num(m.metaTotal),
        });
      }
    });

    const advisorMetaBars = Array.from(advisorMap.values())
      .map((item) => ({
        label: item.label,
        values: [
          { name: 'Colocado $', value: item.colAsesor, color: '#2563EB' },
          { name: 'Meta $', value: item.metaAsesor, color: '#16A34A' },
        ],
        sortScore: Math.max(item.colAsesor, item.metaAsesor),
      }))
      .sort((a, b) => b.sortScore - a.sortScore)
      .slice(0, 8);

    return {
      labels,
      normSeries,
      placementBars,
      cobranzaBars,
      saldoMoraBars,
      colocacionRegionDonut,
      topSucursales,
      topExecCobranza,
      regionBars,
      metaVsRealItems,
      totalMetaMensual,
      totalRealPlacement,
      pctCumplimiento,
      brechaMeta,
      advisorMetaBars,
    };
  }, [cortes, hierarchyFilteredAllCortes, aggRows, rosterAggRows, metas, filters.ejecutivo, filters.region, filters.agencia, role, userNombre]);

  // Sortable paginated table (roster executives)
  const tableRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const filtered = rosterAggRows.filter((r) => {
      if (!q) return true;
      return (
        r.ejecutivo.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.agencia.toLowerCase().includes(q)
      );
    });
    return filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc'
          ? av.localeCompare(bv, 'es')
          : bv.localeCompare(av, 'es');
      }
      const na = Number(av ?? -1);
      const nb = Number(bv ?? -1);
      return sortDir === 'asc' ? na - nb : nb - na;
    });
  }, [rosterAggRows, tableSearch, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = tableRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'ejecutivo' || key === 'region' || key === 'agencia'
          ? 'asc'
          : 'desc'
      );
    }
  };

  const periodSubtitle = useMemo(() => {
    const sel = cortes.filter((c) => filters.selectedCortes.includes(c.CORTE));
    if (!sel.length) return 'Todos los cortes';
    if (sel.length === 1)
      return `Semana ${sel[0].SEMANA} (${shortPeriodo(sel[0].PERIODO)})`;
    return `${sel.length} semanas seleccionadas`;
  }, [cortes, filters.selectedCortes]);

  const renderTreeRows = (node: TreeNode): React.ReactNode[] => {
    const isOpen = expanded.has(node.id);
    const hasKids = node.kids.length > 0;
    const norm = node.m.pe > 0 ? node.m.pr / node.m.pe : null;
    const moraPct = node.m.saldo > 0 ? node.m.mora / node.m.saldo : 0;
    const indentPx = node.lvl * 18;

    const rows: React.ReactNode[] = [
      <tr
        key={node.id}
        className={`border-b border-slate-100 hover:bg-slate-50/80 ${
          node.lvl === 0
            ? 'bg-slate-100/70 font-semibold'
            : node.lvl === 1
            ? 'bg-slate-50/60 font-semibold'
            : node.lvl === 2
            ? 'font-medium'
            : ''
        }`}
      >
        <td className="py-2.5 pr-3 pl-3 text-xs text-slate-900">
          <div
            className="flex items-center gap-1.5"
            style={{ paddingLeft: `${indentPx}px` }}
          >
            {hasKids ? (
              <button
                type="button"
                onClick={() => toggleNode(node.id)}
                className="p-0.5 rounded hover:bg-slate-200/70 text-slate-500"
                aria-label={isOpen ? 'Contraer' : 'Expandir'}
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-4 inline-block" />
            )}
            <span className="truncate">{node.label}</span>
            {node.lvl === 4 && node.estatus && node.estatus !== '-' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {node.estatus}
              </span>
            )}
          </div>
        </td>
        <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-700">
          {fmtMoneyCompact(node.m.pag)}
        </td>
        <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-700">
          {fmtNum(node.m.cli)}
        </td>
        <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-600">
          {fmtNum(node.m.pr)} / {fmtNum(node.m.pe)}
        </td>
        <td className="py-2.5 px-3 text-xs text-right tabular-nums font-semibold text-slate-900">
          <div className="inline-flex items-center gap-2">
            <span>{fmtPct(norm)}</span>
            <SemaforoBadge pct={norm} />
          </div>
        </td>
        <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-700">
          {fmtMoneyCompact(node.m.saldo)}
        </td>
        <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-600">
          {fmtPct(moraPct)}
        </td>
      </tr>,
    ];

    if (hasKids && isOpen) {
      node.kids.forEach((child) => {
        rows.push(...renderTreeRows(child));
      });
    }
    return rows;
  };

  if (!scopedRows.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <p className="text-sm font-semibold text-slate-800">
          Sin datos de indicadores disponibles para tu perfil
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Verifica la hoja INDICADORES o el alcance asignado en SCOPE_*.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Personal banner for Ejecutivo */}
      {role === 'ejecutivo' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              Mi Desempeño Personal
            </p>
            <h2 className="text-base font-bold text-slate-900 mt-0.5">
              {userNombre}
            </h2>
            <p className="text-xs text-slate-500">{periodSubtitle}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-slate-500">Normalidad</p>
              <p className="text-xl font-bold tabular-nums text-slate-900">
                {fmtPct(kpis.pctNorm)}
              </p>
            </div>
            <SemaforoBadge pct={kpis.pctNorm} />
          </div>
        </div>
      )}

      {/* Hierarchy Staff Scope Banner when filtering by Regional / Gerente / Coordinador */}
      {resolvedStaff && (
        <div className="bg-blue-50/80 border border-blue-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 text-xs text-blue-900">
            <Shield className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>Alcance por {ROLE_LABELS[resolvedStaff.mode]}:</strong>{' '}
              {resolvedStaff.matchedName}
              {resolvedStaff.regions.size > 0 && (
                <span className="text-blue-700 ml-1.5">
                  ({Array.from(resolvedStaff.regions).join(', ')})
                </span>
              )}
            </span>
          </div>
          <span className="text-xs font-semibold text-blue-800 tabular-nums">
            {fmtNum(kpis.ejecCount)} ejecutivos en alcance
          </span>
        </div>
      )}

      {/* Top Summary Cards for Current Selection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-blue-100 uppercase tracking-wider">Colocación Total</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{fmtMoneyCompact(kpis.colocacionSemanal || kpis.desembolso)}</p>
          <p className="text-xs text-blue-100 mt-1">Nuevos: {fmtMoneyShort(kpis.montoNuevos)} · Renov: {fmtMoneyShort(kpis.montoRenov)}</p>
        </div>
        <div className="bg-gradient-to-br from-red-600 to-rose-700 text-white rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-red-100 uppercase tracking-wider">Cartera Vencida (Mora)</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{fmtMoneyCompact(kpis.moraTotal)}</p>
          <p className="text-xs text-red-100 mt-1">Índice de mora: {fmtPct(kpis.pctMora)}</p>
        </div>
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-300 uppercase tracking-wider">Número de Créditos</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{fmtNum(kpis.numCreditosTotal)}</p>
          <p className="text-xs text-slate-300 mt-1">Clientes vigentes en selección</p>
        </div>
      </div>

      {/* Goal-Tracked KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              Normalidad de Cartera
            </span>
            <SemaforoBadge pct={kpis.pctNorm} />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {fmtPct(kpis.pctNorm)}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              Meta {fmtPct(METAS.normalidad)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 tabular-nums">
            {fmtNum(kpis.pagosRecibidos)} recibidos de{' '}
            {fmtNum(kpis.pagosEsperados)} esperados
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              Pagaré Total
            </span>
            <span className="text-xs font-semibold text-slate-700 tabular-nums">
              Mora {fmtPct(kpis.pctMora)}
            </span>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {fmtMoneyCompact(kpis.totalPagare)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 tabular-nums">
            Saldo: {fmtMoneyShort(kpis.saldoTotal)} · Mora: {fmtMoneyShort(kpis.moraTotal)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              Cobranza $ Recibida
            </span>
            <span className="text-xs font-semibold text-blue-700 tabular-nums">
              {fmtPct(kpis.pctRecibido)}
            </span>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {fmtMoneyCompact(kpis.montoRecibido)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 tabular-nums">
            Esperado: {fmtMoneyCompact(kpis.montoEsperado)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">
            Colocación y Desembolsos
          </span>
          <div className="mt-2">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {fmtMoneyCompact(kpis.colocacionSemanal || kpis.desembolso)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 tabular-nums">
            Nuevos ({fmtNum(kpis.clientesNuevos)}):{' '}
            {fmtMoneyShort(kpis.montoNuevos)} · Renov ({fmtNum(kpis.renovaciones)}):{' '}
            {fmtMoneyShort(kpis.montoRenov)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">
            Clientes Vigentes
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {fmtNum(kpis.clientesVigentes)}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {fmtNum(kpis.ejecCount)} ejecutivos
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 tabular-nums">
            Saldo prom./cliente: {fmtMoneyCompact(kpis.montoPromCliente)} (Meta{' '}
            {fmtMoneyCompact(METAS.montoPromedio)})
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">
            Promedio por Ejecutivo (Pagaré)
          </span>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {fmtMoneyShort(kpis.promedioEjecutivo)}
            </span>
            <span className="text-xs font-semibold text-slate-700 tabular-nums">
              {fmtNum(kpis.ejecCount)} activos
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 tabular-nums">
            Pagaré total / ejecutivos activos · Meta: {fmtMoneyShort(METAS.carteraPorEjecutivo)}
          </p>
        </div>
      </div>

      {/* Visible Charts Dashboard Section */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Análisis Gráfico de Indicadores ({periodSubtitle})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowCharts((v) => !v)}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2.5 py-1 rounded-md border border-slate-200 bg-white"
          >
            {showCharts ? 'Ocultar gráficas' : 'Mostrar gráficas'}
          </button>
        </div>

        {showCharts && (
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <IndicadoresEvolutionChart
              cortes={cortes}
              rowsAllCortes={hierarchyFilteredAllCortes}
              selectedCortes={filters.selectedCortes}
            />

            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Tendencia Histórica de % Normalidad
              </h4>
              <TrendLineChart
                labels={chartsData.labels}
                series={[
                  {
                    name: '% Normalidad',
                    color: '#2563EB',
                    values: chartsData.normSeries,
                  },
                ]}
                valueFormat="pct"
                referenceLine={{
                  value: METAS.normalidad,
                  label: 'Meta 95%',
                  color: '#16A34A',
                }}
              />
            </div>

            <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Meta Mensual de Colocación Alcanzada
                  </h4>
                  <span
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      chartsData.pctCumplimiento >= 1
                        ? 'bg-emerald-100 text-emerald-800'
                        : chartsData.pctCumplimiento >= 0.8
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {(chartsData.pctCumplimiento * 100).toFixed(1)}% de la meta
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-2.5 mb-3 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      chartsData.pctCumplimiento >= 1 ? 'bg-emerald-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, chartsData.pctCumplimiento * 100))}%` }}
                  />
                </div>

                {/* KPI Metrics */}
                <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                  <div className="p-2 bg-blue-50/70 border border-blue-100 rounded-lg">
                    <p className="text-[10px] uppercase font-semibold text-blue-700">Colocado</p>
                    <p className="text-sm font-bold text-blue-900 mt-0.5 tabular-nums">
                      {fmtMoneyCompact(chartsData.totalRealPlacement)}
                    </p>
                  </div>
                  <div className="p-2 bg-emerald-50/70 border border-emerald-100 rounded-lg">
                    <p className="text-[10px] uppercase font-semibold text-emerald-700">Meta Mensual</p>
                    <p className="text-sm font-bold text-emerald-900 mt-0.5 tabular-nums">
                      {fmtMoneyCompact(chartsData.totalMetaMensual)}
                    </p>
                  </div>
                  <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-[10px] uppercase font-semibold text-slate-500">
                      {chartsData.brechaMeta <= 0 ? 'Superávit' : 'Faltante'}
                    </p>
                    <p
                      className={`text-sm font-bold mt-0.5 tabular-nums ${
                        chartsData.brechaMeta <= 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {fmtMoneyCompact(Math.abs(chartsData.brechaMeta))}
                    </p>
                  </div>
                </div>
              </div>

              {/* Global Total Comparison Bar */}
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Total Colocado vs Suma Meta Mensual (Cols H + I + J)
                </p>
                <HorizontalBarChart items={chartsData.metaVsRealItems} />
              </div>

              {/* Advisor Breakdown if available */}
              {chartsData.advisorMetaBars.length > 1 ? (
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Comparativo por Asesor (Colocado vs Meta)
                  </p>
                  <GroupedBarChart
                    items={chartsData.advisorMetaBars}
                    valueFormat="money"
                  />
                </div>
              ) : chartsData.totalMetaMensual === 0 ? (
                <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-lg text-xs text-amber-800">
                  <p className="font-semibold">Sin metas registradas en la hoja 'Metas'</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Verifica que la hoja 'Metas' contenga datos (Columna A: Fecha, Columna D: Asesor, Columnas H, I, J: Metas). Si actualizaste el archivo en Google Sheets, pulsa <strong>Actualizar</strong> en la barra superior.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Cobranza Semanal: $ Esperada vs $ Recibida
              </h4>
              <GroupedBarChart
                items={chartsData.cobranzaBars}
                valueFormat="money"
              />
            </div>

            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Saldo Total y Mora Total por Corte
              </h4>
              <GroupedBarChart
                items={chartsData.saldoMoraBars}
                valueFormat="money"
              />
            </div>

            {role !== 'ejecutivo' && (
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Pagaré y Normalidad por Región
                </h4>
                <HorizontalBarChart items={chartsData.regionBars} />
              </div>
            )}

            {role !== 'ejecutivo' && (
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Top 10 Sucursales por $ Cobranza Recibida
                </h4>
                <HorizontalBarChart items={chartsData.topSucursales} />
              </div>
            )}

            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Top 10 Ejecutivos por $ Cobranza Recibida
              </h4>
              <HorizontalBarChart items={chartsData.topExecCobranza} />
            </div>
          </div>
        )}
      </div>

      {/* Sub-navigation Data Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1">
            {[
              { id: 'estructura' as const, label: 'Estructura dinámica', icon: Layers },
              { id: 'ranking' as const, label: 'Ranking de ejecutivos', icon: Trophy },
              { id: 'tabla' as const, label: 'Tabla detalle', icon: ListFilter },
            ].map((t) => {
              const Icon = t.icon;
              const active = subTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSubTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (subTab === 'estructura') {
                  exportIndicadoresEstructuraCSV(tree.root, expanded);
                } else if (subTab === 'ranking') {
                  exportIndicadoresRankingCSV(ranking.best, ranking.worst);
                } else {
                  exportIndicadoresCSV(tableRows);
                }
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => exportIndicadoresExcel(tableRows)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              Excel
            </button>
            <button
              type="button"
              onClick={() => exportIndicadoresPDF(tableRows, periodSubtitle)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <FileText className="w-3.5 h-3.5 text-red-600" />
              PDF
            </button>
          </div>
        </div>

        {/* Sub-tab 1: Estructura dinámica */}
        {subTab === 'estructura' && (
          <div>
            <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500">
                Jerarquía Territorio → Región → Agencia → Ejecutivo ({fmtNum(aggRows.length)}{' '}
                registros)
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={expandOnlyRegions}
                  className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 rounded-md hover:bg-slate-100 text-slate-700"
                >
                  Solo regiones
                </button>
                <button
                  type="button"
                  onClick={expandAllNodes}
                  className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 rounded-md hover:bg-slate-100 text-slate-700"
                >
                  Expandir todo
                </button>
                <button
                  type="button"
                  onClick={collapseAllNodes}
                  className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 rounded-md hover:bg-slate-100 text-slate-700"
                >
                  Contraer todo
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 pl-3 pr-3">Unidad / Ejecutivo</th>
                    <th className="py-2.5 px-3 text-right">Desembolso</th>
                    <th className="py-2.5 px-3 text-right">Clientes</th>
                    <th className="py-2.5 px-3 text-right">Pagos Rec / Esp</th>
                    <th className="py-2.5 px-3 text-right">% Normalidad</th>
                    <th className="py-2.5 px-3 text-right">Saldo Total</th>
                    <th className="py-2.5 px-3 text-right">% Mora</th>
                  </tr>
                </thead>
                <tbody>{renderTreeRows(tree.root)}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sub-tab 2: Ranking */}
        {subTab === 'ranking' && (
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-emerald-50/70 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Top 10 Mejores en Normalidad
                </h3>
                <span className="text-[11px] text-emerald-700">
                  Mín. {MIN_PAGOS_RANK} pagos esp.
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {ranking.best.map((r, i) => (
                  <div
                    key={`${r.ejecutivo}-${i}`}
                    className="px-4 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {r.ejecutivo}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {regionDisplayName(r.region)} · {r.agencia}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-emerald-700 tabular-nums">
                        {fmtPct(r.pct_normalidad)}
                      </p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {fmtNum(r.pagos_recibidos)} / {fmtNum(r.pagos_esperados)}
                      </p>
                    </div>
                  </div>
                ))}
                {ranking.best.length === 0 && (
                  <p className="py-8 text-center text-xs text-slate-500">
                    Sin ejecutivos elegibles.
                  </p>
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-red-50/70 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-red-800">
                  Top 10 Menor Normalidad (Foco)
                </h3>
                <span className="text-[11px] text-red-700">
                  Mín. {MIN_PAGOS_RANK} pagos esp.
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {ranking.worst.map((r, i) => (
                  <div
                    key={`${r.ejecutivo}-${i}`}
                    className="px-4 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-red-100 text-red-800 text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {r.ejecutivo}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {regionDisplayName(r.region)} · {r.agencia}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-red-700 tabular-nums">
                        {fmtPct(r.pct_normalidad)}
                      </p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {fmtNum(r.pagos_recibidos)} / {fmtNum(r.pagos_esperados)}
                      </p>
                    </div>
                  </div>
                ))}
                {ranking.worst.length === 0 && (
                  <p className="py-8 text-center text-xs text-slate-500">
                    Sin ejecutivos elegibles.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sub-tab 3: Tabla detalle */}
        {subTab === 'tabla' && (
          <div>
            <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => {
                  setTableSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Filtrar en tabla por ejecutivo, región o agencia..."
                className="w-full sm:w-80 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <span className="text-xs text-slate-500 tabular-nums">
                {tableRows.length} registros · Pág. {safePage} de {totalPages}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {[
                      { key: 'ejecutivo' as const, label: 'Ejecutivo', align: 'left' },
                      { key: 'region' as const, label: 'Región', align: 'left' },
                      { key: 'agencia' as const, label: 'Agencia', align: 'left' },
                      { key: 'pct_normalidad' as const, label: 'Normalidad', align: 'right' },
                      { key: 'monto_recibido' as const, label: '$ Recibido', align: 'right' },
                      { key: 'clientes_vigentes' as const, label: 'Clientes', align: 'right' },
                      { key: 'saldo_total' as const, label: 'Saldo Total', align: 'right' },
                      { key: 'mora_total' as const, label: 'Mora Total', align: 'right' },
                      {
                        key: 'monto_colocacion_semanal' as const,
                        label: 'Colocación $',
                        align: 'right',
                      },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={`py-2.5 px-3 cursor-pointer select-none hover:text-slate-800 ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {col.label}
                        {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {pagedRows.map((r, i) => (
                    <tr
                      key={`${personKey(r.ejecutivo)}-${r.agencia}-${i}`}
                      className="hover:bg-slate-50/80"
                    >
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        {r.ejecutivo}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {regionDisplayName(r.region)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{r.agencia}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900">
                            {fmtPct(r.pct_normalidad)}
                          </span>
                          <SemaforoBadge pct={r.pct_normalidad} />
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                        {fmtMoney(r.monto_recibido)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                        {fmtNum(r.clientes_vigentes)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                        {fmtMoney(r.saldo_total)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-red-600">
                        {fmtMoney(r.mora_total)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                        {fmtMoney(r.monto_colocacion_semanal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-slate-500 tabular-nums">
                  Página {safePage} de {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

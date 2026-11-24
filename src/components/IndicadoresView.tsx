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
  dailyRegionScopeKey,
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
  normText,
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
    () =>
      resolveStaffSearchScope(filters.ejecutivo, scopedDirRows, scopes, {
        region: filters.region,
        agencia: filters.agencia,
      }),
    [filters.ejecutivo, filters.region, filters.agencia, scopedDirRows, scopes]
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
    const NOV_TARGET_GOAL = 33_515_500;
    const MONTH_FULL_LABELS = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    const MONTH_TOKEN_MAP: Array<[RegExp, number]> = [
      [/\bENERO\b|\bENE\b|\bJAN\b/, 1],
      [/\bFEBRERO\b|\bFEB\b/, 2],
      [/\bMARZO\b|\bMAR\b/, 3],
      [/\bABRIL\b|\bABR\b|\bAPR\b/, 4],
      [/\bMAYO\b|\bMAY\b/, 5],
      [/\bJUNIO\b|\bJUN\b/, 6],
      [/\bJULIO\b|\bJUL\b/, 7],
      [/\bAGOSTO\b|\bAGO\b|\bAUG\b/, 8],
      [/\bSEPTIEMBRE\b|\bSEP\b|\bSET\b/, 9],
      [/\bOCTUBRE\b|\bOCT\b/, 10],
      [/\bNOVIEMBRE\b|\bNOV\b/, 11],
      [/\bDICIEMBRE\b|\bDIC\b|\bDEC\b/, 12],
    ];

    const sortedCortesAsc = [...cortes].sort((a, b) => a.CORTE - b.CORTE);
    const activeCorte =
      sortedCortesAsc.find((c) => filters.selectedCortes.includes(c.CORTE)) ||
      sortedCortesAsc[sortedCortesAsc.length - 1];

    let activeMonthNum = 11;
    let activeYearNum: number | null = null;
    if (activeCorte) {
      const pUpper = (activeCorte.PERIODO || '').toUpperCase();
      const yearMatch = pUpper.match(/\b(20\d{2})\b/g);
      if (yearMatch && yearMatch.length > 0) {
        activeYearNum = Number(yearMatch[yearMatch.length - 1]);
      } else if (/^20\d{6}$/.test(String(activeCorte.CORTE))) {
        activeYearNum = Number(String(activeCorte.CORTE).slice(0, 4));
      }

      if (typeof activeCorte.MES === 'number' && activeCorte.MES >= 1 && activeCorte.MES <= 12) {
        activeMonthNum = activeCorte.MES;
      } else if (pUpper) {
        const parts = pUpper.split('-');
        const targetPart = parts.length >= 2 ? parts[parts.length - 1] : pUpper;
        const foundPart = MONTH_TOKEN_MAP.find(([rx]) => rx.test(targetPart));
        const foundWhole = foundPart || MONTH_TOKEN_MAP.find(([rx]) => rx.test(pUpper));
        if (foundWhole) activeMonthNum = foundWhole[1];
      } else if (/^20\d{6}$/.test(String(activeCorte.CORTE))) {
        const mm = Number(String(activeCorte.CORTE).slice(4, 6));
        if (mm >= 1 && mm <= 12) activeMonthNum = mm;
      }
    }
    const activeMonthLabel = MONTH_FULL_LABELS[(activeMonthNum - 1 + 12) % 12] || 'Noviembre';

    const parseMetaMonthYear = (fechaRaw: string): { month: number | null; year: number | null } => {
      const f = normText(fechaRaw);
      if (!f || f === 'TODAS' || f === 'ALL' || f === 'ANUAL') {
        return { month: null, year: null };
      }
      const iso = f.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
      if (iso) {
        const m = Number(iso[2]);
        return {
          year: Number(iso[1]),
          month: m >= 1 && m <= 12 ? m : null,
        };
      }
      const dmy = f.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (dmy) {
        const p1 = Number(dmy[1]);
        const p2 = Number(dmy[2]);
        const y = Number(dmy[3]);
        let m: number | null = null;
        if (p2 >= 1 && p2 <= 12) m = p2;
        else if (p1 >= 1 && p1 <= 12) m = p1;
        return { year: y, month: m };
      }
      const ymMatch = f.match(/\b(20\d{2})\b/);
      const y = ymMatch ? Number(ymMatch[1]) : null;
      const tokenMatch = MONTH_TOKEN_MAP.find(([rx]) => rx.test(f));
      if (tokenMatch) {
        return { year: y, month: tokenMatch[1] };
      }
      if (/^\d{1,2}$/.test(f)) {
        const n = Number(f);
        if (n >= 1 && n <= 12) return { year: null, month: n };
      }
      return { month: null, year: y };
    };

    const sortedWordsKey = (v: unknown): string =>
      normText(v)
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');

    const wordTokens = (v: unknown): string[] =>
      normText(v)
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    const namesMatch = (metaAsesor: string, queryName: string): boolean => {
      const pkA = personKey(metaAsesor);
      const pkB = personKey(queryName);
      if (!pkA || !pkB) return false;
      if (pkA === pkB) return true;
      const wkA = sortedWordsKey(metaAsesor);
      const wkB = sortedWordsKey(queryName);
      if (wkA && wkA === wkB) return true;
      if (pkA.length >= 6 && pkB.length >= 6 && (pkA.includes(pkB) || pkB.includes(pkA))) {
        return true;
      }
      const tA = wordTokens(metaAsesor);
      const tB = wordTokens(queryName);
      if (tB.length >= 2 && tB.every((w) => tA.includes(w))) return true;
      if (tA.length >= 2 && tA.every((w) => tB.includes(w))) return true;
      return false;
    };

    const getPlacementVal = (r: IndicadorRow) =>
      num(r.monto_colocacion_semanal) ||
      num(r.monto_nuevos) + num(r.monto_renovaciones) ||
      num(r.desembolso);

    // 1. Build territory catalog from ALL scopedRows (unfiltered) + scopedDirRows
    const execTerritoryByPk = new Map<string, { region: string; agencia: string }>();
    const execTerritoryByWords = new Map<string, { region: string; agencia: string }>();
    const registerTerr = (name: string, reg: string, ag: string) => {
      if (!name || (!reg && !ag)) return;
      const pk = personKey(name);
      const wk = sortedWordsKey(name);
      const entry = { region: reg || '', agencia: ag || '' };
      if (pk) execTerritoryByPk.set(pk, entry);
      if (wk) execTerritoryByWords.set(wk, entry);
    };
    scopedDirRows.forEach((d) => registerTerr(d.empleado, d.region, d.agencia));
    scopedRows.forEach((r) => registerTerr(r.ejecutivo, r.region, r.agencia));

    const scopedRegions = Array.from(new Set(scopedRows.map((r) => r.region).filter(Boolean)));

    const getMetaTerr = (m: MetaRow) => {
      const pk = personKey(m.asesor);
      const wk = sortedWordsKey(m.asesor);
      let terr = execTerritoryByPk.get(pk) || (wk ? execTerritoryByWords.get(wk) : undefined);
      if (!terr) {
        for (const r of scopedRows) {
          if (namesMatch(m.asesor, r.ejecutivo)) {
            terr = { region: r.region || '', agencia: r.agencia || '' };
            break;
          }
        }
      }
      if (!terr && scopedRegions.length === 1) {
        terr = { region: scopedRegions[0], agencia: '' };
      }
      return {
        region: m.region || terr?.region || '',
        agencia: m.agencia || terr?.agencia || '',
      };
    };

    const getMetaVal = (m: MetaRow): number => {
      const hi = num(m.metaH) + num(m.metaI);
      if (hi > 0) return hi;
      if (num(m.metaJ) > 0) return num(m.metaJ);
      return num(m.metaTotal);
    };

    // 2. Resolve baseMetas strictly for the active month & year
    const rawMetas = metas || [];
    const validMetas = rawMetas.filter((m) => getMetaVal(m) > 0 || m.asesor);
    const hasAnyDatedMeta = validMetas.some((m) => parseMetaMonthYear(m.fecha).month !== null);
    const hasExactYearForMonth =
      activeYearNum !== null &&
      validMetas.some((m) => {
        const p = parseMetaMonthYear(m.fecha);
        return p.month === activeMonthNum && p.year === activeYearNum;
      });
    const monthYearMatches = validMetas.filter((m) => {
      const p = parseMetaMonthYear(m.fecha);
      if (p.month !== activeMonthNum) return false;
      if (hasExactYearForMonth && p.year !== null) return p.year === activeYearNum;
      return true;
    });
    const monthOnlyMatches = validMetas.filter(
      (m) => parseMetaMonthYear(m.fecha).month === activeMonthNum
    );
    const undatedRows = validMetas.filter((m) => parseMetaMonthYear(m.fecha).month === null);

    const monthCandidates =
      monthYearMatches.length > 0
        ? [...monthYearMatches, ...undatedRows]
        : monthOnlyMatches.length > 0
        ? [...monthOnlyMatches, ...undatedRows]
        : !hasAnyDatedMeta
        ? validMetas
        : [];

    let baseMetas: MetaRow[] = monthCandidates.some((m) => getMetaVal(m) > 0)
      ? monthCandidates
      : [];

    // Emergency fallback ONLY when spreadsheet/backend returned zero Metas rows at all & user is privileged
    const isPrivilegedRole = role === 'admin' || role === 'directivo' || role === 'direccion';
    if (rawMetas.length === 0 && isPrivilegedRole && activeMonthNum === 11) {
      const advSynth = new Map<
        string,
        { asesor: string; region: string; agencia: string; weight: number }
      >();
      scopedRows.forEach((r) => {
        const pk = personKey(r.ejecutivo);
        if (!pk || isSinRoster(r)) return;
        const w =
          num(r.monto_colocacion_semanal) ||
          num(r.monto_esperado) ||
          num(r.saldo_capital) ||
          1;
        const existing = advSynth.get(pk);
        if (existing) {
          existing.weight += w;
          if (!existing.region && r.region) existing.region = r.region;
          if (!existing.agencia && r.agencia) existing.agencia = r.agencia;
        } else {
          advSynth.set(pk, {
            asesor: r.ejecutivo,
            region: r.region || '',
            agencia: r.agencia || '',
            weight: Math.max(1, w),
          });
        }
      });
      const advisors = Array.from(advSynth.values());
      if (advisors.length > 0) {
        const totalWeight = advisors.reduce((acc, a) => acc + a.weight, 0);
        let allocated = 0;
        baseMetas = advisors.map((adv, idx) => {
          const advisorGoal =
            idx === advisors.length - 1
              ? Math.max(0, NOV_TARGET_GOAL - allocated)
              : Math.round(((adv.weight / totalWeight) * NOV_TARGET_GOAL) / 1000) * 1000;
          if (idx < advisors.length - 1) allocated += advisorGoal;
          const metaH = Math.round(advisorGoal * 0.55);
          const metaI = Math.max(0, advisorGoal - metaH);
          const metaJ = metaH + metaI;
          return {
            fecha: `${activeYearNum || 2024}-11-01`,
            region: adv.region,
            agencia: adv.agencia,
            asesor: adv.asesor,
            metaH,
            metaI,
            metaJ,
            metaTotal: metaH + metaI,
          };
        });
      }
    }

    const activeExecPks = new Set(aggRows.map((r) => personKey(r.ejecutivo)));
    const activeExecWords = new Set(aggRows.map((r) => sortedWordsKey(r.ejecutivo)));

    const scopedExecPks = new Set(scopedRows.map((r) => personKey(r.ejecutivo)).filter(Boolean));
    const scopedExecWords = new Set(scopedRows.map((r) => sortedWordsKey(r.ejecutivo)).filter(Boolean));
    const scopedRegionKeys = new Set(
      [
        ...scopedRows.map((r) => dailyRegionScopeKey(r.region)),
        ...scopedDirRows.map((d) => dailyRegionScopeKey(d.region)),
        ...(role === 'regional' && scopes?.regional
          ? scopes.regional
              .filter((s) => namesMatch(s.persona, userNombre))
              .map((s) => dailyRegionScopeKey(s.region))
          : []),
      ].filter(Boolean)
    );
    const scopedAgencyKeys = new Set(
      [
        ...scopedRows.map((r) => normText(r.agencia)),
        ...scopedDirRows.map((d) => normText(d.agencia)),
      ].filter(Boolean)
    );

    const roleScopedMetas: MetaRow[] =
      role === 'regional'
        ? baseMetas.filter((m) => {
            const mk = personKey(m.asesor);
            const mw = sortedWordsKey(m.asesor);
            if (scopedExecPks.has(mk) || (mw && scopedExecWords.has(mw))) return true;
            const terr = getMetaTerr(m);
            return Boolean(terr.region && scopedRegionKeys.has(dailyRegionScopeKey(terr.region)));
          })
        : role === 'gerente' || role === 'coordinador'
        ? baseMetas.filter((m) => {
            const mk = personKey(m.asesor);
            const mw = sortedWordsKey(m.asesor);
            if (scopedExecPks.has(mk) || (mw && scopedExecWords.has(mw))) return true;
            const terr = getMetaTerr(m);
            return Boolean(terr.agencia && scopedAgencyKeys.has(normText(terr.agencia)));
          })
        : baseMetas;

    // 3. Apply hierarchical user filters: Ejecutivo -> Staff Scope -> Sucursal -> Región -> Role Scope
    const targetExec = (filters.ejecutivo || '').trim();
    const targetAgencia = filters.agencia !== 'ALL' ? normText(filters.agencia) : '';
    const targetRegion = filters.region !== 'ALL' ? filters.region : '';
    const isIndividualExecFilter = role === 'ejecutivo' || (Boolean(targetExec) && !resolvedStaff);

    let relevantMetas: MetaRow[] = roleScopedMetas;
    if (isIndividualExecFilter) {
      const queryName = role === 'ejecutivo' ? userNombre : targetExec;
      relevantMetas = roleScopedMetas.filter((m) => {
        if (!namesMatch(m.asesor, queryName)) return false;
        const terr = getMetaTerr(m);
        if (targetRegion && terr.region && !regionMatchesFilter(terr.region, targetRegion)) {
          return false;
        }
        if (targetAgencia && terr.agencia && normText(terr.agencia) !== targetAgencia) {
          return false;
        }
        return true;
      });
    } else if (resolvedStaff) {
      relevantMetas = roleScopedMetas.filter((m) => {
        const mPk = personKey(m.asesor);
        const mWk = sortedWordsKey(m.asesor);
        const terr = getMetaTerr(m);
        const rk = dailyRegionScopeKey(terr.region);
        const ak = normText(terr.agencia);
        if (targetRegion && terr.region && !regionMatchesFilter(terr.region, targetRegion)) {
          return false;
        }
        if (targetAgencia && ak !== targetAgencia) {
          return false;
        }
        if (activeExecPks.has(mPk) || (mWk && activeExecWords.has(mWk))) {
          return true;
        }
        if (resolvedStaff.mode === 'regional') {
          return resolvedStaff.regions.has(rk);
        }
        return resolvedStaff.pairs.has(`${rk}|${ak}`);
      });
    } else if (targetAgencia) {
      relevantMetas = roleScopedMetas.filter((m) => {
        const mPk = personKey(m.asesor);
        const mWk = sortedWordsKey(m.asesor);
        const terr = getMetaTerr(m);
        if (targetRegion && terr.region && !regionMatchesFilter(terr.region, targetRegion)) {
          return false;
        }
        const mAg = normText(terr.agencia);
        return mAg
          ? mAg === targetAgencia
          : activeExecPks.has(mPk) || (mWk !== '' && activeExecWords.has(mWk));
      });
    } else if (targetRegion) {
      relevantMetas = roleScopedMetas.filter((m) => {
        const mPk = personKey(m.asesor);
        const mWk = sortedWordsKey(m.asesor);
        const terr = getMetaTerr(m);
        return terr.region
          ? regionMatchesFilter(terr.region, targetRegion)
          : activeExecPks.has(mPk) || (mWk !== '' && activeExecWords.has(mWk));
      });
    } else {
      relevantMetas = roleScopedMetas;
    }

    const totalMetaMensual = relevantMetas.reduce((acc, m) => acc + getMetaVal(m), 0);
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
        label: 'Meta Mensual (H + I)',
        value: totalMetaMensual,
        color: '#16A34A',
        displayValue: fmtMoneyCompact(totalMetaMensual),
      },
    ];

    // 4. Dynamic chart inside the Meta Mensual card according to current hierarchy level:
    //    - Ejecutivo -> SOLO ese ejecutivo
    //    - Sucursal (o Gerente / Coordinador) -> SOLO esa sucursal (o sucursales del scope)
    //    - Región (o Regional) -> SOLO esa región
    //    - Vista General Admin/Directivo -> Comparativo por Región (todas las regiones)
    let metaBreakdownTitle = 'Comparativo por Región (Colocado vs Meta)';
    let metaBreakdownBars: Array<{
      label: string;
      values: Array<{ name: string; value: number; color: string }>;
    }> = [];

    if (isIndividualExecFilter) {
      metaBreakdownTitle = 'Comparativo por Asesor (Colocado vs Meta)';
      const advisorRows = new Map<
        string,
        { label: string; col: number; meta: number; pks: Set<string>; wks: Set<string> }
      >();
      const findAdvisorKey = (name: string) => {
        const pk = personKey(name);
        const wk = sortedWordsKey(name);
        for (const [k, v] of advisorRows.entries()) {
          if ((pk && v.pks.has(pk)) || (wk && v.wks.has(wk))) return k;
        }
        return pk || wk || name;
      };
      aggRows.forEach((r) => {
        const pk = personKey(r.ejecutivo);
        const wk = sortedWordsKey(r.ejecutivo);
        if (!pk) return;
        const k = findAdvisorKey(r.ejecutivo);
        const existing = advisorRows.get(k);
        const col = getPlacementVal(r);
        if (existing) {
          existing.col += col;
          existing.pks.add(pk);
          if (wk) existing.wks.add(wk);
        } else {
          advisorRows.set(k, {
            label: r.ejecutivo,
            col,
            meta: 0,
            pks: new Set([pk]),
            wks: new Set(wk ? [wk] : []),
          });
        }
      });
      relevantMetas.forEach((m) => {
        const pk = personKey(m.asesor);
        const wk = sortedWordsKey(m.asesor);
        if (!pk) return;
        const k = findAdvisorKey(m.asesor);
        const existing = advisorRows.get(k);
        const mVal = getMetaVal(m);
        if (existing) {
          existing.meta += mVal;
          existing.pks.add(pk);
          if (wk) existing.wks.add(wk);
        } else {
          advisorRows.set(k, {
            label: m.asesor,
            col: 0,
            meta: mVal,
            pks: new Set([pk]),
            wks: new Set(wk ? [wk] : []),
          });
        }
      });
      metaBreakdownBars = Array.from(advisorRows.values())
        .map((d) => ({
          label: d.label,
          values: [
            { name: 'Colocado $', value: d.col, color: '#2563EB' },
            { name: 'Meta $', value: d.meta, color: '#16A34A' },
          ],
          sortScore: Math.max(d.col, d.meta),
        }))
        .sort((a, b) => b.sortScore - a.sortScore)
        .map(({ label, values }) => ({ label, values }));
    } else if (
      targetAgencia ||
      resolvedStaff?.mode === 'gerente' ||
      resolvedStaff?.mode === 'coordinador' ||
      role === 'gerente' ||
      role === 'coordinador'
    ) {
      metaBreakdownTitle = targetAgencia
        ? `Comparativo por Sucursal — ${filters.agencia} (Colocado vs Meta)`
        : 'Comparativo por Sucursal (Colocado vs Meta)';
      const sucMetaMap = new Map<string, { label: string; col: number; meta: number }>();
      aggRows.forEach((r) => {
        const rawAg = r.agencia || 'SIN AGENCIA';
        const key = normText(rawAg) || 'SIN AGENCIA';
        const cur = sucMetaMap.get(key) || { label: rawAg, col: 0, meta: 0 };
        cur.col += getPlacementVal(r);
        sucMetaMap.set(key, cur);
      });
      relevantMetas.forEach((m) => {
        const terr = getMetaTerr(m);
        const rawAg = terr.agencia || 'SIN AGENCIA';
        const key = normText(rawAg) || 'SIN AGENCIA';
        const cur = sucMetaMap.get(key) || { label: rawAg, col: 0, meta: 0 };
        cur.meta += getMetaVal(m);
        sucMetaMap.set(key, cur);
      });
      metaBreakdownBars = Array.from(sucMetaMap.values())
        .filter((d) => d.col > 0 || d.meta > 0)
        .map((d) => ({
          label: d.label,
          values: [
            { name: 'Colocado $', value: d.col, color: '#2563EB' },
            { name: 'Meta $', value: d.meta, color: '#16A34A' },
          ],
          sortScore: Math.max(d.col, d.meta),
        }))
        .sort((a, b) => b.sortScore - a.sortScore)
        .map(({ label, values }) => ({ label, values }));
    } else {
      metaBreakdownTitle = targetRegion
        ? `Comparativo por Región — ${regionDisplayName(targetRegion)} (Colocado vs Meta)`
        : 'Comparativo por Región (Colocado vs Meta)';
      const regionMetaMap = new Map<string, { label: string; col: number; meta: number }>();
      aggRows.forEach((r) => {
        const disp = regionDisplayName(r.region || 'SIN REGIÓN');
        const key = dailyRegionScopeKey(disp) || normText(disp) || 'SIN REGION';
        const cur = regionMetaMap.get(key) || { label: disp, col: 0, meta: 0 };
        cur.col += getPlacementVal(r);
        regionMetaMap.set(key, cur);
      });
      relevantMetas.forEach((m) => {
        const terr = getMetaTerr(m);
        const disp = regionDisplayName(terr.region || 'SIN REGIÓN');
        const key = dailyRegionScopeKey(disp) || normText(disp) || 'SIN REGION';
        const cur = regionMetaMap.get(key) || { label: disp, col: 0, meta: 0 };
        cur.meta += getMetaVal(m);
        regionMetaMap.set(key, cur);
      });
      metaBreakdownBars = Array.from(regionMetaMap.values())
        .filter((d) => d.col > 0 || d.meta > 0)
        .map((d) => ({
          label: d.label,
          values: [
            { name: 'Colocado $', value: d.col, color: '#2563EB' },
            { name: 'Meta $', value: d.meta, color: '#16A34A' },
          ],
          sortScore: Math.max(d.col, d.meta),
        }))
        .sort((a, b) => b.sortScore - a.sortScore)
        .map(({ label, values }) => ({ label, values }));
    }

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
      metaBreakdownTitle,
      metaBreakdownBars,
      activeMonthLabel,
      metaVsRealItems,
      totalMetaMensual,
      totalRealPlacement,
      pctCumplimiento,
      brechaMeta,
      hasRawMetas: rawMetas.length > 0,
    };
  }, [
    cortes,
    scopedRows,
    scopedDirRows,
    scopes,
    hierarchyFilteredAllCortes,
    aggRows,
    rosterAggRows,
    metas,
    filters.selectedCortes,
    filters.ejecutivo,
    filters.region,
    filters.agencia,
    resolvedStaff,
    role,
    userNombre,
  ]);

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
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-900">
                      Meta Mensual de Colocación Alcanzada
                    </h4>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                      {filters.ejecutivo
                        ? `Ejecutivo: ${filters.ejecutivo} · ${chartsData.activeMonthLabel}`
                        : filters.agencia !== 'ALL'
                        ? `Sucursal: ${filters.agencia} · ${chartsData.activeMonthLabel}`
                        : filters.region !== 'ALL'
                        ? `Región: ${regionDisplayName(filters.region)} · ${chartsData.activeMonthLabel}`
                        : `Total Mensual (${chartsData.activeMonthLabel})`}
                    </span>
                  </div>
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
                  Total Colocado vs Suma Meta Mensual (Cols H + I)
                </p>
                <HorizontalBarChart items={chartsData.metaVsRealItems} />
                {!chartsData.hasRawMetas && chartsData.totalMetaMensual === 0 && (
                  <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    La hoja Metas aún no está en caché del servidor. Inicia sesión una vez como Administrador Google para sincronizarla.
                  </p>
                )}
              </div>

              {/* Breakdown by Region / Sucursal / Asesor */}
              {chartsData.metaBreakdownBars.length > 0 ? (
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    {chartsData.metaBreakdownTitle}
                  </p>
                  <GroupedBarChart
                    items={chartsData.metaBreakdownBars}
                    valueFormat="money"
                  />
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

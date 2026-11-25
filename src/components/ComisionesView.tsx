import React, { useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Building2,
  Download,
  FileSpreadsheet,
  FileText,
  MapPinned,
  Shield,
  Users,
  Wallet,
} from 'lucide-react';
import {
  BanknotesBundleIcon,
  BonusTrophyIcon,
  CashCollectionIcon,
  DeductionsReceiptIcon,
  NormalityShieldIcon,
  PaycheckWalletIcon,
} from './KpiIcons';
import type {
  ComisionEjecutivoRow,
  CorteRow,
  DirectorioRow,
  FilterState,
  Role,
  ScopeEntry,
} from '../types/mcm';
import {
  aggregateComisionesByEjecutivo,
  aggregateDirectorioRows,
  colocacionBaseRow,
  colocacionNuevoRow,
  comisionBaseRow,
  comisionCobranzaTotalRow,
  comisionMayorSourceRow,
  comisionPagarRow,
  fmtMoney,
  fmtMoneyCompact,
  fmtNum,
  fmtPct,
  incentivoColocacionPagarRow,
  modeloNuevoAplicableRow,
  num,
  personKey,
  regionDisplayName,
  regionMatchesFilter,
  resolveStaffSearchScope,
  ROLE_LABELS,
  rowMatchesStaffScope,
  shortPeriodo,
  tipoEsquemaRow,
  totalDescuentosRow,
  weightedNormalidad,
} from '../utils/mcmData';
import {
  exportComisionesCSV,
  exportComisionesExcel,
  exportComisionesPDF,
  exportDirectorioCSV,
  exportDirectorioExcel,
  exportDirectorioPDF,
} from '../utils/exports';
import {
  GroupedBarChart,
  HorizontalBarChart,
  MultiSegmentDonutChart,
  TrendLineChart,
} from './Charts';

interface ComisionesViewProps {
  cortes: CorteRow[];
  scopedEjRows: ComisionEjecutivoRow[];
  scopedDirRows: DirectorioRow[];
  scopes?: {
    coordinador: ScopeEntry[];
    gerente: ScopeEntry[];
    regional: ScopeEntry[];
  };
  filters: FilterState;
  role: Role;
  userNombre: string;
  onSelectStaff?: (name: string) => void;
}

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

export const ComisionesView: React.FC<ComisionesViewProps> = ({
  cortes,
  scopedEjRows,
  scopedDirRows,
  scopes,
  filters,
  role,
  userNombre,
  onSelectStaff,
}) => {
  const [tableMode, setTableMode] = useState<'ejecutivo' | 'directorio'>('ejecutivo');
  const [dirRoleFilter, setDirRoleFilter] = useState<
    'ALL' | 'regional' | 'gerente' | 'coordinador'
  >('ALL');
  const [showCharts, setShowCharts] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<'nombre' | 'normalidad' | 'comision' | 'total'>(
    'total'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 40;

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

  const hierarchyFilteredAll = useMemo(() => {
    return scopedEjRows.filter((r) => {
      if (!regionMatchesFilter(r.region, filters.region)) return false;
      if (filters.agencia !== 'ALL' && r.agencia !== filters.agencia) return false;
      if (filters.estatus !== 'ALL' && r.estatus !== filters.estatus) return false;
      if (!rowMatchesStaffScope(r, filters.ejecutivo, resolvedStaff)) return false;
      return true;
    });
  }, [
    scopedEjRows,
    filters.region,
    filters.agencia,
    filters.estatus,
    filters.ejecutivo,
    resolvedStaff,
  ]);

  const activeEjRaw = useMemo(
    () =>
      hierarchyFilteredAll.filter(
        (r) => corteSet.size === 0 || corteSet.has(r.corte)
      ),
    [hierarchyFilteredAll, corteSet]
  );

  const aggEjRows = useMemo(
    () => aggregateComisionesByEjecutivo(activeEjRaw),
    [activeEjRaw]
  );

  // Directorio card: either Admin/Directivo searching a Regional/Gerente/Coordinador,
  // OR logged in as Coordinador/Gerente/Regional without a separate staff search
  const nivelDetalle = useMemo(() => {
    let targetRole: 'coordinador' | 'gerente' | 'regional' | null = null;
    let targetPk = '';

    if (resolvedStaff) {
      targetRole = resolvedStaff.mode;
      targetPk = resolvedStaff.pk;
    } else if (role === 'coordinador' || role === 'gerente' || role === 'regional') {
      targetRole = role;
      targetPk = personKey(userNombre);
    }

    if (!targetRole || !targetPk) return null;

    const allPersonHistory = scopedDirRows
      .filter(
        (r) =>
          r.rol_persona === targetRole &&
          personKey(r.empleado) === targetPk &&
          regionMatchesFilter(r.region, filters.region) &&
          (filters.agencia === 'ALL' || !r.agencia || r.agencia === filters.agencia)
      )
      .sort((a, b) => a.corte - b.corte);

    if (!allPersonHistory.length) return null;

    const activeCutRows = allPersonHistory.filter(
      (r) => corteSet.size === 0 || corteSet.has(r.corte)
    );
    const activeRows = activeCutRows.length ? activeCutRows : allPersonHistory;

    const sum = (f: keyof DirectorioRow) =>
      activeRows.reduce((a, r) => a + num(r[f]), 0);
    const latest = activeRows[activeRows.length - 1];

    const recentHistory = allPersonHistory.slice(-8);
    const historyLabels = recentHistory.map((r) => {
      const c = cortes.find((x) => x.CORTE === r.corte);
      return c ? `S${c.SEMANA}` : `S${r.semana || r.corte}`;
    });
    const historyValues = recentHistory.map((r) => r.total_a_cobrar);

    return {
      rolPersona: targetRole,
      empleado: latest.empleado,
      region: latest.region,
      agencia: latest.agencia,
      estatus: latest.estatus,
      comisionCobranza: sum('comision_cobranza'),
      comisionProd: sum('comision_productividad'),
      apoyoFamiliar: sum('apoyo_familiar'),
      modeloTradicional: sum('comision_modelo_tradicional'),
      apoyoEconomico: sum('apoyo_economico'),
      bonoMensual: sum('bono_mensual'),
      comisionMayor: sum('comision_mayor'),
      multas: sum('multas'),
      prestamoCH: sum('prestamo_capital_humano'),
      prestamoCA: sum('prestamo_caja_ahorro'),
      descPrestamos: sum('descuentos_prestamos'),
      incentivoFinal: sum('incentivo_final'),
      retencionCaja: sum('retencion_caja_ahorro'),
      retroactivos: sum('retroactivos_otros_apoyos'),
      totalCobrar: sum('total_a_cobrar'),
      ejecutivos: latest.num_ejecutivos,
      productivos: latest.ejecutivos_productivos,
      pctProd: latest.pct_productividad_equipo,
      norm: weightedNormalidad(activeRows),
      pagosEsp: sum('pagos_esperados'),
      pagosRec: sum('pagos_recibidos'),
      historyLabels,
      historyValues,
      cutRows: activeRows,
    };
  }, [
    resolvedStaff,
    role,
    userNombre,
    scopedDirRows,
    filters.region,
    filters.agencia,
    corteSet,
    cortes,
  ]);

  // Consolidated 6-stage totals across filtered executive rows
  const comp = useMemo(() => {
    const sumFn = (fn: (r: ComisionEjecutivoRow) => number) =>
      aggEjRows.reduce((a, r) => a + fn(r), 0);

    const pagosEsp = sumFn((r) => r.pagos_esperados);
    const pagosRec = sumFn((r) => r.pagos_recibidos);
    const pctNorm = pagosEsp > 0 ? pagosRec / pagosEsp : 0;

    const comCob = sumFn((r) => r.comision_cobranza);
    const bonoExc = sumFn((r) => r.bono_excelencia);
    const comAdic = sumFn((r) => r.comision_cobranza_adicional);
    const comHered = sumFn((r) => r.comision_cartera_heredada);
    const cobTotal = sumFn(comisionCobranzaTotalRow);

    const colTrad = sumFn((r) => r.comision_colocacion_total);
    const colNuevo7 = sumFn(colocacionNuevoRow);
    const colBase = sumFn(colocacionBaseRow);
    const apoyoFam = sumFn((r) => r.comision_apoyo_familiar);
    const colPagar = sumFn(incentivoColocacionPagarRow);

    const apoyoEcon = sumFn((r) => r.apoyo_economico);
    const bonoMens = sumFn((r) => r.bono_mensual);
    const campanas = sumFn((r) => r.campanas);
    const comMayor = sumFn(comisionMayorSourceRow);
    const convenio = sumFn((r) => r.convenio);
    const incapacidad = sumFn((r) => r.incapacidad);
    const otrosTotal =
      apoyoEcon + bonoMens + campanas + comMayor + convenio + incapacidad;

    const multas = sumFn((r) => r.multas);
    const penTrasp = sumFn((r) => r.penalizacion_traspaso);
    const penDecr = sumFn((r) => r.penalizacion_decremento);
    const prestCH = sumFn((r) => r.prestamo_capital_humano);
    const prestCA = sumFn((r) => r.prestamo_caja_ahorro);
    const descPrest = sumFn((r) => r.descuentos_prestamos);
    const descTotal = sumFn(totalDescuentosRow);

    const modTrad = sumFn((r) => r.comision_modelo_tradicional);
    const modNuevo = sumFn(modeloNuevoAplicableRow);
    const comBase = sumFn(comisionBaseRow);
    const comFinal = sumFn(comisionPagarRow);
    const retCaja = sumFn((r) => r.retencion_caja_ahorro);
    const retroactivos = sumFn((r) => r.retroactivos_otros_apoyos);
    const totalCobrar = sumFn((r) => r.total_a_cobrar);

    const nuevoCount = aggEjRows.filter(
      (r) => tipoEsquemaRow(r) === 'NUEVO'
    ).length;
    const tradCount = aggEjRows.length - nuevoCount;

    const productivosCount = aggEjRows.filter((r) =>
      r.productivo !== undefined ? r.productivo === 1 : r.total_colocado > 0
    ).length;

    return {
      pagosEsp,
      pagosRec,
      pctNorm,
      comCob,
      bonoExc,
      comAdic,
      comHered,
      cobTotal,
      colTrad,
      colNuevo7,
      colBase,
      apoyoFam,
      colPagar,
      apoyoEcon,
      bonoMens,
      campanas,
      comMayor,
      convenio,
      incapacidad,
      otrosTotal,
      multas,
      penTrasp,
      penDecr,
      prestCH,
      prestCA,
      descPrest,
      descTotal,
      modTrad,
      modNuevo,
      comBase,
      comFinal,
      retCaja,
      retroactivos,
      totalCobrar,
      nuevoCount,
      tradCount,
      productivosCount,
      noProductivosCount: Math.max(0, aggEjRows.length - productivosCount),
      montoNuevos: sumFn((r) => r.monto_nuevos),
      montoRenov: sumFn((r) => r.monto_renovaciones),
    };
  }, [aggEjRows]);

  // All Comisiones Charts (matching original HTML charts)
  const chartsData = useMemo(() => {
    const recent = [...cortes].sort((a, b) => a.CORTE - b.CORTE).slice(-8);
    const labels = recent.map((c) => `S${c.SEMANA}`);
    const payVals = recent.map((c) => {
      const rows = hierarchyFilteredAll.filter((r) => r.corte === c.CORTE);
      return rows.length
        ? rows.reduce((s, r) => s + r.total_a_cobrar, 0)
        : null;
    });
    const comFinalVals = recent.map((c) => {
      const rows = hierarchyFilteredAll.filter((r) => r.corte === c.CORTE);
      return rows.length
        ? rows.reduce((s, r) => s + comisionPagarRow(r), 0)
        : null;
    });
    const normVals = recent.map((c) => {
      const rows = hierarchyFilteredAll.filter((r) => r.corte === c.CORTE);
      return rows.length ? weightedNormalidad(rows) : null;
    });

    // Composición de comisión por concepto (últimos 6 cortes)
    const last6 = recent.slice(-6);
    const compBars = last6.map((c) => {
      const rows = hierarchyFilteredAll.filter((r) => r.corte === c.CORTE);
      return {
        label: `Sem ${c.SEMANA}`,
        values: [
          {
            name: 'Cobranza',
            value: rows.reduce((s, r) => s + comisionCobranzaTotalRow(r), 0),
            color: '#10B981',
          },
          {
            name: 'Colocación',
            value: rows.reduce((s, r) => s + incentivoColocacionPagarRow(r), 0),
            color: '#2563EB',
          },
          {
            name: 'Apoyo Familiar',
            value: rows.reduce((s, r) => s + r.comision_apoyo_familiar, 0),
            color: '#F59E0B',
          },
          {
            name: 'Bonos / Camp.',
            value: rows.reduce(
              (s, r) => s + r.bono_mensual + r.campanas + r.bono_excelencia,
              0
            ),
            color: '#8B5CF6',
          },
        ],
      };
    });

    // Comisión Final por Región (Donut) & Promedio por Ejecutivo por Región
    const regStats = new Map<string, { total: number; count: number }>();
    aggEjRows.forEach((r) => {
      const k = regionDisplayName(r.region || 'SIN REGIÓN');
      const cur = regStats.get(k) || { total: 0, count: 0 };
      cur.total += comisionPagarRow(r);
      cur.count += 1;
      regStats.set(k, cur);
    });

    const regionDonut = Array.from(regStats.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([label, d], idx) => ({
        label,
        value: Math.max(0, d.total),
        color: PALETTE[idx % PALETTE.length],
      }));

    const regionPromedioBars = Array.from(regStats.entries())
      .map(([label, d]) => ({
        label,
        sublabel: `${d.count} ej.`,
        value: d.count > 0 ? d.total / d.count : 0,
        color: '#2563EB',
        displayValue: fmtMoneyCompact(d.count > 0 ? d.total / d.count : 0),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Top 10 Sucursales por Comisión Final
    const sucMap = new Map<string, { region: string; total: number }>();
    aggEjRows.forEach((r) => {
      const k = r.agencia || 'SIN AGENCIA';
      const cur = sucMap.get(k) || {
        region: regionDisplayName(r.region || ''),
        total: 0,
      };
      cur.total += comisionPagarRow(r);
      sucMap.set(k, cur);
    });
    const topSucursales = Array.from(sucMap.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([label, d]) => ({
        label,
        sublabel: d.region,
        value: d.total,
        color: '#10B981',
        displayValue: fmtMoneyCompact(d.total),
      }));

    // Top 10 Ejecutivos por Comisión Final
    const topEjecutivos = [...aggEjRows]
      .sort((a, b) => comisionPagarRow(b) - comisionPagarRow(a))
      .slice(0, 10)
      .map((r) => ({
        label: r.ejecutivo,
        sublabel: r.agencia,
        value: comisionPagarRow(r),
        color: '#2563EB',
        displayValue: fmtMoneyCompact(comisionPagarRow(r)),
      }));

    // Productividad del equipo (Donut)
    const productivityDonut = [
      { label: 'Productivos', value: comp.productivosCount, color: '#10B981' },
      { label: 'No productivos', value: comp.noProductivosCount, color: '#CBD5E1' },
    ];

    return {
      labels,
      payVals,
      comFinalVals,
      normVals,
      compBars,
      regionDonut,
      regionPromedioBars,
      topSucursales,
      topEjecutivos,
      productivityDonut,
    };
  }, [cortes, hierarchyFilteredAll, aggEjRows, comp.productivosCount, comp.noProductivosCount]);

  // Directorio aggregated rows (all roles matching region/corte/estatus)
  const dirRowsAgg = useMemo(() => {
    const q = filters.ejecutivo.trim().toLowerCase();
    const filtered = scopedDirRows.filter((r) => {
      if (corteSet.size > 0 && r.corte > 0 && !corteSet.has(r.corte)) return false;
      if (!regionMatchesFilter(r.region, filters.region)) return false;
      if (
        filters.agencia !== 'ALL' &&
        r.rol_persona !== 'regional' &&
        r.agencia !== filters.agencia
      ) {
        return false;
      }
      if (filters.estatus !== 'ALL' && r.estatus && r.estatus !== filters.estatus) {
        return false;
      }
      if (q) {
        if (resolvedStaff) {
          const isTarget = personKey(r.empleado) === resolvedStaff.pk;
          if (
            !isTarget &&
            !r.empleado.toLowerCase().includes(q) &&
            !rowMatchesStaffScope(
              { region: r.region, agencia: r.agencia, ejecutivo: r.empleado },
              filters.ejecutivo,
              resolvedStaff
            )
          ) {
            return false;
          }
        } else if (
          !r.empleado.toLowerCase().includes(q) &&
          !r.region.toLowerCase().includes(q) &&
          !r.agencia.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
    return aggregateDirectorioRows(filtered).sort((a, b) => {
      const order = { regional: 0, gerente: 1, coordinador: 2 };
      return (
        order[a.rol_persona] - order[b.rol_persona] ||
        b.total_a_cobrar - a.total_a_cobrar
      );
    });
  }, [scopedDirRows, corteSet, filters, resolvedStaff]);

  const filteredDirRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dirRowsAgg.filter((r) => {
      if (dirRoleFilter !== 'ALL' && r.rol_persona !== dirRoleFilter) return false;
      if (!q) return true;
      return (
        r.empleado.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.agencia.toLowerCase().includes(q)
      );
    });
  }, [dirRowsAgg, dirRoleFilter, search]);

  const dirCounts = useMemo(() => {
    const reg = dirRowsAgg.filter((r) => r.rol_persona === 'regional');
    const ger = dirRowsAgg.filter((r) => r.rol_persona === 'gerente');
    const coo = dirRowsAgg.filter((r) => r.rol_persona === 'coordinador');
    const sumTotal = (arr: DirectorioRow[]) =>
      arr.reduce((s, r) => s + r.total_a_cobrar, 0);
    return {
      regional: { count: reg.length, total: sumTotal(reg) },
      gerente: { count: ger.length, total: sumTotal(ger) },
      coordinador: { count: coo.length, total: sumTotal(coo) },
    };
  }, [dirRowsAgg]);

  const sortedEjTable = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = aggEjRows.filter((r) => {
      if (!q) return true;
      return (
        r.ejecutivo.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.agencia.toLowerCase().includes(q)
      );
    });
    return filtered.sort((a, b) => {
      let av: string | number = a.total_a_cobrar;
      let bv: string | number = b.total_a_cobrar;
      if (sortCol === 'nombre') {
        av = a.ejecutivo;
        bv = b.ejecutivo;
      } else if (sortCol === 'normalidad') {
        av = a.pct_normalidad ?? -1;
        bv = b.pct_normalidad ?? -1;
      } else if (sortCol === 'comision') {
        av = comisionPagarRow(a);
        bv = comisionPagarRow(b);
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc'
          ? av.localeCompare(bv, 'es')
          : bv.localeCompare(av, 'es');
      }
      return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
  }, [aggEjRows, search, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedEjTable.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedEj = sortedEjTable.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const periodSubtitle = useMemo(() => {
    const sel = cortes.filter((c) => filters.selectedCortes.includes(c.CORTE));
    if (!sel.length) return 'Todos los cortes';
    if (sel.length === 1)
      return `Semana ${sel[0].SEMANA} (${shortPeriodo(sel[0].PERIODO)})`;
    return `${sel.length} semanas seleccionadas`;
  }, [cortes, filters.selectedCortes]);

  const StatRow: React.FC<{
    label: string;
    value: number;
    highlight?: boolean;
  }> = ({ label, value, highlight }) => (
    <div className="flex items-center justify-between py-1.5 text-xs border-b border-slate-100 last:border-0">
      <span
        className={highlight ? 'font-semibold text-slate-900' : 'text-slate-600'}
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${
          highlight ? 'font-bold text-slate-900' : 'font-medium text-slate-800'
        }`}
      >
        {fmtMoneyCompact(value)}
      </span>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Hierarchy Staff Scope Banner when Admin/Directivo filters by Regional/Gerente/Coordinador */}
      {resolvedStaff && (
        <div className="bg-blue-50/80 border border-blue-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 text-xs text-blue-900">
            <Shield className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>Comisiones filtradas por {ROLE_LABELS[resolvedStaff.mode]}:</strong>{' '}
              {resolvedStaff.matchedName}
              {resolvedStaff.regions.size > 0 && (
                <span className="text-blue-700 ml-1.5">
                  ({Array.from(resolvedStaff.regions).join(', ')})
                </span>
              )}
            </span>
          </div>
          <span className="text-xs font-semibold text-blue-800 tabular-nums">
            {fmtNum(aggEjRows.length)} ejecutivos bajo alcance
          </span>
        </div>
      )}

      {/* Own / Selected Directorio Earnings Card (Regional / Gerente / Coordinador) */}
      {nivelDetalle && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-900 text-white p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Comisión Individual · {ROLE_LABELS[nivelDetalle.rolPersona]}
                </span>
              </div>
              <h2 className="text-lg font-bold mt-1">{nivelDetalle.empleado}</h2>
              <p className="text-xs text-slate-300 mt-0.5">
                {regionDisplayName(nivelDetalle.region)}
                {nivelDetalle.agencia ? ` · ${nivelDetalle.agencia}` : ''} · Normalidad:{' '}
                {fmtPct(nivelDetalle.norm)} · Productividad equipo:{' '}
                {fmtNum(nivelDetalle.productivos)} / {fmtNum(nivelDetalle.ejecutivos)} (
                {(nivelDetalle.pctProd * 100).toFixed(0)}%)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-6 tabular-nums">
              <div>
                <p className="text-[11px] text-slate-400">Incentivo Final</p>
                <p className="text-lg font-semibold">
                  {fmtMoney(nivelDetalle.incentivoFinal)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Total a Cobrar</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {fmtMoney(nivelDetalle.totalCobrar)}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 border-b border-slate-200 bg-slate-50/40">
            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Cobranza y Productividad
              </p>
              <StatRow label="Comisión Cobranza" value={nivelDetalle.comisionCobranza} />
              <StatRow
                label="Comisión +/- Productividad"
                value={nivelDetalle.comisionProd}
              />
              <StatRow label="Apoyo Familiar" value={nivelDetalle.apoyoFamiliar} />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Modelo y Bonos
              </p>
              <StatRow
                label="Modelo Tradicional"
                value={nivelDetalle.modeloTradicional}
              />
              <StatRow label="Apoyo Económico" value={nivelDetalle.apoyoEconomico} />
              <StatRow label="Bono Mensual" value={nivelDetalle.bonoMensual} />
              <StatRow label="Comisión Mayor" value={nivelDetalle.comisionMayor} />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Descuentos y Cierre
              </p>
              <StatRow label="Multas" value={nivelDetalle.multas} />
              <StatRow
                label="Préstamos (CH + CA + Desc.)"
                value={
                  nivelDetalle.prestamoCH +
                  nivelDetalle.prestamoCA +
                  nivelDetalle.descPrestamos
                }
              />
              <StatRow
                label="Retención Caja / Retroactivos"
                value={nivelDetalle.retroactivos - nivelDetalle.retencionCaja}
              />
              <StatRow label="Total a Cobrar" value={nivelDetalle.totalCobrar} highlight />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Evolución Total a Cobrar ($)
              </p>
              <TrendLineChart
                labels={nivelDetalle.historyLabels}
                series={[
                  {
                    name: 'Total a Cobrar',
                    color: '#10B981',
                    values: nivelDetalle.historyValues,
                  },
                ]}
                valueFormat="money"
                height={150}
              />
            </div>
          </div>
        </div>
      )}

      {/* Directorio Summary Strip for Admin / Directivo / Regional / Gerente */}
      {role !== 'ejecutivo' && dirRowsAgg.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => {
              setTableMode('directorio');
              setDirRoleFilter('regional');
            }}
            className="text-left bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <MapPinned className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700 truncate">
                  Gerentes Regionales
                </span>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 tabular-nums shrink-0">
                {dirCounts.regional.count}
              </span>
            </div>
            <p className="text-xl font-bold text-slate-900 mt-2 tabular-nums">
              {fmtMoney(dirCounts.regional.total)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Clic para ver detalle de regionales en Directorio
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setTableMode('directorio');
              setDirRoleFilter('gerente');
            }}
            className="text-left bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-slate-700" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 truncate">
                  Gerentes de Agencia
                </span>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 tabular-nums shrink-0">
                {dirCounts.gerente.count}
              </span>
            </div>
            <p className="text-xl font-bold text-slate-900 mt-2 tabular-nums">
              {fmtMoney(dirCounts.gerente.total)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Clic para ver detalle de gerentes en Directorio
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setTableMode('directorio');
              setDirRoleFilter('coordinador');
            }}
            className="text-left bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-emerald-600" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 truncate">
                  Coordinadores
                </span>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 tabular-nums shrink-0">
                {dirCounts.coordinador.count}
              </span>
            </div>
            <p className="text-xl font-bold text-slate-900 mt-2 tabular-nums">
              {fmtMoney(dirCounts.coordinador.total)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Clic para ver detalle de coordinadores en Directorio
            </p>
          </button>
        </div>
      )}

      {/* Hero Summary Card (Team / Ejecutivos) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Resumen de Comisiones ({fmtNum(aggEjRows.length)} ejecutivos)
            </span>
          </div>
          <p className="text-xs text-slate-500">{periodSubtitle}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {comp.nuevoCount > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded">
                Esquema NUEVO: {comp.nuevoCount}
              </span>
            )}
            {comp.tradCount > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 rounded">
                Esquema TRADICIONAL: {comp.tradCount}
              </span>
            )}
            <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
              Productivos: {comp.productivosCount} / {aggEjRows.length}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 tabular-nums">
          <div>
            <p className="text-xs text-slate-500">Comisión Base</p>
            <p className="text-lg font-bold text-slate-900">
              {fmtMoney(comp.comBase)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Comisión Final</p>
            <p className="text-lg font-bold text-slate-900">
              {fmtMoney(comp.comFinal)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <PaycheckWalletIcon className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total a Cobrar</p>
              <p className="text-2xl font-bold text-emerald-700">
                {fmtMoney(comp.totalCobrar)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 6-Stage Composition Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <NormalityShieldIcon className="w-6 h-6 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">
                1. Pagos y Normalidad
              </span>
            </div>
            <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
              {fmtPct(comp.pctNorm)}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full rounded-full ${
                comp.pctNorm >= 0.95
                  ? 'bg-emerald-600'
                  : comp.pctNorm >= 0.9
                  ? 'bg-amber-500'
                  : 'bg-red-600'
              }`}
              style={{ width: `${Math.min(100, comp.pctNorm * 100)}%` }}
            />
          </div>
          <div className="space-y-1 text-xs text-slate-600 tabular-nums">
            <div className="flex justify-between">
              <span>Pagos recibidos</span>
              <span className="font-semibold text-slate-900">
                {fmtNum(comp.pagosRec)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Pagos esperados</span>
              <span className="font-semibold text-slate-900">
                {fmtNum(comp.pagosEsp)}
              </span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-100">
              <span>Colocación Nuevos / Renov</span>
              <span className="font-medium text-slate-700">
                {fmtMoneyCompact(comp.montoNuevos)} /{' '}
                {fmtMoneyCompact(comp.montoRenov)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CashCollectionIcon className="w-6 h-6 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">
                2. Incentivo Cobranza
              </span>
            </div>
            <span className="text-sm font-bold text-blue-700 tabular-nums shrink-0">
              {fmtMoneyCompact(comp.cobTotal)}
            </span>
          </div>
          <StatRow label="Comisión cobranza" value={comp.comCob} />
          <StatRow label="Bono excelencia" value={comp.bonoExc} />
          <StatRow label="Cobranza adicional" value={comp.comAdic} />
          <StatRow label="Cartera heredada" value={comp.comHered} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <BanknotesBundleIcon className="w-6 h-6 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">
                3. Incentivo Colocación
              </span>
            </div>
            <span className="text-sm font-bold text-blue-700 tabular-nums shrink-0">
              {fmtMoneyCompact(comp.colPagar)}
            </span>
          </div>
          <StatRow label="Colocación tradicional" value={comp.colTrad} />
          <StatRow label="Esquema Nuevo (7% nuevos)" value={comp.colNuevo7} />
          <StatRow label="Colocación base aplicada" value={comp.colBase} highlight />
          <StatRow label="Comisión apoyo familiar" value={comp.apoyoFam} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <BonusTrophyIcon className="w-6 h-6 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">
                4. Otros Incentivos
              </span>
            </div>
            <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
              {fmtMoneyCompact(comp.otrosTotal)}
            </span>
          </div>
          <StatRow label="Apoyo económico" value={comp.apoyoEcon} />
          <StatRow label="Bono mensual" value={comp.bonoMens} />
          <StatRow label="Campañas" value={comp.campanas} />
          <StatRow label="Comisión mayor / Crecimiento" value={comp.comMayor} />
          <StatRow
            label="Convenio / Incapacidad"
            value={comp.convenio + comp.incapacidad}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <DeductionsReceiptIcon className="w-6 h-6 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">
                5. Descuentos y Préstamos
              </span>
            </div>
            <span className="text-sm font-bold text-red-600 tabular-nums shrink-0">
              -{fmtMoneyCompact(comp.descTotal)}
            </span>
          </div>
          <StatRow label="Multas" value={comp.multas} />
          <StatRow label="Penalización traspaso" value={comp.penTrasp} />
          <StatRow label="Penalización decremento" value={comp.penDecr} />
          <StatRow label="Préstamo Capital Humano" value={comp.prestCH} />
          <StatRow label="Préstamo Caja de Ahorro" value={comp.prestCA} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <PaycheckWalletIcon className="w-6 h-6 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">
                6. Cierre y Total a Cobrar
              </span>
            </div>
            <span className="text-sm font-bold text-emerald-700 tabular-nums shrink-0">
              {fmtMoneyCompact(comp.totalCobrar)}
            </span>
          </div>
          <StatRow label="Modelo tradicional" value={comp.modTrad} />
          <StatRow label="Modelo Nuevo (aplicable)" value={comp.modNuevo} />
          <StatRow
            label="Comisión final (Base - Desc.)"
            value={comp.comFinal}
            highlight
          />
          <StatRow label="Retención Caja de Ahorro" value={comp.retCaja} />
          <StatRow label="Retroactivos / Otros apoyos" value={comp.retroactivos} />
        </div>
      </div>

      {/* All Comisiones Charts (matching original HTML charts) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Análisis Gráfico de Comisiones ({periodSubtitle})
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
            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Comisión Final y Total a Cobrar por Corte ($)
              </h4>
              <TrendLineChart
                labels={chartsData.labels}
                series={[
                  {
                    name: 'Total a Cobrar',
                    color: '#10B981',
                    values: chartsData.payVals,
                  },
                  {
                    name: 'Comisión Final',
                    color: '#2563EB',
                    values: chartsData.comFinalVals,
                    dashed: true,
                  },
                ]}
                valueFormat="money"
              />
            </div>

            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Tendencia de Normalidad (Comisiones)
              </h4>
              <TrendLineChart
                labels={chartsData.labels}
                series={[
                  {
                    name: '% Normalidad',
                    color: '#2563EB',
                    values: chartsData.normVals,
                  },
                ]}
                valueFormat="pct"
                referenceLine={{
                  value: 0.95,
                  label: 'Meta 95%',
                  color: '#16A34A',
                }}
              />
            </div>

            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Composición de Comisión por Concepto (Últimas semanas)
              </h4>
              <GroupedBarChart items={chartsData.compBars} valueFormat="money" />
            </div>

            {role !== 'ejecutivo' && (
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Productividad del Equipo (Productivos vs No Productivos)
                </h4>
                <MultiSegmentDonutChart
                  segments={chartsData.productivityDonut}
                  valueFormat="num"
                  centerLabel="Ejecutivos"
                />
              </div>
            )}

            {role !== 'ejecutivo' && (
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Comisión Final por Región
                </h4>
                <MultiSegmentDonutChart
                  segments={chartsData.regionDonut}
                  valueFormat="money"
                  centerLabel="Com. Final"
                />
              </div>
            )}

            {role !== 'ejecutivo' && (
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Comisión Final Promedio por Ejecutivo, por Región
                </h4>
                <HorizontalBarChart items={chartsData.regionPromedioBars} />
              </div>
            )}

            {role !== 'ejecutivo' && (
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Top 10 Sucursales por Comisión Final
                </h4>
                <HorizontalBarChart items={chartsData.topSucursales} />
              </div>
            )}

            <div className="border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">
                Top 10 Ejecutivos por Comisión Final
              </h4>
              <HorizontalBarChart items={chartsData.topEjecutivos} />
            </div>
          </div>
        )}
      </div>

      {/* Table Switcher (Ejecutivos / Directorio) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTableMode('ejecutivo');
                setPage(1);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ${
                tableMode === 'ejecutivo'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Ejecutivos ({aggEjRows.length})
            </button>
            {role !== 'ejecutivo' && (
              <button
                type="button"
                onClick={() => setTableMode('directorio')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ${
                  tableMode === 'directorio'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Directorio ({dirRowsAgg.length})
              </button>
            )}

            {tableMode === 'directorio' && role !== 'ejecutivo' && (
              <div className="flex flex-wrap items-center gap-1 pl-2 border-l border-slate-200">
                {(
                  [
                    { id: 'ALL', label: 'Todos', show: true },
                    {
                      id: 'regional',
                      label: `Regionales (${dirCounts.regional.count})`,
                      show:
                        role === 'admin' ||
                        role === 'directivo' ||
                        role === 'direccion' ||
                        role === 'regional',
                    },
                    {
                      id: 'gerente',
                      label: `Gerentes (${dirCounts.gerente.count})`,
                      show: role !== 'coordinador',
                    },
                    {
                      id: 'coordinador',
                      label: `Coordinadores (${dirCounts.coordinador.count})`,
                      show: true,
                    },
                  ] as const
                )
                  .filter((item) => item.show)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDirRoleFilter(item.id)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                        dirRoleFilter === item.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={
                tableMode === 'directorio'
                  ? 'Buscar colaborador o región...'
                  : 'Buscar ejecutivo o agencia...'
              }
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              type="button"
              onClick={() =>
                tableMode === 'directorio'
                  ? exportDirectorioCSV(filteredDirRows)
                  : exportComisionesCSV(sortedEjTable)
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              CSV
            </button>
            <button
              type="button"
              onClick={() =>
                tableMode === 'directorio'
                  ? exportDirectorioExcel(filteredDirRows)
                  : exportComisionesExcel(sortedEjTable)
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              Excel
            </button>
            <button
              type="button"
              onClick={() =>
                tableMode === 'directorio'
                  ? exportDirectorioPDF(filteredDirRows, periodSubtitle)
                  : exportComisionesPDF(sortedEjTable, periodSubtitle)
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <FileText className="w-3.5 h-3.5 text-red-600" />
              PDF
            </button>
          </div>
        </div>

        {tableMode === 'ejecutivo' ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th
                      onClick={() => {
                        setSortCol('nombre');
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      }}
                      className="py-2.5 px-3 cursor-pointer"
                    >
                      Ejecutivo
                    </th>
                    <th className="py-2.5 px-3">Región / Agencia</th>
                    <th className="py-2.5 px-3">Esquema</th>
                    <th
                      onClick={() => {
                        setSortCol('normalidad');
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      }}
                      className="py-2.5 px-3 text-right cursor-pointer"
                    >
                      Normalidad
                    </th>
                    <th className="py-2.5 px-3 text-right">Cobranza</th>
                    <th className="py-2.5 px-3 text-right">Colocación</th>
                    <th className="py-2.5 px-3 text-right">Descuentos</th>
                    <th
                      onClick={() => {
                        setSortCol('comision');
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      }}
                      className="py-2.5 px-3 text-right cursor-pointer"
                    >
                      Com. Final
                    </th>
                    <th
                      onClick={() => {
                        setSortCol('total');
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      }}
                      className="py-2.5 px-3 text-right cursor-pointer"
                    >
                      Total a Cobrar
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {pagedEj.map((r, i) => {
                    const esquema = tipoEsquemaRow(r);
                    return (
                      <tr key={`${r.ejecutivo}-${i}`} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {r.ejecutivo}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {regionDisplayName(r.region)} · {r.agencia}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                              esquema === 'NUEVO'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {esquema}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                          {fmtPct(r.pct_normalidad)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {fmtMoneyCompact(comisionCobranzaTotalRow(r))}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {fmtMoneyCompact(incentivoColocacionPagarRow(r))}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-red-600">
                          {fmtMoneyCompact(totalDescuentosRow(r))}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900">
                          {fmtMoneyCompact(comisionPagarRow(r))}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700">
                          {fmtMoneyCompact(r.total_a_cobrar)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg bg-white disabled:opacity-40"
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
                  className="px-3 py-1.5 border border-slate-200 rounded-lg bg-white disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-3">Colaborador</th>
                  <th className="py-2.5 px-3">Rol</th>
                  <th className="py-2.5 px-3">Región / Agencia</th>
                  <th className="py-2.5 px-3 text-right">Normalidad</th>
                  <th className="py-2.5 px-3 text-right">Productividad</th>
                  <th className="py-2.5 px-3 text-right">Com. Cobranza</th>
                  <th className="py-2.5 px-3 text-right">Incentivo Final</th>
                  <th className="py-2.5 px-3 text-right">Total a Cobrar</th>
                  {onSelectStaff && <th className="py-2.5 px-3 text-right">Detalle</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredDirRows.map((r, i) => (
                  <tr
                    key={`${r.rol_persona}-${r.empleado}-${r.region}-${i}`}
                    className="hover:bg-slate-50/80"
                  >
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      {r.empleado}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded border uppercase ${
                          r.rol_persona === 'regional'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : r.rol_persona === 'gerente'
                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {ROLE_LABELS[r.rol_persona]}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {regionDisplayName(r.region)}
                      {r.agencia ? ` · ${r.agencia}` : ''}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {fmtPct(r.pct_normalidad)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                      {fmtNum(r.ejecutivos_productivos)} / {fmtNum(r.num_ejecutivos)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                      {fmtMoneyCompact(r.comision_cobranza)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900">
                      {fmtMoneyCompact(r.incentivo_final)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700">
                      {fmtMoneyCompact(r.total_a_cobrar)}
                    </td>
                    {onSelectStaff && (
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectStaff(r.empleado)}
                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Ver detalle
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filteredDirRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={onSelectStaff ? 9 : 8}
                      className="py-10 text-center text-xs text-slate-500"
                    >
                      Sin registros en el directorio para los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

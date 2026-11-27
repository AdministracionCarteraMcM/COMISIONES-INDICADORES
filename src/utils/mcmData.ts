import * as XLSX from 'xlsx';
import type {
  BackupInfo,
  ComisionEjecutivoRow,
  CorteRow,
  DailyRow,
  DirectorioRow,
  IndicadorRow,
  NormalidadRawRow,
  Role,
  ScopeEntry,
  UserRecord,
} from '../types/mcm';

export const METAS = {
  normalidad: 0.95,
  montoPromedio: 14500,
  carteraPorEjecutivo: 725000,
  clientesPorEjecutivo: 50,
};

export const SEMAFORO = {
  verde: 0.95,
  amarillo: 0.9,
};

export const MIN_PAGOS_RANK = 5;

export const TERRITORIOS: Record<string, number> = {
  'EDO. MEXICO': 1,
  'EDO.MEXICO': 1,
  EDOMEXICO: 1,
  EDOMEX: 1,
  ESTADODEMEXICO: 1,
  'EDO. MEXICO 2': 1,
  'EDOMEXICO 2': 1,
  NEVADO: 1,
  VOLCANES: 1,
  METROPOLITANO: 1,
  PUEBLA: 2,
  TLAXCALA: 2,
  TEZIUTLAN: 2,
  ZACATLAN: 2,
  MORELOS: 2,
  TEPEACA: 2,
  JURIDICO: 3,
};

export const ROLE_LABELS: Record<Role, string> = {
  ejecutivo: 'Ejecutivo',
  coordinador: 'Coordinador',
  gerente: 'Gerente',
  regional: 'Gerente Regional',
  directivo: 'Directivo',
  direccion: 'Dirección',
  admin: 'Administrador',
};

export const REGION_DISPLAY_NAMES: Record<string, string> = {
  'EDOMEXICO': 'EDO.MEXICO',
  'EDOMEX': 'EDO.MEXICO',
  'ESTADODEMEXICO': 'EDO.MEXICO',
  'EDO. MEXICO': 'EDO.MEXICO',
  'EDO.MEXICO': 'EDO.MEXICO',
  'EDO. MEXICO 2': 'EDO.MEXICO',
  'EDOMEXICO 2': 'EDO.MEXICO',
};

export function regionDisplayName(region: string): string {
  const clean = normText(region);
  if (!clean) return region;
  if (REGION_DISPLAY_NAMES[clean]) return REGION_DISPLAY_NAMES[clean];
  if (REGION_DISPLAY_NAMES[region]) return REGION_DISPLAY_NAMES[region];
  if (dailyRegionScopeKey(region) === 'EDO.MEXICO') return 'EDO.MEXICO';
  return region;
}

export function normText(v: unknown): string {
  return String(v == null ? '' : v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function personKey(v: unknown): string {
  return String(v == null ? '' : v)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function dailyRegionScopeKey(value: unknown): string {
  const region = personKey(value);
  if (region === 'VOLCANESORIENTE') return 'VOLCANES';
  if (region === 'EDOMEXICO' || region === 'EDOMEX' || region === 'ESTADODEMEXICO' || region === 'EDOMEXICO2') return 'EDO.MEXICO';
  return region;
}

export function terrOf(regionName: string): number {
  const direct = TERRITORIOS[normText(regionName)];
  if (direct != null) return direct;
  const disp = TERRITORIOS[normText(regionDisplayName(regionName))];
  if (disp != null) return disp;
  const scope = TERRITORIOS[dailyRegionScopeKey(regionName)];
  return scope == null ? 0 : scope;
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function nullableNum(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return (
    sign +
    '$' +
    Math.round(Math.abs(v)).toLocaleString('es-MX', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) +
    ' MXN'
  );
}

export function fmtMoneyCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return sign + '$' + Math.round(Math.abs(v)).toLocaleString('es-MX');
}

export function fmtMoneyShort(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return sign + '$' + Math.round(abs / 1e3) + 'K';
  return sign + '$' + Math.round(abs).toLocaleString('es-MX');
}

export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Math.round(v).toLocaleString('es-MX');
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return (v * 100).toFixed(2) + '%';
}

export function fmtPct1(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return (v * 100).toFixed(1) + '%';
}

export type SemaforoLevel = 'ok' | 'mid' | 'bad' | 'na';

export function getSemaforoLevel(
  p: number | null | undefined,
  verde = SEMAFORO.verde,
  amarillo = SEMAFORO.amarillo
): SemaforoLevel {
  if (p === null || p === undefined || !Number.isFinite(p)) return 'na';
  if (p >= verde) return 'ok';
  if (p >= amarillo) return 'mid';
  return 'bad';
}

export function getSemaforoLabel(
  p: number | null | undefined,
  verde = SEMAFORO.verde,
  amarillo = SEMAFORO.amarillo
): string {
  const lvl = getSemaforoLevel(p, verde, amarillo);
  if (lvl === 'ok') return 'VERDE';
  if (lvl === 'mid') return 'AMARILLO';
  if (lvl === 'bad') return 'ROJO';
  return 'SIN DATOS';
}

export function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000);
}

export function dateToSerial(d: Date): number {
  return Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(1899, 11, 30)) /
      86400000
  );
}

export function lastDayOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

const MESES_LARGO = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const MESES_CORTO: Record<string, string> = {
  enero: 'ene',
  febrero: 'feb',
  marzo: 'mar',
  abril: 'abr',
  mayo: 'may',
  junio: 'jun',
  julio: 'jul',
  agosto: 'ago',
  septiembre: 'sep',
  octubre: 'oct',
  noviembre: 'nov',
  diciembre: 'dic',
};

export function formatPeriodo(friday: Date): string {
  const monday = new Date(friday.getTime() - 4 * 86400000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(monday.getUTCDate())} ${MESES_LARGO[monday.getUTCMonth()]} ${monday.getUTCFullYear()} - ${pad(
    friday.getUTCDate()
  )} ${MESES_LARGO[friday.getUTCMonth()]} ${friday.getUTCFullYear()}`;
}

export function shortPeriodo(periodo: string): string {
  if (!periodo) return '';
  const parts = periodo.split('-');
  if (parts.length < 2) return periodo;
  const parsePart = (p: string) => {
    const m = p.trim().match(/(\d+)\s+(\S+)\s+\d+/);
    if (!m) return null;
    const month = MESES_CORTO[m[2].toLowerCase()] || m[2].slice(0, 3);
    return { day: m[1], month };
  };
  const a = parsePart(parts[0]);
  const b = parsePart(parts[1]);
  if (!a || !b) return periodo;
  if (a.month === b.month) return `${a.day}-${b.day} ${a.month}`;
  return `${a.day} ${a.month} - ${b.day} ${b.month}`;
}

export function dailyDateKey(v: unknown): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return v.toISOString().slice(0, 10);
  }
  const text = String(v == null ? '' : v).trim();
  if (!text) return '';
  if (typeof v === 'number' || /^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(v);
    if (!Number.isFinite(serial) || serial < 20000 || serial >= 2958466) return '';
    const d = serialToDate(Math.floor(serial));
    return d.toISOString().slice(0, 10);
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (local) {
    return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  }
  return '';
}

export function nrmMonthKeyFromCut(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 2);
  return d.toISOString().slice(0, 7);
}

export const MESES_TITULO = [
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

export function mesLabel(key: string): string {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const idx = Number(key.slice(5, 7)) - 1;
  return `${MESES_TITULO[idx] || key.slice(5, 7)} ${key.slice(0, 4)}`;
}

export function isSinRoster(r: Pick<IndicadorRow, 'sin_roster'>): boolean {
  const v = r.sin_roster;
  return (
    v === true ||
    String(v).toUpperCase() === 'VERDADERO' ||
    String(v).toUpperCase() === 'TRUE' ||
    String(v).includes('#')
  );
}

export function isCurrentStaffRow(r: { estatus?: unknown; ESTATUS?: unknown }): boolean {
  const est = String(r.estatus ?? r.ESTATUS ?? 'ACTIVO').trim().toUpperCase();
  return !['BAJA', 'INACTIVO', 'INACTIVA'].includes(est);
}

/* ==================== MULTI-CORTE AGGREGATION ==================== */

export const FLOW_FIELDS_IND: (keyof IndicadorRow)[] = [
  'pagos_esperados',
  'pagos_recibidos',
  'monto_esperado',
  'monto_recibido',
  'monto_recibido_esperado',
  'monto_recibido_no_esperado',
  'colocacion_semanal',
  'monto_colocacion_semanal',
  'clientes_nuevos',
  'renovaciones',
  'renov_tiempo',
  'renov_tardia',
  'monto_nuevos',
  'monto_renovaciones',
  'monto_nuevos_dashboard',
  'monto_renovaciones_dashboard',
  'desembolso',
  'productivo',
];

export const SNAPSHOT_FIELDS_IND: (keyof IndicadorRow)[] = [
  'num_creditos',
  'pagare',
  'clientes_vigentes',
  'saldo_capital',
  'saldo_total',
  'mora_capital',
  'mora_total',
  'dias_mora_prom',
];

export const FLOW_FIELDS_COM: (keyof ComisionEjecutivoRow)[] = [
  'pagos_esperados',
  'pagos_recibidos',
  'monto_esperado',
  'monto_recibido',
  'monto_recibido_no_esperado',
  'cobranza_total',
  'comision_cobranza',
  'bono_excelencia',
  'cobranza_credito_adicional',
  'comision_cobranza_adicional',
  'comision_cartera_heredada',
  'recuperacion_cartera_heredada',
  'clientes_nuevos',
  'clientes_en_tiempo',
  'clientes_tardias',
  'total_clientes',
  'monto_nuevos',
  'monto_en_tiempo',
  'monto_tardias',
  'monto_renovaciones',
  'total_colocado',
  'comision_colocacion_total',
  'comision_apoyo_familiar',
  'comision_modelo_tradicional',
  'comision_modelo_ej_nuevo',
  'apoyo_economico',
  'bono_mensual',
  'campanas',
  'bono_crecimiento_neto',
  'convenio',
  'incapacidad',
  'multas',
  'penalizacion_traspaso',
  'penalizacion_decremento',
  'prestamo_capital_humano',
  'prestamo_caja_ahorro',
  'descuentos_prestamos',
  'comision_final',
  'retencion_caja_ahorro',
  'retroactivos_otros_apoyos',
  'total_a_cobrar',
];

export function aggregateIndicadoresByEjecutivo(rows: IndicadorRow[]): IndicadorRow[] {
  const sorted = [...rows].sort((a, b) => a.corte - b.corte);
  const map = new Map<string, IndicadorRow>();
  for (const r of sorted) {
    const key = r.ejecutivo;
    if (!map.has(key)) {
      const copy: IndicadorRow = { ...r };
      for (const f of FLOW_FIELDS_IND) {
        (copy as unknown as Record<string, unknown>)[f] = 0;
      }
      map.set(key, copy);
    }
    const acc = map.get(key)!;
    for (const f of FLOW_FIELDS_IND) {
      const val = num(r[f]);
      (acc as unknown as Record<string, number>)[f] = num(acc[f]) + val;
    }
    for (const f of SNAPSHOT_FIELDS_IND) {
      if (r[f] !== null && r[f] !== undefined) {
        (acc as unknown as Record<string, unknown>)[f] = r[f];
      }
    }
    acc.estatus = r.estatus;
    acc.corte = r.corte;
    acc.region = r.region || acc.region;
    acc.agencia = r.agencia || acc.agencia;
    acc.coordinador = r.coordinador || acc.coordinador;
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    pct_normalidad: r.pagos_esperados > 0 ? r.pagos_recibidos / r.pagos_esperados : null,
    pct_mora: r.saldo_total > 0 ? r.mora_total / r.saldo_total : 0,
  }));
}

export function aggregateComisionesByEjecutivo(
  rows: ComisionEjecutivoRow[]
): ComisionEjecutivoRow[] {
  const sorted = [...rows].sort((a, b) => a.corte - b.corte);
  const map = new Map<string, ComisionEjecutivoRow>();
  for (const r of sorted) {
    const key = r.ejecutivo;
    if (!map.has(key)) {
      const copy: ComisionEjecutivoRow = { ...r };
      for (const f of FLOW_FIELDS_COM) {
        (copy as unknown as Record<string, unknown>)[f] = 0;
      }
      map.set(key, copy);
    }
    const acc = map.get(key)!;
    for (const f of FLOW_FIELDS_COM) {
      (acc as unknown as Record<string, number>)[f] = num(acc[f]) + num(r[f]);
    }
    acc.estatus = r.estatus;
    acc.corte = r.corte;
    acc.tipo_esquema = r.tipo_esquema || acc.tipo_esquema;
    acc.region = r.region || acc.region;
    acc.agencia = r.agencia || acc.agencia;
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    pct_normalidad: r.pagos_esperados > 0 ? r.pagos_recibidos / r.pagos_esperados : null,
  }));
}

export function weightedNormalidad(
  rows: Array<{ pagos_esperados?: number; pagos_recibidos?: number }>
): number {
  let esp = 0;
  let rec = 0;
  for (const r of rows) {
    esp += num(r.pagos_esperados);
    rec += num(r.pagos_recibidos);
  }
  return esp > 0 ? rec / esp : 0;
}

/* ==================== COMMISSION FORMULAS ==================== */

export function tipoEsquemaRow(r: Partial<ComisionEjecutivoRow>): 'NUEVO' | 'TRADICIONAL' {
  const t = normText(r.tipo_esquema);
  return t.includes('NUEVO') ? 'NUEVO' : 'TRADICIONAL';
}

export function comisionCobranzaTotalRow(r: Partial<ComisionEjecutivoRow>): number {
  return (
    num(r.comision_cobranza) +
    num(r.bono_excelencia) +
    num(r.comision_cobranza_adicional) +
    num(r.comision_cartera_heredada)
  );
}

export function totalDescuentosRow(r: Partial<ComisionEjecutivoRow>): number {
  return (
    num(r.multas) +
    num(r.penalizacion_traspaso) +
    num(r.penalizacion_decremento) +
    num(r.prestamo_capital_humano) +
    num(r.prestamo_caja_ahorro)
  );
}

export function modeloNuevoAplicableRow(r: Partial<ComisionEjecutivoRow>): number {
  return tipoEsquemaRow(r) === 'NUEVO' ? num(r.comision_modelo_ej_nuevo) : 0;
}

export function comisionBaseRow(r: Partial<ComisionEjecutivoRow>): number {
  const trad = num(r.comision_modelo_tradicional);
  const nuevo = modeloNuevoAplicableRow(r);
  return tipoEsquemaRow(r) === 'NUEVO' ? Math.max(trad, nuevo) : trad;
}

export function comisionPagarRow(r: Partial<ComisionEjecutivoRow>): number {
  return Math.max(comisionBaseRow(r) - totalDescuentosRow(r), 0);
}

export function colocacionNuevoRow(r: Partial<ComisionEjecutivoRow>): number {
  return tipoEsquemaRow(r) === 'NUEVO' ? num(r.monto_nuevos) * 0.07 : 0;
}

export function colocacionBaseRow(r: Partial<ComisionEjecutivoRow>): number {
  const base = num(r.comision_colocacion_total);
  const nuevo = colocacionNuevoRow(r);
  return tipoEsquemaRow(r) === 'NUEVO' ? Math.max(base, nuevo) : base;
}

export function incentivoColocacionPagarRow(r: Partial<ComisionEjecutivoRow>): number {
  return colocacionBaseRow(r) + num(r.comision_apoyo_familiar);
}

export function comisionMayorSourceRow(r: Partial<ComisionEjecutivoRow>): number {
  return num(r.comision_mayor !== undefined ? r.comision_mayor : r.bono_crecimiento_neto);
}

/* ==================== TERRITORY HIERARCHY TREE ==================== */

export interface TreeMetrics {
  pag: number;
  cli: number;
  pe: number;
  pr: number;
  saldo: number;
  mora: number;
}

export interface TreeNode {
  id: string;
  lvl: 0 | 1 | 2 | 3 | 4;
  num?: number;
  label: string;
  agencia?: string;
  estatus?: string;
  m: TreeMetrics;
  kids: TreeNode[];
}

export function buildTerritoryTree(rows: IndicadorRow[]) {
  const blank = (): TreeMetrics => ({ pag: 0, cli: 0, pe: 0, pr: 0, saldo: 0, mora: 0 });
  const root: TreeNode = {
    id: 'root',
    lvl: 0,
    label: 'Consolidado del alcance autorizado',
    m: blank(),
    kids: [],
  };

  const tmap = new Map<string, TreeNode>();
  const rmap = new Map<string, TreeNode>();
  const amap = new Map<string, TreeNode>();
  const emap = new Map<string, TreeNode>();

  for (const r of rows) {
    const reg = regionDisplayName(r.region || 'Sin región');
    const regKey = dailyRegionScopeKey(reg) || reg;
    const ag = r.agencia || 'Sin agencia';
    const ej = r.ejecutivo || 'Sin nombre';
    const t = terrOf(reg);
    const tk = `t:${t}`;
    const rk = `r:${regKey}`;
    const ak = `a:${regKey}|${ag}`;
    const ek = `e:${regKey}|${ag}|${ej}`;

    if (!tmap.has(tk)) {
      const tn: TreeNode = {
        id: tk,
        lvl: 1,
        num: t,
        label: t ? `Territorio ${t}` : 'Sin territorio',
        m: blank(),
        kids: [],
      };
      tmap.set(tk, tn);
      root.kids.push(tn);
    }
    if (!rmap.has(rk)) {
      const rn: TreeNode = {
        id: rk,
        lvl: 2,
        label: `Región ${reg}`,
        m: blank(),
        kids: [],
      };
      rmap.set(rk, rn);
      tmap.get(tk)!.kids.push(rn);
    }
    if (!amap.has(ak)) {
      const an: TreeNode = {
        id: ak,
        lvl: 3,
        label: `Agencia ${ag}`,
        m: blank(),
        kids: [],
      };
      amap.set(ak, an);
      rmap.get(rk)!.kids.push(an);
    }
    if (!emap.has(ek)) {
      const en: TreeNode = {
        id: ek,
        lvl: 4,
        label: ej,
        agencia: ag,
        estatus: r.estatus,
        m: blank(),
        kids: [],
      };
      emap.set(ek, en);
      amap.get(ak)!.kids.push(en);
    }

    const em = emap.get(ek)!.m;
    em.pag += num(r.desembolso);
    em.cli += num(r.clientes_vigentes);
    em.pe += num(r.pagos_esperados);
    em.pr += num(r.pagos_recibidos);
    em.saldo += num(r.saldo_total);
    em.mora += num(r.mora_total);
  }

  const roll = (n: TreeNode) => {
    if (n.kids.length) {
      n.kids.forEach((k) => {
        roll(k);
        n.m.pag += k.m.pag;
        n.m.cli += k.m.cli;
        n.m.pe += k.m.pe;
        n.m.pr += k.m.pr;
        n.m.saldo += k.m.saldo;
        n.m.mora += k.m.mora;
      });
      n.kids.sort((a, b) =>
        n.lvl === 0 ? (a.num || 99) - (b.num || 99) : b.m.pag - a.m.pag
      );
    }
  };
  roll(root);

  const territorios = root.kids;
  const regions = territorios.flatMap((t) => t.kids);
  const ejecutivos = Array.from(emap.values());

  return { root, territorios, regions, ejecutivos };
}

/* ==================== ROLE SCOPING ==================== */

export function scopeWeeklyRows<T extends { region?: string; agencia?: string; ejecutivo?: string }>(
  rows: T[],
  role: Role,
  nombre: string,
  scopes: {
    coordinador: ScopeEntry[];
    gerente: ScopeEntry[];
    regional: ScopeEntry[];
  }
): T[] {
  if (role === 'admin' || role === 'directivo' || role === 'direccion') return rows;
  const pk = personKey(nombre);
  if (role === 'ejecutivo') {
    return rows.filter((r) => personKey(r.ejecutivo) === pk);
  }
  if (role === 'coordinador') {
    const allowed = new Set(
      scopes.coordinador
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
    );
    return rows.filter((r) =>
      allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`)
    );
  }
  if (role === 'gerente') {
    const allowed = new Set(
      scopes.gerente
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
    );
    return rows.filter((r) =>
      allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`)
    );
  }
  if (role === 'regional') {
    const allowed = new Set(
      scopes.regional
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => dailyRegionScopeKey(s.region))
    );
    return rows.filter((r) => allowed.has(dailyRegionScopeKey(r.region)));
  }
  return [];
}

export interface RoleScopes {
  coordinador: ScopeEntry[];
  gerente: ScopeEntry[];
  regional: ScopeEntry[];
}

export function scopeRoleScopes(
  scopes: RoleScopes,
  role: Role,
  nombre: string
): RoleScopes {
  if (role === 'admin' || role === 'directivo' || role === 'direccion') {
    return scopes;
  }
  if (role === 'ejecutivo') {
    return { coordinador: [], gerente: [], regional: [] };
  }
  const pk = personKey(nombre);
  if (role === 'regional') {
    const selfRegional = scopes.regional.filter((s) => personKey(s.persona) === pk);
    const allowedRegions = new Set(
      selfRegional.map((s) => dailyRegionScopeKey(s.region)).filter(Boolean)
    );
    return {
      regional: selfRegional,
      gerente: scopes.gerente.filter((s) =>
        allowedRegions.has(dailyRegionScopeKey(s.region))
      ),
      coordinador: scopes.coordinador.filter((s) =>
        allowedRegions.has(dailyRegionScopeKey(s.region))
      ),
    };
  }
  if (role === 'gerente') {
    const selfGerente = scopes.gerente.filter((s) => personKey(s.persona) === pk);
    const allowedPairs = new Set(
      selfGerente
        .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
        .filter((k) => k !== '|')
    );
    return {
      regional: [],
      gerente: selfGerente,
      coordinador: scopes.coordinador.filter((s) =>
        allowedPairs.has(`${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
      ),
    };
  }
  if (role === 'coordinador') {
    return {
      regional: [],
      gerente: [],
      coordinador: scopes.coordinador.filter((s) => personKey(s.persona) === pk),
    };
  }
  return { coordinador: [], gerente: [], regional: [] };
}

export function scopeDirectorioRows(
  rows: DirectorioRow[],
  role: Role,
  nombre: string,
  scopes: RoleScopes
): DirectorioRow[] {
  if (role === 'admin' || role === 'directivo' || role === 'direccion') return rows;
  if (role === 'ejecutivo') return [];
  const pk = personKey(nombre);
  if (role === 'regional') {
    const allowed = new Set(
      scopes.regional
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => dailyRegionScopeKey(s.region))
        .filter(Boolean)
    );
    return rows.filter(
      (r) =>
        allowed.has(dailyRegionScopeKey(r.region)) &&
        (r.rol_persona !== 'regional' || personKey(r.empleado) === pk)
    );
  }
  if (role === 'gerente') {
    const allowed = new Set(
      scopes.gerente
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
        .filter((k) => k !== '|')
    );
    return rows.filter(
      (r) =>
        allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`) &&
        (r.rol_persona === 'coordinador' ||
          (r.rol_persona === 'gerente' && personKey(r.empleado) === pk))
    );
  }
  if (role === 'coordinador') {
    const allowed = new Set(
      scopes.coordinador
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
        .filter((k) => k !== '|')
    );
    return rows.filter(
      (r) =>
        r.rol_persona === 'coordinador' &&
        personKey(r.empleado) === pk &&
        allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`)
    );
  }
  return [];
}

export function scopeDailyRows(
  rows: DailyRow[],
  role: Role,
  nombre: string,
  scopes: {
    coordinador: ScopeEntry[];
    gerente: ScopeEntry[];
    regional: ScopeEntry[];
  },
  gerenteCom: DirectorioRow[],
  regionalCom: DirectorioRow[]
): DailyRow[] {
  if (role === 'admin' || role === 'directivo' || role === 'direccion') return rows;
  const pk = personKey(nombre);
  if (role === 'ejecutivo') {
    return rows.filter((r) => personKey(r.ASESOR) === pk);
  }
  if (!rows.length) return [];

  const newest = rows.reduce((m, r) => (r.FECHACORTE > m ? r.FECHACORTE : m), '');
  const latest = rows.filter((r) => r.FECHACORTE === newest);

  if (role === 'coordinador') {
    const manual = new Set(
      scopes.coordinador
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
    );
    const current = new Set(
      latest
        .filter((r) => personKey(r.COORDINADOR) === pk)
        .map((r) => `${dailyRegionScopeKey(r.REGIONAL)}|${normText(r.SUCURSAL)}`)
    );
    const allowed = new Set([...manual].filter((k) => current.has(k)));
    return rows.filter((r) =>
      allowed.has(`${dailyRegionScopeKey(r.REGIONAL)}|${normText(r.SUCURSAL)}`)
    );
  }

  if (role === 'gerente') {
    const manual = new Set(
      scopes.gerente
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
    );
    const maxWeek = gerenteCom.reduce((m, r) => Math.max(m, num(r.semana)), 0);
    const current = new Set(
      gerenteCom
        .filter(
          (r) =>
            num(r.semana) === maxWeek &&
            personKey(r.empleado) === pk &&
            isCurrentStaffRow(r)
        )
        .map((r) => `${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`)
    );
    const allowed = new Set([...manual].filter((k) => current.has(k)));
    return rows.filter((r) =>
      allowed.has(`${dailyRegionScopeKey(r.REGIONAL)}|${normText(r.SUCURSAL)}`)
    );
  }

  if (role === 'regional') {
    const manual = new Set(
      scopes.regional
        .filter((s) => personKey(s.persona) === pk)
        .map((s) => dailyRegionScopeKey(s.region))
    );
    const maxWeek = regionalCom.reduce((m, r) => Math.max(m, num(r.semana)), 0);
    const current = new Set(
      regionalCom
        .filter(
          (r) =>
            num(r.semana) === maxWeek &&
            personKey(r.empleado) === pk &&
            isCurrentStaffRow(r)
        )
        .map((r) => dailyRegionScopeKey(r.region))
    );
    const allowed = new Set([...manual].filter((k) => current.has(k)));
    return rows.filter((r) => allowed.has(dailyRegionScopeKey(r.REGIONAL)));
  }

  return [];
}

/* ==================== DAILY METRICS ==================== */

export function computeDailyMetrics(rows: DailyRow[]) {
  const sum = (field: string) => rows.reduce((acc, r) => acc + num(r[field]), 0);
  const ratio = (a: number, b: number) => (b ? a / b : 0);

  const pe = sum('PAGOS_ESPERADOS_ACUM');
  const pr = sum('PAGOS_RECIBIDOS_ACUM');
  const real =
    sum('COMISION_COBRANZA_REAL') +
    sum('BONO_EXCELENCIA_REAL') +
    sum('COMISION_MAS_POR_TI_REAL');
  const potential =
    sum('COMISION_COBRANZA_POTENCIAL') +
    sum('BONO_EXCELENCIA_POTENCIAL') +
    sum('COMISION_MAS_POR_TI_POTENCIAL');

  const modelPick = (r: DailyRow, newField: string, tradField: string) => {
    const m = personKey(r.MODELO_COMISION_PAGADO);
    if (m.includes('NUEVO')) return num(r[newField]);
    if (m.includes('TRADICIONAL')) return num(r[tradField]);
    return 0;
  };

  const opportunity = rows.reduce((acc, r) => {
    const pot =
      num(r.COMISION_COBRANZA_POTENCIAL) +
      num(r.BONO_EXCELENCIA_POTENCIAL) +
      num(r.COMISION_MAS_POR_TI_POTENCIAL);
    const rl =
      num(r.COMISION_COBRANZA_REAL) +
      num(r.BONO_EXCELENCIA_REAL) +
      num(r.COMISION_MAS_POR_TI_REAL);
    return acc + Math.max(0, pot - rl);
  }, 0);

  return {
    sum,
    normalidad: rows.length === 1 ? num(rows[0].NORMALIDAD_ACUM) : ratio(pr, pe),
    cumplimiento: ratio(pr, pe),
    cobranza: ratio(sum('COBRANZA_RECIBIDA_ACUM'), sum('COBRANZA_ESPERADA_ACUM')),
    renovaciones: ratio(sum('RENOVACIONES_EN_TIEMPO_ACUM'), sum('CLIENTES_RENOVADOS_ACUM')),
    desembolso:
      sum('DESEMBOLSO_CLIENTES_NUEVOS_ACUM') +
      sum('DESEMBOLSO_RENOVACION_TIEMPO_ACUM') +
      sum('DESEMBOLSO_RENOVACION_TARDIA_ACUM'),
    real,
    potential,
    opportunity,
    advance: ratio(real, potential),
    colocacion: rows.reduce(
      (acc, r) =>
        acc +
        modelPick(r, 'COMISION_COLOCACION_EJECUTIVO_NUEVO', 'COMISION_COLOCACION_TRADICIONAL'),
      0
    ),
    esquema: rows.reduce(
      (acc, r) =>
        acc +
        modelPick(
          r,
          'COMISION_NUEVO_MAS_INCENTIVOS',
          'COMISION_TRADICIONAL_MAS_INCENTIVOS'
        ),
      0
    ),
    otros:
      sum('COMISION_APOYO_FAMILIAR') +
      sum('APOYO_ECONOMICO') +
      sum('BONO_MENSUAL') +
      sum('CAMPANAS') +
      sum('RETROACTIVOS_OTROS_APOYOS'),
    neto: rows.reduce(
      (acc, r) =>
        acc + num(r.COMISION_FINAL) - Math.abs(num(r.DESCUENTOS_TOTALES)),
      0
    ),
  };
}

/* ==================== MONTHLY NORMALIDAD AGGREGATION ==================== */

export interface NormalidadBucket {
  expected: number;
  received: number;
  rows: number;
  normality: number | null;
  expectedAmt: number;
  receivedExpected: number;
  receivedUnexpected: number;
  recovery: number | null;
  missing: number;
}

export interface NormalidadMonthReport {
  month: string;
  rows: number;
  regions: Array<NormalidadBucket & { name: string }>;
  agencies: Array<NormalidadBucket & { region: string; name: string }>;
  weeks: Array<NormalidadBucket & { date: string }>;
  weeklyRegion: Map<string, number | null>;
  weeklyAgency: Map<string, number | null>;
  total: NormalidadBucket & { regions: number; agencies: number };
}

export function aggregateNormalidadMonth(
  month: string,
  rows: NormalidadRawRow[]
): NormalidadMonthReport {
  type Acc = {
    expected: number;
    received: number;
    expectedAmt: number;
    receivedExpected: number;
    receivedUnexpected: number;
    rows: number;
  };
  const blank = (): Acc => ({
    expected: 0,
    received: 0,
    expectedAmt: 0,
    receivedExpected: 0,
    receivedUnexpected: 0,
    rows: 0,
  });
  const add = (o: Acc, x: NormalidadRawRow) => {
    o.expected += x.esp;
    o.received += x.rec;
    o.expectedAmt += x.amtE;
    o.receivedExpected += x.amtER;
    o.receivedUnexpected += x.amtNE;
    o.rows++;
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const r6 = (v: number | null) => (v == null ? null : Math.round(v * 1e6) / 1e6);
  const fin = (o: Acc): NormalidadBucket => ({
    expected: o.expected,
    received: o.received,
    rows: o.rows,
    normality: o.expected > 0 ? r6(o.received / o.expected) : null,
    expectedAmt: r2(o.expectedAmt),
    receivedExpected: r2(o.receivedExpected),
    receivedUnexpected: r2(o.receivedUnexpected),
    recovery: o.expectedAmt > 0 ? r6(o.receivedExpected / o.expectedAmt) : null,
    missing: r2(o.expectedAmt - o.receivedExpected),
  });

  const tot = blank();
  const wk = new Map<string, Acc>();
  const rg = new Map<string, Acc>();
  const ag = new Map<string, Acc>();
  const wr = new Map<string, Acc>();
  const wa = new Map<string, Acc>();

  for (const x of rows) {
    const kr = regionDisplayName(x.region || 'SIN REGIÓN');
    const ka = `${kr}||${x.agency}`;
    add(tot, x);
    if (!wk.has(x.date)) wk.set(x.date, blank());
    add(wk.get(x.date)!, x);
    if (!rg.has(kr)) rg.set(kr, blank());
    add(rg.get(kr)!, x);
    if (!ag.has(ka)) ag.set(ka, blank());
    add(ag.get(ka)!, x);
    const wrk = `${kr}||${x.date}`;
    if (!wr.has(wrk)) wr.set(wrk, blank());
    add(wr.get(wrk)!, x);
    const wak = `${ka}||${x.date}`;
    if (!wa.has(wak)) wa.set(wak, blank());
    add(wa.get(wak)!, x);
  }

  const weeks = Array.from(wk.keys())
    .sort()
    .map((date) => ({ ...fin(wk.get(date)!), date }));
  const regions = Array.from(rg.keys()).map((name) => ({ ...fin(rg.get(name)!), name }));
  const agencies = Array.from(ag.keys()).map((k) => {
    const [region, name] = k.split('||');
    return { ...fin(ag.get(k)!), region, name };
  });

  const weeklyRegion = new Map<string, number | null>();
  wr.forEach((acc, key) => {
    weeklyRegion.set(key, acc.expected > 0 ? r6(acc.received / acc.expected) : null);
  });
  const weeklyAgency = new Map<string, number | null>();
  wa.forEach((acc, key) => {
    weeklyAgency.set(key, acc.expected > 0 ? r6(acc.received / acc.expected) : null);
  });

  const totalFin = fin(tot);
  return {
    month,
    rows: rows.length,
    regions,
    agencies,
    weeks,
    weeklyRegion,
    weeklyAgency,
    total: {
      ...totalFin,
      regions: regions.length,
      agencies: agencies.length,
    },
  };
}

/* ==================== EXCEL WORKBOOK PARSERS ==================== */

function cleanHeader(v: unknown): string {
  return String(v == null ? '' : v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findHeaderIndex(headers: string[], aliases: string[], required = true): number {
  const clean = headers.map(cleanHeader);
  for (const a of aliases) {
    const idx = clean.indexOf(cleanHeader(a));
    if (idx >= 0) return idx;
  }
  if (required) {
    throw new Error(`No encontré la columna: ${aliases.join(' / ')}`);
  }
  return -1;
}

function classifyTipo(v: unknown): string {
  const s = cleanHeader(v);
  if (s.includes('NUEV')) return 'NUEVO';
  if (s.includes('RENOV')) return 'RENOVADO';
  return s;
}

export interface ParsedWeeklyWorkbook {
  fileName: string;
  week: number;
  sourceRows: number;
  indicadoresRows: IndicadorRow[];
  ejecutivoRows: Record<string, unknown>[];
  coordinadorRows: Record<string, unknown>[];
  gerenteRows: Record<string, unknown>[];
  regionalRows: Record<string, unknown>[];
  summary: {
    nuevos: number;
    monto_nuevos: number;
    renovaciones: number;
    monto_renovaciones: number;
    ejecutivoTotalCobrar: number;
  };
}

export async function parseWeeklyWorkbookFile(file: File): Promise<ParsedWeeklyWorkbook> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });

  const indSheetName = wb.SheetNames.find((s) => cleanHeader(s) === 'INDICADORES');
  if (!indSheetName) {
    throw new Error('El archivo no contiene una hoja llamada INDICADORES.');
  }

  const indMatrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    wb.Sheets[indSheetName],
    { header: 1, defval: '', raw: true }
  );
  let indHeaderIdx = -1;
  for (let i = 0; i < Math.min(25, indMatrix.length); i++) {
    const row = (indMatrix[i] || []).map(cleanHeader);
    if (row.includes('NOMBRE EJECUTIVO') && row.includes('SEMANA')) {
      indHeaderIdx = i;
      break;
    }
  }
  if (indHeaderIdx < 0) {
    throw new Error('No encontré los encabezados NOMBRE EJECUTIVO / SEMANA en INDICADORES.');
  }

  const indHeaders = (indMatrix[indHeaderIdx] || []).map((x) => String(x || '').trim());
  const colIdx = {
    exec: findHeaderIndex(indHeaders, ['NOMBRE EJECUTIVO']),
    region: findHeaderIndex(indHeaders, ['REGION']),
    agencia: findHeaderIndex(indHeaders, ['AGENCIA']),
    coord: findHeaderIndex(indHeaders, ['COORDINADOR'], false),
    semana: findHeaderIndex(indHeaders, ['SEMANA']),
    tipo: findHeaderIndex(indHeaders, ['TIPO DESEMBOLSO']),
    des: findHeaderIndex(indHeaders, ['$ DESEMBOLSO']),
    clientes: findHeaderIndex(indHeaders, ['# CLIENTES VIGENTES']),
    pe: findHeaderIndex(indHeaders, ['$ PAGO ESPERADO']),
    pr: findHeaderIndex(indHeaders, ['$ PAGO RECIBIDO']),
    ce: findHeaderIndex(indHeaders, ['$ COBRANZA ESPERADA']),
    cr: findHeaderIndex(indHeaders, ['$ COBRANZA RECIBIDA']),
    cre: findHeaderIndex(indHeaders, ['$ COBRANZA RECIBIDA ESPERADA'], false),
    crne: findHeaderIndex(indHeaders, ['$ COBRANZA RECIBIDA NO ESPERADA']),
    mc: findHeaderIndex(indHeaders, ['$ MORA CAPITAL']),
    mt: findHeaderIndex(indHeaders, ['$ MORA TOTAL']),
    dm: findHeaderIndex(indHeaders, ['DIAS DE MORA', 'DÍAS DE MORA']),
    sc: findHeaderIndex(indHeaders, ['$ SALDO CAPITAL']),
    st: findHeaderIndex(indHeaders, ['$ SALDO TOTAL']),
  };

  const validIndRows = indMatrix
    .slice(indHeaderIdx + 1)
    .filter((r) => r && cleanHeader(r[colIdx.exec]) !== '');

  const detectedWeeks = Array.from(
    new Set(
      validIndRows
        .map((r) => Math.round(num(r[colIdx.semana])))
        .filter((w) => w >= 1 && w <= 53)
    )
  );
  if (detectedWeeks.length !== 1) {
    throw new Error(
      `El archivo debe contener exactamente una semana. Detectadas: ${detectedWeeks.join(', ') || 'ninguna'}`
    );
  }
  const week = detectedWeeks[0];
  const weekIndRows = validIndRows.filter(
    (r) => Math.round(num(r[colIdx.semana])) === week
  );

  type IndAcc = IndicadorRow & { _dmSum: number; _dmCount: number };
  const byExec = new Map<string, IndAcc>();

  for (const r of weekIndRows) {
    const execName = cleanHeader(r[colIdx.exec]);
    if (!execName) continue;
    if (!byExec.has(execName)) {
      byExec.set(execName, {
        corte: 0,
        ejecutivo: execName,
        region: cleanHeader(r[colIdx.region]),
        agencia: cleanHeader(r[colIdx.agencia]),
        estatus: '-',
        coordinador: colIdx.coord >= 0 ? cleanHeader(r[colIdx.coord]) || '-' : '-',
        sin_roster: false,
        num_creditos: 0,
        pagos_esperados: 0,
        pagos_recibidos: 0,
        monto_esperado: 0,
        monto_recibido: 0,
        monto_recibido_esperado: 0,
        monto_recibido_no_esperado: 0,
        mora_capital: 0,
        mora_total: 0,
        dias_mora_prom: 0,
        clientes_vigentes: 0,
        saldo_capital: 0,
        saldo_total: 0,
        desembolso: 0,
        colocacion_semanal: 0,
        monto_colocacion_semanal: 0,
        clientes_nuevos: 0,
        renovaciones: 0,
        pct_normalidad: 0,
        pct_mora: 0,
        monto_nuevos: 0,
        monto_renovaciones: 0,
        renov_tiempo: 0,
        renov_tardia: 0,
        productivo: 0,
        pagare: 0,
        comision_cartera_heredada: 0,
        apoyo_familiar: 0,
        _dmSum: 0,
        _dmCount: 0,
      });
    }
    const acc = byExec.get(execName)!;
    const cli = num(r[colIdx.clientes]);
    const des = num(r[colIdx.des]);
    acc.num_creditos += cli;
    acc.clientes_vigentes += cli;
    acc.pagos_esperados += num(r[colIdx.pe]);
    acc.pagos_recibidos += num(r[colIdx.pr]);
    acc.monto_esperado += num(r[colIdx.ce]);
    acc.monto_recibido += num(r[colIdx.cr]);
    if (colIdx.cre >= 0) acc.monto_recibido_esperado += num(r[colIdx.cre]);
    acc.monto_recibido_no_esperado += num(r[colIdx.crne]);
    acc.mora_capital += num(r[colIdx.mc]);
    acc.mora_total += num(r[colIdx.mt]);
    const dmRaw = r[colIdx.dm];
    const dmNum = Number(dmRaw);
    if (dmRaw !== null && dmRaw !== '' && Number.isFinite(dmNum)) {
      acc._dmSum += dmNum;
      acc._dmCount += 1;
    }
    acc.saldo_capital += num(r[colIdx.sc]);
    acc.saldo_total += num(r[colIdx.st]);
    acc.desembolso += des;

    if (des !== 0) {
      const tipo = classifyTipo(r[colIdx.tipo]);
      if (tipo === 'NUEVO') {
        acc.clientes_nuevos += 1;
        acc.monto_nuevos += des;
      } else if (tipo === 'RENOVADO') {
        acc.renovaciones += 1;
        acc.monto_renovaciones += des;
      }
    }
  }

  const indicadoresRows: IndicadorRow[] = Array.from(byExec.values())
    .map((x) => {
      const { _dmSum, _dmCount, ...rest } = x;
      rest.dias_mora_prom = _dmCount ? _dmSum / _dmCount : 0;
      rest.colocacion_semanal = rest.clientes_nuevos + rest.renovaciones;
      rest.monto_colocacion_semanal = rest.monto_nuevos + rest.monto_renovaciones;
      rest.productivo = rest.colocacion_semanal > 0 ? 1 : 0;
      rest.pagare = rest.desembolso;
      rest.pct_normalidad =
        rest.pagos_esperados > 0 ? rest.pagos_recibidos / rest.pagos_esperados : 0;
      rest.pct_mora = rest.saldo_total > 0 ? rest.mora_total / rest.saldo_total : 0;
      return rest;
    })
    .sort((a, b) => a.ejecutivo.localeCompare(b.ejecutivo, 'es'));

  // Parse Commission sheets
  const readCommissionSheet = (
    aliases: string[],
    roleKey: 'ejecutivo' | 'coordinador' | 'gerente' | 'regional'
  ): Record<string, unknown>[] => {
    const sname = wb.SheetNames.find((s) =>
      aliases.some((a) => cleanHeader(s) === cleanHeader(a))
    );
    if (!sname) return [];
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      wb.Sheets[sname],
      { header: 1, defval: '', raw: true }
    );
    let hdrIdx = -1;
    const keyCol = roleKey === 'ejecutivo' ? 'EJECUTIVO' : 'EMPLEADO';
    for (let i = 0; i < Math.min(25, matrix.length); i++) {
      const row = (matrix[i] || []).map(cleanHeader);
      if (row.includes(keyCol) && row.includes('REGION')) {
        hdrIdx = i;
        break;
      }
    }
    if (hdrIdx < 0) return [];
    const headers = (matrix[hdrIdx] || []).map(cleanHeader);
    const colPos = new Map<string, number>();
    headers.forEach((h, idx) => {
      if (h && !colPos.has(h)) colPos.set(h, idx);
    });
    const getVal = (row: (string | number | null)[], ...names: string[]) => {
      for (const n of names) {
        const idx = colPos.get(cleanHeader(n));
        if (idx !== undefined) return row[idx] ?? '';
      }
      return '';
    };
    const getNum = (row: (string | number | null)[], ...names: string[]) =>
      num(getVal(row, ...names));

    const out: Record<string, unknown>[] = [];
    for (const row of matrix.slice(hdrIdx + 1)) {
      if (!row) continue;
      const person = cleanHeader(getVal(row, keyCol));
      const region = cleanHeader(getVal(row, 'REGION'));
      if (!person || !region) continue;
      const base: Record<string, unknown> = {
        mes: getNum(row, 'MES'),
        semana: week,
        corte: getNum(row, 'CORTE'),
        periodo: String(getVal(row, 'PERIODO') || ''),
        region,
        estatus: cleanHeader(getVal(row, 'ESTATUS')),
        puesto: cleanHeader(getVal(row, 'PUESTO ACTUAL')),
        pagos_esperados: getNum(row, 'PAGOS ESPERADOS'),
        pagos_recibidos: getNum(row, 'PAGOS RECIBIDOS'),
        pct_normalidad: getNum(row, '% NORMALIDAD'),
        comision_cobranza: getNum(
          row,
          '$ COMISION COBRANZA',
          'COMISION X COBRANZA',
          'COMISIÓN X COBRANZA'
        ),
        apoyo_familiar: getNum(row, 'APOYO FAMILIAR', 'COMISION APOYO FAMILIAR'),
        comision_modelo_tradicional: getNum(row, 'COMISION MODELO TRADICIONAL'),
        apoyo_economico: getNum(row, 'APOYO ECONOMICO'),
        bono_mensual: getNum(row, 'BONO MENSUAL'),
        comision_mayor: getNum(row, 'COMISION MAYOR'),
        multas: getNum(row, 'MULTAS'),
        prestamo_capital_humano: getNum(row, 'PRESTAMO CAPITAL HUMANO'),
        prestamo_caja_ahorro: getNum(row, 'PRESTAMO CAJA DE AHORRO'),
        descuentos_prestamos: getNum(row, 'DESCUENTOS X PRESTAMOS'),
        retencion_caja_ahorro: getNum(row, 'RETENCION CAJA DE AHORRO'),
        retroactivos_otros_apoyos: getNum(row, 'RETROACTIVOS Y OTROS APOYOS'),
        total_a_cobrar: getNum(row, 'TOTAL A COBRAR'),
      };
      if (roleKey === 'ejecutivo') {
        const mTiempo = getNum(row, '$ EN TIEMPO');
        const mTardias = getNum(row, '$ TARDIAS');
        Object.assign(base, {
          agencia: cleanHeader(getVal(row, 'AGENCIA')),
          ejecutivo: person,
          monto_esperado: getNum(row, '$ ESPERADA'),
          monto_recibido: getNum(row, '$ RECIBIDA'),
          monto_recibido_no_esperado: getNum(row, '$ RECIBIDA NO ESPERADA'),
          cobranza_total: getNum(row, '$ COBRANZA TOTAL'),
          bono_excelencia: getNum(row, 'BONO DE EXCELENCIA'),
          cobranza_credito_adicional: getNum(row, '$ COBRANZA CREDITO ADICIONAL'),
          comision_cobranza_adicional: getNum(row, 'COMISION X COBRANZA ADICIONAL'),
          comision_cartera_heredada: getNum(row, 'COMISION CARTERA HEREDADA'),
          recuperacion_cartera_heredada: getNum(row, '$ RECUPERACION CART HERD'),
          clientes_nuevos: getNum(row, 'NVOS'),
          clientes_en_tiempo: getNum(row, 'EN TIEMPO'),
          clientes_tardias: getNum(row, 'TARDIAS'),
          total_clientes: getNum(row, 'TOTAL CLIENTES'),
          monto_nuevos: getNum(row, '$ NUEVOS'),
          monto_en_tiempo: mTiempo,
          monto_tardias: mTardias,
          monto_renovaciones: mTiempo + mTardias,
          total_colocado: getNum(row, 'TOTAL COLOCADO'),
          comision_colocacion_total: getNum(row, 'COMISION X COLOCACION TOTAL'),
          comision_apoyo_familiar: getNum(row, 'COMISION APOYO FAMILIAR'),
          tipo_esquema: cleanHeader(getVal(row, 'TIPO')),
          comision_modelo_ej_nuevo: getNum(row, 'COMISION MODELO EJ NUEVO'),
          convenio: getNum(row, 'CONVENIO'),
          incapacidad: getNum(row, 'INCAPACIDAD'),
          campanas: getNum(row, 'CAMPANAS'),
          penalizacion_traspaso: getNum(row, 'PENALIZACION X TRASPASO'),
          penalizacion_decremento: getNum(row, 'PENALIZACION X DECREMENTO'),
          comision_final: getNum(row, 'COMISION FINAL'),
          coordinador: cleanHeader(getVal(row, 'COORDINADOR')) || '-',
        });
      } else {
        Object.assign(base, {
          empleado: person,
          agencia: cleanHeader(getVal(row, 'AGENCIA')),
          num_ejecutivos: getNum(row, '# DE EJECUTIVOS'),
          ejecutivos_productivos: getNum(row, 'EJECUTIVOS PRODUCTIVOS'),
          pct_productividad_equipo: getNum(row, '%'),
          pct_comision_productividad: getNum(row, '% COMISION X PRODUCTIVIDAD'),
          comision_productividad: getNum(row, '$ COMISION +/- PRODUCTIVIDAD'),
          incentivo_final: getNum(row, 'INCENTIVO FINAL'),
        });
      }
      out.push(base);
    }
    return out;
  };

  const ejecutivoRows = readCommissionSheet(['EJECUTIVO', 'COMISIONES EJECUTIVO'], 'ejecutivo');
  const coordinadorRows = readCommissionSheet(['COORDINADOR', 'COORDINADORES'], 'coordinador');
  const gerenteRows = readCommissionSheet(['GERENTE', 'GERENTES'], 'gerente');
  const regionalRows = readCommissionSheet(
    ['GERENTE REGIONAL', 'GERENTE_REGIONAL', 'REGIONAL', 'REGIONALES'],
    'regional'
  );

  const summary = {
    nuevos: indicadoresRows.reduce((s, r) => s + r.clientes_nuevos, 0),
    monto_nuevos: indicadoresRows.reduce((s, r) => s + r.monto_nuevos, 0),
    renovaciones: indicadoresRows.reduce((s, r) => s + r.renovaciones, 0),
    monto_renovaciones: indicadoresRows.reduce((s, r) => s + r.monto_renovaciones, 0),
    ejecutivoTotalCobrar: ejecutivoRows.reduce((s, r) => s + num(r.total_a_cobrar), 0),
  };

  return {
    fileName: file.name,
    week,
    sourceRows: weekIndRows.length,
    indicadoresRows,
    ejecutivoRows,
    coordinadorRows,
    gerenteRows,
    regionalRows,
    summary,
  };
}

export interface ParsedDailyWorkbook {
  fileName: string;
  headers: string[];
  rows: (string | number)[][];
  dates: string[];
  totalRows: number;
}

const DAILY_REQUIRED = [
  'FECHACORTE',
  'COD_ASESOR',
  'ASESOR',
  'COD_REGIONAL',
  'REGIONAL',
  'COD_SUCURSAL',
  'SUCURSAL',
  'COMISION_FINAL',
  'TOTAL_A_COBRAR',
];

export async function parseDailyWorkbookFile(file: File): Promise<ParsedDailyWorkbook> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: '',
    raw: true,
  });
  if (matrix.length < 2) {
    throw new Error('El archivo diario no contiene filas de datos.');
  }
  const headers = (matrix[0] || []).map((h) => String(h || '').trim().toUpperCase());
  for (const req of DAILY_REQUIRED) {
    if (!headers.includes(req)) {
      throw new Error(`Falta la columna requerida ${req} en el archivo diario.`);
    }
  }
  const fechaIx = headers.indexOf('FECHACORTE');
  const asesorIx = headers.indexOf('ASESOR');
  const codIx = headers.indexOf('COD_ASESOR');
  const seen = new Set<string>();
  const datesSet = new Set<string>();
  const cleanRows: (string | number)[][] = [];

  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i];
    if (!raw || raw.every((c) => c === '' || c === null || c === undefined)) continue;
    const d = dailyDateKey(raw[fechaIx]);
    if (!d) throw new Error(`FECHACORTE inválida en fila ${i + 1}`);
    if (!String(raw[asesorIx] || '').trim()) {
      throw new Error(`ASESOR vacío en fila ${i + 1}`);
    }
    const cod = cleanHeader(raw[codIx]);
    if (!cod) throw new Error(`COD_ASESOR vacío en fila ${i + 1}`);
    const dupKey = `${d}|${cod}`;
    if (seen.has(dupKey)) throw new Error(`Duplicado fecha+asesor: ${dupKey}`);
    seen.add(dupKey);
    datesSet.add(d);
    cleanRows.push(
      headers.map((_, j) => {
        if (j === fechaIx) return d;
        const val = raw[j];
        return val == null ? '' : (val as string | number);
      })
    );
  }

  return {
    fileName: file.name,
    headers,
    rows: cleanRows,
    dates: Array.from(datesSet).sort(),
    totalRows: cleanRows.length,
  };
}

export interface ParsedNormalidadWorkbook {
  fileName: string;
  rows: NormalidadRawRow[];
  months: NormalidadMonthReport[];
  byMonth: Record<string, NormalidadRawRow[]>;
  dateHeader: string;
  skipped: number;
}

export async function parseNormalidadWorkbookFile(
  file: File
): Promise<ParsedNormalidadWorkbook> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const sheetName = wb.SheetNames.find((s) => cleanHeader(s) === 'NORMALIDAD');
  if (!sheetName) {
    throw new Error('No encontré la hoja "NORMALIDAD" en el archivo.');
  }
  const A = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    wb.Sheets[sheetName],
    { header: 1, defval: null, raw: true }
  );
  let hi = -1;
  for (let i = 0; i < Math.min(A.length, 30); i++) {
    const r = A[i];
    if (
      r &&
      cleanHeader(r[0]) === 'REGION' &&
      cleanHeader(r[1]) === 'AGENCIA' &&
      cleanHeader(r[2]) === 'EJECUTIVO'
    ) {
      hi = i;
      break;
    }
  }
  if (hi < 0) {
    throw new Error(
      'No encontré los encabezados REGION / AGENCIA / EJECUTIVO en la hoja NORMALIDAD.'
    );
  }
  const col: Record<string, number> = {};
  (A[hi] || []).forEach((h, j) => {
    const c = cleanHeader(h);
    if (c && col[c] === undefined) col[c] = j;
  });
  for (const req of [
    'ESPERADO',
    'RECIBIDO',
    '$ ESPERADA',
    '$ ESPERADA RECIBIDA',
    '$ RECIBIDA NO ESPERADA',
  ]) {
    if (col[req] === undefined) {
      throw new Error(`Falta la columna "${req}" en la hoja NORMALIDAD.`);
    }
  }

  const cands: Array<{ h: string; c: string; j: number; set: Set<string> }> = [];
  (A[hi] || []).forEach((h, j) => {
    const c = cleanHeader(h);
    if (h != null && /CORTE|SEMAN|FECHA/.test(c)) {
      cands.push({ h: String(h).trim(), c, j, set: new Set() });
    }
  });
  for (let i = hi + 1; i < A.length; i++) {
    const r = A[i];
    if (
      !r ||
      typeof r[0] !== 'string' ||
      !r[0].trim() ||
      typeof r[2] !== 'string' ||
      !r[2].trim()
    ) {
      continue;
    }
    for (const cd of cands) {
      const d = dailyDateKey(r[cd.j]);
      if (d) cd.set.add(d);
    }
  }
  let best: (typeof cands)[0] | null = null;
  for (const cd of cands) {
    if (
      cd.set.size > 0 &&
      (!best ||
        cd.set.size > best.set.size ||
        (cd.set.size === best.set.size && cd.c === 'CORTE'))
    ) {
      best = cd;
    }
  }
  if (!best) {
    throw new Error('No encontré una columna con fechas de corte semanal en NORMALIDAD.');
  }

  const rows: NormalidadRawRow[] = [];
  let skipped = 0;
  for (let i = hi + 1; i < A.length; i++) {
    const r = A[i];
    if (
      !r ||
      typeof r[0] !== 'string' ||
      !r[0].trim() ||
      typeof r[2] !== 'string' ||
      !r[2].trim()
    ) {
      continue;
    }
    const date = dailyDateKey(r[best.j]);
    if (!date) {
      skipped++;
      continue;
    }
    const amtER = num(r[col['$ ESPERADA RECIBIDA']]);
    const amtNE = num(r[col['$ RECIBIDA NO ESPERADA']]);
    rows.push({
      region: r[0].trim(),
      agency: String(r[1] == null ? '' : r[1]).trim() || 'SIN AGENCIA',
      ejecutivo: r[2].trim(),
      date,
      monthKey: nrmMonthKeyFromCut(date),
      esp: num(r[col['ESPERADO']]),
      rec: num(r[col['RECIBIDO']]),
      amtE: num(r[col['$ ESPERADA']]),
      amtR: col['$ RECIBIDA'] !== undefined ? num(r[col['$ RECIBIDA']]) : amtER + amtNE,
      amtER,
      amtNE,
    });
  }
  if (!rows.length) {
    throw new Error('La hoja NORMALIDAD no contiene filas con fecha de corte.');
  }
  const byMonth: Record<string, NormalidadRawRow[]> = {};
  for (const r of rows) {
    (byMonth[r.monthKey] = byMonth[r.monthKey] || []).push(r);
  }
  const months = Object.keys(byMonth)
    .sort()
    .map((m) => aggregateNormalidadMonth(m, byMonth[m]));

  return {
    fileName: file.name,
    rows,
    months,
    byMonth,
    dateHeader: best.h,
    skipped,
  };
}

export function parseBackupInfo(
  sheetId: number,
  name: string,
  rowCount: number,
  columnCount: number
): BackupInfo | null {
  if (!/^BK_ADMIN_/.test(name)) return null;
  const m = name.match(/^BK_ADMIN_(.+)_S(\d+)_(\d{8})_(\d{6})(?:_.+)?$/);
  let source = '';
  let week: number | '' = '';
  let created = '';
  if (m) {
    source = m[1];
    week = Number(m[2]);
    const d = m[3];
    const t = m[4];
    created = `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  } else if (/^BK_ADMIN_DIARIOS_(\d{8})_(\d{6})(?:_.+)?$/.test(name)) {
    const dm = name.match(/^BK_ADMIN_DIARIOS_(\d{8})_(\d{6})/);
    source = 'DIARIOS';
    if (dm) {
      const d = dm[1];
      const t = dm[2];
      created = `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
    }
  } else {
    const wm = name.match(/_S(\d+)_/);
    week = wm ? Number(wm[1]) : '';
    source = name.replace(/^BK_ADMIN_/, '').replace(/_S\d+_.+$/, '');
  }
  return {
    sheetId,
    name,
    source,
    week,
    created,
    rows: Math.max(0, rowCount - 1),
    columns: columnCount,
  };
}

export interface PendingUserCandidate {
  role: 'ejecutivo' | 'coordinador' | 'gerente' | 'regional';
  nombre: string;
  scopes: Array<{ region: string; agencia: string }>;
  semana: number;
}

export function detectPendingUsers(
  users: UserRecord[],
  cortes: CorteRow[],
  ejecutivoCom: ComisionEjecutivoRow[],
  coordinadorCom: DirectorioRow[],
  gerenteCom: DirectorioRow[],
  regionalCom: DirectorioRow[],
  diarios: DailyRow[]
): { semanaActual: number; pending: PendingUserCandidate[] } {
  const weeks = cortes.map((c) => num(c.SEMANA)).filter((w) => w > 0);
  const week = weeks.length
    ? Math.max(...weeks)
    : Math.max(
        1,
        ...ejecutivoCom.map((r) => num(r.semana)),
        ...coordinadorCom.map((r) => num(r.semana))
      );

  const candidates: Array<{
    role: PendingUserCandidate['role'];
    nombre: string;
    region: string;
    agencia: string;
  }> = [];

  const push = (
    role: PendingUserCandidate['role'],
    nombre: string,
    region: string,
    agencia: string
  ) => {
    const n = String(nombre || '').trim().toUpperCase();
    if (!n || n === '-') return;
    candidates.push({
      role,
      nombre: n,
      region: String(region || '').trim().toUpperCase(),
      agencia: String(agencia || '').trim().toUpperCase(),
    });
  };

  ejecutivoCom
    .filter((r) => num(r.semana) === week && isCurrentStaffRow(r))
    .forEach((r) => push('ejecutivo', r.ejecutivo, r.region, r.agencia));
  coordinadorCom
    .filter((r) => num(r.semana) === week && isCurrentStaffRow(r))
    .forEach((r) => push('coordinador', r.empleado, r.region, r.agencia));
  gerenteCom
    .filter((r) => num(r.semana) === week && isCurrentStaffRow(r))
    .forEach((r) => push('gerente', r.empleado, r.region, r.agencia));
  regionalCom
    .filter((r) => num(r.semana) === week && isCurrentStaffRow(r))
    .forEach((r) => push('regional', r.empleado, r.region, ''));

  if (diarios.length) {
    const newest = diarios.reduce((m, r) => (r.FECHACORTE > m ? r.FECHACORTE : m), '');
    diarios
      .filter((r) => r.FECHACORTE === newest && isCurrentStaffRow(r))
      .forEach((r) => {
        push('ejecutivo', r.ASESOR, r.REGIONAL, r.SUCURSAL);
        push('coordinador', r.COORDINADOR, r.REGIONAL, r.SUCURSAL);
      });
  }

  const existingKeys = new Set(
    users.map((u) => `${u.role.toLowerCase()}|${personKey(u.nombre)}`)
  );
  const grouped = new Map<string, PendingUserCandidate & { _seen: Set<string> }>();

  for (const c of candidates) {
    const k = `${c.role}|${personKey(c.nombre)}`;
    if (existingKeys.has(k)) continue;
    if (!grouped.has(k)) {
      grouped.set(k, {
        role: c.role,
        nombre: c.nombre,
        scopes: [],
        semana: week,
        _seen: new Set(),
      });
    }
    const g = grouped.get(k)!;
    const sk = `${c.region}|${c.agencia}`;
    if (!g._seen.has(sk)) {
      g._seen.add(sk);
      g.scopes.push({ region: c.region, agencia: c.agencia });
    }
  }

  const pending = Array.from(grouped.values())
    .map(({ _seen, ...rest }) => rest)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return { semanaActual: week, pending };
}

/* ==================== HIERARCHY STAFF FILTER & DIRECTORIO AGG ==================== */

export interface ResolvedStaffScope {
  mode: 'regional' | 'gerente' | 'coordinador';
  matchedName: string;
  pk: string;
  regions: Set<string>; // dailyRegionScopeKey(region)
  pairs: Set<string>;   // `${dailyRegionScopeKey(region)}|${normText(agencia)}`
  matchedDirRows: DirectorioRow[];
}

export function regionMatchesFilter(rowRegion: string | undefined, filterRegion: string): boolean {
  if (!filterRegion || filterRegion === 'ALL') return true;
  if (rowRegion === filterRegion) return true;
  return dailyRegionScopeKey(rowRegion) === dailyRegionScopeKey(filterRegion);
}

export function resolveStaffSearchScope(
  query: string,
  dirRows: DirectorioRow[],
  scopes?: {
    coordinador?: ScopeEntry[];
    gerente?: ScopeEntry[];
    regional?: ScopeEntry[];
  },
  activeFilters?: { region?: string; agencia?: string }
): ResolvedStaffScope | null {
  const clean = query.trim();
  if (!clean) return null;
  const qPk = personKey(clean);
  if (!qPk) return null;

  const filterRegion = activeFilters?.region && activeFilters.region !== 'ALL' ? activeFilters.region : '';
  const filterAgencia = activeFilters?.agencia && activeFilters.agencia !== 'ALL' ? normText(activeFilters.agencia) : '';

  const entryMatchesActiveFilters = (
    role: 'regional' | 'gerente' | 'coordinador',
    region: string | undefined,
    agencia: string | undefined
  ) => {
    if (filterRegion && !regionMatchesFilter(region, filterRegion)) return false;
    if (filterAgencia && role !== 'regional' && normText(agencia) !== filterAgencia) {
      return false;
    }
    return true;
  };

  const tryResolveForRole = (
    role: 'regional' | 'gerente' | 'coordinador',
    scopeList: ScopeEntry[]
  ): ResolvedStaffScope | null => {
    const eligibleDir = dirRows.filter(
      (r) => r.rol_persona === role && entryMatchesActiveFilters(role, r.region, r.agencia)
    );
    const eligibleScopes = scopeList.filter((s) =>
      entryMatchesActiveFilters(role, s.region, s.agencia)
    );

    const exactDir = eligibleDir.filter((r) => personKey(r.empleado) === qPk);
    const exactScope = eligibleScopes.filter((s) => personKey(s.persona) === qPk);

    let targetPk = qPk;
    let matchedName = clean.toUpperCase();
    let matchedDir = exactDir;
    let matchedScopes = exactScope;

    // If no exact match, check unique partial match when typing a name (at least 4 chars)
    if (!exactDir.length && !exactScope.length && qPk.length >= 4) {
      const candidateNames = new Map<string, string>();
      eligibleDir.forEach((r) => {
        if (personKey(r.empleado).includes(qPk)) {
          candidateNames.set(personKey(r.empleado), r.empleado);
        }
      });
      eligibleScopes.forEach((s) => {
        if (personKey(s.persona).includes(qPk)) {
          candidateNames.set(personKey(s.persona), s.persona);
        }
      });
      if (candidateNames.size === 1) {
        const [onlyPk, onlyName] = Array.from(candidateNames.entries())[0];
        targetPk = onlyPk;
        matchedName = onlyName;
        matchedDir = eligibleDir.filter((r) => personKey(r.empleado) === targetPk);
        matchedScopes = eligibleScopes.filter((s) => personKey(s.persona) === targetPk);
      }
    } else if (exactDir.length || exactScope.length) {
      matchedName = exactDir[0]?.empleado || exactScope[0]?.persona || matchedName;
    }

    if (!matchedDir.length && !matchedScopes.length) return null;

    const regions = new Set<string>();
    const pairs = new Set<string>();

    matchedDir.forEach((r) => {
      const rk = dailyRegionScopeKey(r.region);
      if (rk) regions.add(rk);
      const ak = normText(r.agencia);
      if (rk && ak) pairs.add(`${rk}|${ak}`);
    });
    matchedScopes.forEach((s) => {
      const rk = dailyRegionScopeKey(s.region);
      if (rk) regions.add(rk);
      const ak = normText(s.agencia);
      if (rk && ak) pairs.add(`${rk}|${ak}`);
    });

    return {
      mode: role,
      matchedName,
      pk: targetPk,
      regions,
      pairs,
      matchedDirRows: matchedDir,
    };
  };

  return (
    tryResolveForRole('regional', scopes?.regional || []) ||
    tryResolveForRole('gerente', scopes?.gerente || []) ||
    tryResolveForRole('coordinador', scopes?.coordinador || [])
  );
}

export function rowMatchesStaffScope(
  row: { region?: string; agencia?: string; ejecutivo?: string; coordinador?: string },
  query: string,
  resolved: ResolvedStaffScope | null
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (resolved) {
    const rk = dailyRegionScopeKey(row.region);
    if (resolved.mode === 'regional') {
      if (resolved.regions.has(rk)) return true;
    } else if (resolved.mode === 'gerente') {
      if (resolved.pairs.has(`${rk}|${normText(row.agencia)}`)) return true;
    } else if (resolved.mode === 'coordinador') {
      if (
        resolved.pairs.has(`${rk}|${normText(row.agencia)}`) ||
        (row.coordinador && personKey(row.coordinador) === resolved.pk)
      ) {
        return true;
      }
    }
  }

  return (
    (row.ejecutivo || '').toLowerCase().includes(q) ||
    (row.coordinador || '').toLowerCase().includes(q) ||
    (row.agencia || '').toLowerCase().includes(q) ||
    (row.region || '').toLowerCase().includes(q) ||
    regionDisplayName(row.region || '').toLowerCase().includes(q)
  );
}

const DIR_FLOW_FIELDS: (keyof DirectorioRow)[] = [
  'pagos_esperados',
  'pagos_recibidos',
  'comision_cobranza',
  'comision_productividad',
  'apoyo_familiar',
  'comision_modelo_tradicional',
  'apoyo_economico',
  'bono_mensual',
  'comision_mayor',
  'multas',
  'prestamo_capital_humano',
  'prestamo_caja_ahorro',
  'descuentos_prestamos',
  'incentivo_final',
  'retencion_caja_ahorro',
  'retroactivos_otros_apoyos',
  'total_a_cobrar',
];

export function aggregateDirectorioRows(rows: DirectorioRow[]): DirectorioRow[] {
  const sorted = [...rows].sort((a, b) => a.corte - b.corte);
  const map = new Map<string, DirectorioRow>();
  for (const r of sorted) {
    const key = `${r.rol_persona}|${personKey(r.empleado)}|${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`;
    if (!map.has(key)) {
      const copy: DirectorioRow = { ...r };
      for (const f of DIR_FLOW_FIELDS) {
        (copy as unknown as Record<string, number>)[f] = 0;
      }
      map.set(key, copy);
    }
    const acc = map.get(key)!;
    for (const f of DIR_FLOW_FIELDS) {
      (acc as unknown as Record<string, number>)[f] = num(acc[f]) + num(r[f]);
    }
    acc.num_ejecutivos = r.num_ejecutivos;
    acc.ejecutivos_productivos = r.ejecutivos_productivos;
    acc.pct_productividad_equipo = r.pct_productividad_equipo;
    acc.pct_comision_productividad = r.pct_comision_productividad;
    acc.estatus = r.estatus || acc.estatus;
    acc.puesto = r.puesto || acc.puesto;
    acc.corte = r.corte || acc.corte;
    acc.semana = r.semana || acc.semana;
    acc.region = r.region || acc.region;
    acc.agencia = r.agencia || acc.agencia;
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    pct_normalidad: r.pagos_esperados > 0 ? r.pagos_recibidos / r.pagos_esperados : null,
  }));
}


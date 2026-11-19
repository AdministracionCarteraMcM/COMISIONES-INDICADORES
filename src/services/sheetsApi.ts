import type {
  BackupInfo,
  ComisionEjecutivoRow,
  CorteRow,
  DailyRow,
  DirectorioRow,
  DriveSpreadsheet,
  IndicadorRow,
  LogEntry,
  NormalidadRawRow,
  RawSpreadsheetData,
  Role,
  ScopeEntry,
  UserRecord,
} from '../types/mcm';
import {
  dailyDateKey,
  dailyRegionScopeKey,
  dateToSerial,
  formatPeriodo,
  isCurrentStaffRow,
  lastDayOfMonth,
  normText,
  nrmMonthKeyFromCut,
  nullableNum,
  num,
  parseBackupInfo,
  personKey,
  scopeDailyRows,
  scopeDirectorioRows,
  scopeWeeklyRows,
  serialToDate,
  type ParsedDailyWorkbook,
  type ParsedWeeklyWorkbook,
  type PendingUserCandidate,
} from '../utils/mcmData';

export const DEFAULT_SPREADSHEET_ID = '1UnWSSYLEHfrdmX21NipwdjcRJ9xWr-vo1GfM-o2QqeE';

export const SHEET_NAMES = {
  CORTES: 'CORTES',
  EJECUTIVO: 'EJECUTIVO',
  INDICADORES: 'INDICADORES',
  COORDINADOR: 'COORDINADOR',
  GERENTE: 'GERENTE',
  REGIONAL: 'GERENTE_REGIONAL',
  USUARIOS: 'USUARIOS',
  SCOPE_EJECUTIVO: 'SCOPE_EJECUTIVO',
  SCOPE_COORDINADOR: 'SCOPE_COORDINADOR',
  SCOPE_GERENTE: 'SCOPE_GERENTE',
  SCOPE_REGIONAL: 'SCOPE_REGIONAL',
  LOG: 'LOG_ACTUALIZACIONES',
  DIARIOS: 'INDICADORES_DIARIOS',
  NORMALIDAD: 'NORMALIDAD',
  METAS: 'Metas',
} as const;

class WorkspaceAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const SESSION_STORAGE_KEY = 'mcm_portal_session_token';

let activeMcMSessionToken: string | null = (() => {
  try {
    return typeof window !== 'undefined'
      ? window.sessionStorage.getItem(SESSION_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
})();

export function setMcMSessionToken(token: string | null): void {
  activeMcMSessionToken = token;
  try {
    if (typeof window !== 'undefined') {
      if (token) {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
      } else {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage restrictions
  }
}

export function getMcMSessionToken(): string | null {
  return activeMcMSessionToken;
}

export interface ServerHealthStatus {
  ok: boolean;
  serviceAccountConfigured: boolean;
  serviceAccountEmail?: string;
  appsScriptConfigured?: boolean;
  adminBridgeActive: boolean;
  unattendedReady: boolean;
  spreadsheetId: string;
}

const APPS_SCRIPT_FALLBACK_URL =
  'https://script.google.com/macros/s/AKfycby6ay6s4W3n0mh2xC34d8YHHiyRO6aUigcE0lvUt_6GgZ8JpO2fVroLHajpfEL5IOYoeA/exec';

let directAppsScriptToken: string | null = null;

type SafeApiResult<T> =
  | { ok: true; isHtml: false; status: number; data: T }
  | { ok: false; isHtml: boolean; status: number; error: string };

async function fetchApiJson<T>(
  url: string,
  init?: RequestInit,
  retries = 2,
  timeoutMs = 25_000
): Promise<SafeApiResult<T>> {
  let lastStatus = 0;
  let lastIsHtml = false;
  let lastError = 'Error de comunicación con el servidor.';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: init?.signal || controller.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const rawText = await res.text();
      const trimmed = rawText.trimStart();
      const looksHtml =
        contentType.includes('text/html') ||
        trimmed.startsWith('<');

      if (looksHtml) {
        lastIsHtml = true;
        lastError = `El servidor devolvió una página HTML (HTTP ${res.status}) en lugar de JSON.`;
        if (attempt < retries) {
          if (url !== '/api/health') {
            fetch('/api/health', { cache: 'no-store' }).catch(() => {});
          }
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        return { ok: false, isHtml: true, status: res.status, error: lastError };
      }

      if (!trimmed) {
        lastIsHtml = false;
        lastError = `Respuesta vacía del servidor (HTTP ${res.status}).`;
        if (attempt < retries && res.status >= 500) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        return { ok: false, isHtml: false, status: res.status, error: lastError };
      }

      const parsed = JSON.parse(rawText) as T & { ok?: boolean; error?: string };
      if (!res.ok) {
        const msg =
          (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) ||
          `Error HTTP ${res.status}`;
        if (attempt < retries && (res.status === 502 || res.status === 503)) {
          const code = (parsed as { code?: string })?.code;
          if (code !== 'NO_SERVER_SHEET_BRIDGE') {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            continue;
          }
        }
        return { ok: false, isHtml: false, status: res.status, error: String(msg) };
      }
      return { ok: true, isHtml: false, status: res.status, data: parsed };
    } catch (err) {
      clearTimeout(timer);
      lastIsHtml = false;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      lastError = isAbort
        ? 'Tiempo de espera agotado al conectar con el servidor.'
        : err instanceof Error
        ? err.message
        : 'Error de red.';
      if (isAbort) {
        return { ok: false, isHtml: false, status: 504, error: lastError };
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
    }
  }

  return { ok: false, isHtml: lastIsHtml, status: lastStatus, error: lastError };
}

function scopeDataClientFallback(
  raw: RawSpreadsheetData,
  role: Role,
  nombre: string
): RawSpreadsheetData {
  const isPrivilegedMonthly =
    role === 'admin' || role === 'directivo' || role === 'direccion';
  const isAdmin = role === 'admin';
  const scopes = {
    coordinador: raw.scopeCoordinador,
    gerente: raw.scopeGerente,
    regional: raw.scopeRegional,
  };
  return {
    ...raw,
    sheetMeta: isAdmin ? raw.sheetMeta : [],
    indicadores: scopeWeeklyRows(raw.indicadores, role, nombre, scopes),
    ejecutivoCom: scopeWeeklyRows(raw.ejecutivoCom, role, nombre, scopes),
    coordinadorCom:
      role === 'coordinador' || role === 'gerente' || role === 'regional' || isPrivilegedMonthly
        ? scopeDirectorioRows(raw.coordinadorCom, role, nombre, scopes)
        : [],
    gerenteCom:
      role === 'gerente' || role === 'regional' || isPrivilegedMonthly
        ? scopeDirectorioRows(raw.gerenteCom, role, nombre, scopes)
        : [],
    regionalCom:
      role === 'gerente' || role === 'regional' || isPrivilegedMonthly
        ? scopeDirectorioRows(raw.regionalCom, role, nombre, scopes)
        : [],
    usuarios: isAdmin
      ? raw.usuarios.map((u) => ({
          username: u.username,
          role: u.role,
          nombre: u.nombre,
          estado: u.estado,
        }))
      : [],
    scopeEjecutivo: isAdmin ? raw.scopeEjecutivo : [],
    scopeCoordinador:
      isPrivilegedMonthly || role === 'coordinador' ? raw.scopeCoordinador : [],
    scopeGerente:
      isPrivilegedMonthly || role === 'gerente' ? raw.scopeGerente : [],
    scopeRegional:
      isPrivilegedMonthly || role === 'regional' ? raw.scopeRegional : [],
    diarios: scopeDailyRows(
      raw.diarios,
      role,
      nombre,
      scopes,
      raw.gerenteCom,
      raw.regionalCom
    ),
    normalidadRaw: isPrivilegedMonthly ? raw.normalidadRaw : [],
    normalidadMeta: null,
    backups: isAdmin ? raw.backups : [],
    logs: isAdmin ? raw.logs : [],
    metas: raw.metas || [],
  };
}

async function directGoogleLoginFallback(
  googleAccessToken: string,
  spreadsheetId: string
): Promise<{
  session: {
    username: string;
    role: Role;
    nombre: string;
    mode: 'usuario_interno' | 'google_workspace';
    googleEmail?: string;
  };
  sessionToken: string;
  data: RawSpreadsheetData;
}> {
  const tokenInfoRes = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(
      googleAccessToken
    )}`
  );
  if (!tokenInfoRes.ok) {
    throw new WorkspaceAuthError('Token de Google inválido o expirado.', 401);
  }
  const tokenInfo = (await tokenInfoRes.json()) as { email?: string };
  const email = String(tokenInfo.email || '').trim().toLowerCase();

  let canEditMasterSheet = false;
  try {
    const driveMeta = await googleFetch<{ capabilities?: { canEdit?: boolean } }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        spreadsheetId
      )}?fields=capabilities(canEdit)&supportsAllDrives=true`,
      googleAccessToken
    );
    canEditMasterSheet = Boolean(driveMeta.capabilities?.canEdit);
  } catch {
    canEditMasterSheet = false;
  }

  const raw = await loadPortalData(googleAccessToken, spreadsheetId);
  const matchedUser = raw.usuarios.find(
    (u) =>
      u.estado !== 'inactivo' &&
      (u.username === email || (email && u.username === email.split('@')[0]))
  );

  let role: Role;
  let nombre: string;
  let username: string;

  if (canEditMasterSheet) {
    role = 'admin';
    nombre = matchedUser?.nombre || 'Administrador McM';
    username = email || matchedUser?.username || 'admin';
  } else if (matchedUser) {
    role = matchedUser.role;
    nombre = matchedUser.nombre;
    username = matchedUser.username;
  } else {
    throw new WorkspaceAuthError(
      `La cuenta ${email || 'Google'} no tiene permisos de Administrador ni está registrada en USUARIOS.`,
      403
    );
  }

  if (canEditMasterSheet && raw.metas && raw.metas.length > 0) {
    fetch('/api/portal/sync-metas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${googleAccessToken}`,
      },
      body: JSON.stringify({ spreadsheetId, metas: raw.metas }),
    }).catch(() => {});
  }

  setMcMSessionToken(null);
  return {
    session: {
      username,
      role,
      nombre,
      googleEmail: email || undefined,
      mode: 'google_workspace',
    },
    sessionToken: '',
    data: scopeDataClientFallback(raw, role, nombre),
  };
}

async function callAppsScriptClient<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  timeoutMs = 25_000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(APPS_SCRIPT_FALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    if (!text || text.trimStart().startsWith('<')) {
      throw new WorkspaceAuthError('Apps Script no devolvió JSON válido.', res.status || 502);
    }
    const json = JSON.parse(text) as T & { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      const errMsg = json.error || `Error en Apps Script (${res.status})`;
      const status = errMsg.includes('SESSION_REVOKED') ? 401 : res.status >= 400 ? res.status : 401;
      throw new WorkspaceAuthError(errMsg, status);
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new WorkspaceAuthError('Tiempo de espera agotado al validar en Apps Script.', 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRoleFromScript(rawRole: unknown): Role {
  const k = String(rawRole ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .trim();
  if (k === 'administrador' || k === 'admin' || k.includes('admin')) return 'admin';
  if (k.includes('directiv') || k.includes('director')) return 'directivo';
  if (k.includes('direccion')) return 'direccion';
  if (k === 'gerente_regional' || k.includes('regional')) return 'regional';
  if (k.includes('gerente')) return 'gerente';
  if (k.includes('coordinador')) return 'coordinador';
  return 'ejecutivo';
}

async function appsScriptPortalFallback(params: {
  username?: string;
  password?: string;
  sessionToken?: string;
}): Promise<{
  session: {
    username: string;
    role: Role;
    nombre: string;
    mode: 'usuario_interno' | 'google_workspace';
    googleEmail?: string;
  };
  sessionToken: string;
  data: RawSpreadsheetData;
}> {
  const base = params.sessionToken
    ? await callAppsScriptClient<Record<string, unknown>>({
        action: 'refresh_data',
        session_token: params.sessionToken,
      })
    : await callAppsScriptClient<Record<string, unknown>>({
        action: 'login',
        username: params.username || '',
        password: params.password || '',
      });

  const token = String(base.session_token || params.sessionToken || '');
  directAppsScriptToken = token || null;
  setMcMSessionToken(null);

  const role = normalizeRoleFromScript(base.role);
  const nombre = String(base.nombre ?? '').trim().toUpperCase();
  const username = String(base.username ?? '').trim().toLowerCase();
  const isPrivileged = role === 'admin' || role === 'directivo' || role === 'direccion';

  const cortes: CorteRow[] = ((base.cortes as Record<string, unknown>[]) || [])
    .map((c) => ({
      MES: nullableNum(c.MES ?? c.mes),
      SEMANA: num(c.SEMANA ?? c.semana),
      CORTE: num(c.CORTE ?? c.corte),
      PERIODO: String(c.PERIODO ?? c.periodo ?? '').trim(),
    }))
    .filter((c) => c.CORTE > 0)
    .sort((a, b) => a.CORTE - b.CORTE);

  const corteMeta = new Map<number, { semana: number; mes: number; periodo: string }>();
  cortes.forEach((c) => corteMeta.set(c.CORTE, { semana: c.SEMANA, mes: num(c.MES), periodo: c.PERIODO }));

  const indicadores: IndicadorRow[] = ((base.ejecutivo_indicadores as Record<string, unknown>[]) || []).map(
    (r) => ({
      corte: num(r.corte),
      ejecutivo: String(r.ejecutivo ?? '').trim(),
      region: String(r.region ?? '').trim(),
      agencia: String(r.agencia ?? '').trim(),
      estatus: String(r.estatus ?? '').trim(),
      coordinador: String(r.coordinador ?? '').trim() || '-',
      sin_roster: (r.sin_roster as boolean | string) ?? '',
      num_creditos: num(r.num_creditos),
      pagos_esperados: num(r.pagos_esperados),
      pagos_recibidos: num(r.pagos_recibidos),
      monto_esperado: num(r.monto_esperado),
      monto_recibido: num(r.monto_recibido),
      monto_recibido_esperado: num(r.monto_recibido_esperado),
      monto_recibido_no_esperado: num(r.monto_recibido_no_esperado),
      mora_capital: num(r.mora_capital),
      mora_total: num(r.mora_total),
      dias_mora_prom: num(r.dias_mora_prom),
      clientes_vigentes: num(r.clientes_vigentes),
      saldo_capital: num(r.saldo_capital),
      saldo_total: num(r.saldo_total),
      desembolso: num(r.desembolso),
      colocacion_semanal: num(r.colocacion_semanal),
      monto_colocacion_semanal: num(r.monto_colocacion_semanal),
      clientes_nuevos: num(r.clientes_nuevos),
      renovaciones: num(r.renovaciones),
      pct_normalidad: nullableNum(r.pct_normalidad),
      pct_mora: num(r.pct_mora),
      monto_nuevos: num(r.monto_nuevos),
      monto_renovaciones: num(r.monto_renovaciones),
      monto_nuevos_dashboard: num(r.monto_nuevos_dashboard ?? r.monto_nuevos),
      monto_renovaciones_dashboard: num(r.monto_renovaciones_dashboard ?? r.monto_renovaciones),
      renov_tiempo: num(r.renov_tiempo),
      renov_tardia: num(r.renov_tardia),
      productivo: num(r.productivo),
      pagare: num(r.pagare),
      comision_cartera_heredada: num(r.comision_cartera_heredada),
      apoyo_familiar: num(r.apoyo_familiar),
    })
  );

  const ejecutivoCom: ComisionEjecutivoRow[] = (
    (base.ejecutivo_comisiones as Record<string, unknown>[]) || []
  ).map((r) => ({
    mes: num(r.mes),
    semana: num(r.semana),
    corte: num(r.corte),
    periodo: String(r.periodo ?? '').trim(),
    region: String(r.region ?? '').trim(),
    agencia: String(r.agencia ?? '').trim(),
    ejecutivo: String(r.ejecutivo ?? '').trim(),
    estatus: String(r.estatus ?? '').trim(),
    puesto: String(r.puesto ?? '').trim(),
    coordinador: String(r.coordinador ?? '').trim() || '-',
    tipo_esquema: String(r.tipo_esquema ?? '').trim(),
    pagos_esperados: num(r.pagos_esperados),
    pagos_recibidos: num(r.pagos_recibidos),
    pct_normalidad: nullableNum(r.pct_normalidad),
    monto_esperado: num(r.monto_esperado),
    monto_recibido: num(r.monto_recibido),
    monto_recibido_no_esperado: num(r.monto_recibido_no_esperado),
    cobranza_total: num(r.cobranza_total),
    comision_cobranza: num(r.comision_cobranza),
    bono_excelencia: num(r.bono_excelencia),
    cobranza_credito_adicional: num(r.cobranza_credito_adicional),
    comision_cobranza_adicional: num(r.comision_cobranza_adicional),
    comision_cartera_heredada: num(r.comision_cartera_heredada),
    recuperacion_cartera_heredada: num(r.recuperacion_cartera_heredada),
    clientes_nuevos: num(r.clientes_nuevos),
    clientes_en_tiempo: num(r.clientes_en_tiempo),
    clientes_tardias: num(r.clientes_tardias),
    total_clientes: num(r.total_clientes),
    monto_nuevos: num(r.monto_nuevos),
    monto_en_tiempo: num(r.monto_en_tiempo),
    monto_tardias: num(r.monto_tardias),
    monto_renovaciones: num(r.monto_renovaciones),
    total_colocado: num(r.total_colocado),
    comision_colocacion_total: num(r.comision_colocacion_total),
    comision_apoyo_familiar: num(r.comision_apoyo_familiar),
    comision_modelo_tradicional: num(r.comision_modelo_tradicional),
    comision_modelo_ej_nuevo: num(r.comision_modelo_ej_nuevo),
    apoyo_economico: num(r.apoyo_economico),
    bono_mensual: num(r.bono_mensual),
    campanas: num(r.campanas),
    bono_crecimiento_neto: num(r.bono_crecimiento_neto),
    convenio: num(r.convenio),
    incapacidad: num(r.incapacidad),
    multas: num(r.multas),
    penalizacion_traspaso: num(r.penalizacion_traspaso),
    penalizacion_decremento: num(r.penalizacion_decremento),
    prestamo_capital_humano: num(r.prestamo_capital_humano),
    prestamo_caja_ahorro: num(r.prestamo_caja_ahorro),
    descuentos_prestamos: num(r.descuentos_prestamos),
    comision_final: num(r.comision_final),
    retencion_caja_ahorro: num(r.retencion_caja_ahorro),
    retroactivos_otros_apoyos: num(r.retroactivos_otros_apoyos),
    total_a_cobrar: num(r.total_a_cobrar),
    comision_mayor:
      r.comision_mayor !== undefined && r.comision_mayor !== '' && r.comision_mayor !== null
        ? num(r.comision_mayor)
        : undefined,
    productivo:
      r.productivo !== undefined && r.productivo !== '' && r.productivo !== null
        ? num(r.productivo)
        : undefined,
  }));

  const dirAll: DirectorioRow[] = (
    (base.directorio_comisiones as Record<string, unknown>[]) || []
  ).map((r) => {
    const corte = num(r.corte);
    const cMeta = corteMeta.get(corte);
    const rp = String(r.rol_persona ?? '').trim().toLowerCase();
    const rolPersona: DirectorioRow['rol_persona'] =
      rp === 'regional' ? 'regional' : rp === 'gerente' ? 'gerente' : 'coordinador';
    return {
      mes: num(r.mes) || cMeta?.mes || 0,
      semana: num(r.semana) || cMeta?.semana || 0,
      corte,
      periodo: String(r.periodo ?? '').trim() || cMeta?.periodo || '',
      region: String(r.region ?? '').trim(),
      agencia: String(r.agencia ?? '').trim(),
      empleado: String(r.empleado ?? '').trim(),
      estatus: String(r.estatus ?? '').trim(),
      puesto: String(r.puesto ?? '').trim(),
      rol_persona: rolPersona,
      pagos_esperados: num(r.pagos_esperados),
      pagos_recibidos: num(r.pagos_recibidos),
      pct_normalidad: nullableNum(r.pct_normalidad),
      comision_cobranza: num(r.comision_cobranza),
      num_ejecutivos: num(r.num_ejecutivos),
      ejecutivos_productivos: num(r.ejecutivos_productivos),
      pct_productividad_equipo: num(r.pct_productividad_equipo),
      pct_comision_productividad: num(r.pct_comision_productividad),
      comision_productividad: num(r.comision_productividad),
      apoyo_familiar: num(r.apoyo_familiar),
      comision_modelo_tradicional: num(r.comision_modelo_tradicional),
      apoyo_economico: num(r.apoyo_economico),
      bono_mensual: num(r.bono_mensual),
      comision_mayor: num(r.comision_mayor),
      multas: num(r.multas),
      prestamo_capital_humano: num(r.prestamo_capital_humano),
      prestamo_caja_ahorro: num(r.prestamo_caja_ahorro),
      descuentos_prestamos: num(r.descuentos_prestamos),
      incentivo_final: num(r.incentivo_final),
      retencion_caja_ahorro: num(r.retencion_caja_ahorro),
      retroactivos_otros_apoyos: num(r.retroactivos_otros_apoyos),
      total_a_cobrar: num(r.total_a_cobrar),
    };
  });

  const coordinadorCom = dirAll.filter((d) => d.rol_persona === 'coordinador');
  const gerenteCom = dirAll.filter((d) => d.rol_persona === 'gerente');
  const regionalCom = dirAll.filter((d) => d.rol_persona === 'regional');

  const mkScopes = (rows: DirectorioRow[], onlyRegion: boolean): ScopeEntry[] => {
    const seen = new Set<string>();
    const out: ScopeEntry[] = [];
    rows.forEach((r) => {
      const persona = r.empleado.toUpperCase();
      const region = r.region.toUpperCase();
      const agencia = onlyRegion ? '' : r.agencia.toUpperCase();
      if (!persona || !region) return;
      const k = `${persona}|${region}|${agencia}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ persona, region, agencia });
      }
    });
    return out;
  };

  return {
    session: {
      username,
      role,
      nombre,
      mode: 'usuario_interno',
    },
    sessionToken: '',
    data: {
      spreadsheetId: String(base.spreadsheet_id || DEFAULT_SPREADSHEET_ID),
      spreadsheetTitle: 'McM_Datos_DashBoard (Apps Script)',
      sheetMeta: [],
      cortes,
      indicadores,
      ejecutivoCom,
      coordinadorCom,
      gerenteCom,
      regionalCom,
      usuarios: [],
      scopeEjecutivo: [],
      scopeCoordinador: isPrivileged || role === 'coordinador' ? mkScopes(coordinadorCom, false) : [],
      scopeGerente: isPrivileged || role === 'gerente' ? mkScopes(gerenteCom, false) : [],
      scopeRegional: isPrivileged || role === 'regional' ? mkScopes(regionalCom, true) : [],
      diariosHeaders: [],
      diarios: [],
      normalidadRaw: [],
      normalidadMeta: null,
      backups: [],
      logs: [],
      metas: Array.isArray(base.metas)
        ? (base.metas as Array<Record<string, unknown>>).map((r) => {
            const metaH = num(r.metaH ?? r.metah ?? r.meta_h);
            const metaI = num(r.metaI ?? r.metai ?? r.meta_i);
            const metaJ = num(r.metaJ ?? r.metaj ?? r.meta_j);
            const metaSumHI = metaH + metaI;
            return {
              fecha: String(r.fecha || r.FECHA || '').trim(),
              region: String(r.region || r.REGION || '').trim() || undefined,
              agencia: String(r.agencia || r.SUCURSAL || r.AGENCIA || '').trim() || undefined,
              asesor: String(r.asesor || r.ASESOR || r.ejecutivo || '').trim(),
              metaH,
              metaI,
              metaJ,
              metaTotal: metaSumHI > 0 ? metaSumHI : num(r.metaTotal ?? r.meta_total ?? metaJ),
            };
          })
        : [],
      preScoped: true,
    },
  };
}

function mapDailyClientRows(rawRows: Record<string, unknown>[]): DailyRow[] {
  return rawRows.map((r) => ({
    ...(r as Record<string, string | number | boolean | null | undefined>),
    FECHACORTE: dailyDateKey(r.FECHACORTE),
    COD_ASESOR: String(r.COD_ASESOR ?? '').trim(),
    ASESOR: String(r.ASESOR ?? '').trim(),
    COD_REGIONAL: String(r.COD_REGIONAL ?? '').trim(),
    REGIONAL: String(r.REGIONAL ?? '').trim(),
    COD_SUCURSAL: String(r.COD_SUCURSAL ?? '').trim(),
    SUCURSAL: String(r.SUCURSAL ?? '').trim(),
    COORDINADOR: String(r.COORDINADOR ?? '').trim(),
    ESTATUS: String(r.ESTATUS ?? '').trim(),
    ID_PERIODO: String(r.ID_PERIODO ?? '').trim(),
    PERIODO: String(r.PERIODO ?? '').trim(),
    MODELO_COMISION_PAGADO: String(r.MODELO_COMISION_PAGADO || r.TIPO_ESQUEMA || '').trim(),
  }));
}

export async function fetchPortalDaily(opts?: {
  date?: string;
  includeHistory?: boolean;
}): Promise<{
  availableDates: string[];
  targetDate: string;
  includeHistory: boolean;
  diariosHeaders: string[];
  diarios: DailyRow[];
} | null> {
  const includeHistory = Boolean(opts?.includeHistory);

  if (!activeMcMSessionToken && directAppsScriptToken) {
    const token = directAppsScriptToken;
    const datesRes = await callAppsScriptClient<{ dates?: string[] }>(
      {
        action: 'daily_dates',
        session_token: token,
      },
      25_000
    );
    const availableDates = (datesRes.dates || [])
      .map((d) => dailyDateKey(d) || String(d || '').trim())
      .filter(Boolean)
      .sort();
    if (!availableDates.length) {
      return {
        availableDates: [],
        targetDate: '',
        includeHistory: true,
        diariosHeaders: [],
        diarios: [],
      };
    }
    const reqDate = opts?.date ? dailyDateKey(opts.date) || opts.date : '';
    const targetDate =
      reqDate && availableDates.includes(reqDate)
        ? reqDate
        : availableDates[availableDates.length - 1];

    const dataRes = await callAppsScriptClient<{
      headers?: string[];
      rows?: Record<string, unknown>[];
      history?: Record<string, unknown>[];
    }>(
      {
        action: 'daily_data',
        session_token: token,
        date: targetDate,
        include_history: includeHistory,
      },
      includeHistory ? 60_000 : 35_000
    );
    const map = new Map<string, Record<string, unknown>>();
    const push = (r: Record<string, unknown>) => {
      const k = `${dailyDateKey(r.FECHACORTE)}|${String(r.COD_ASESOR || '').trim() || personKey(r.ASESOR)}`;
      map.set(k, r);
    };
    if (includeHistory) {
      (dataRes.history || []).forEach(push);
    }
    (dataRes.rows || []).forEach(push);
    return {
      availableDates,
      targetDate,
      includeHistory,
      diariosHeaders: dataRes.headers || [],
      diarios: mapDailyClientRows(Array.from(map.values())),
    };
  }

  const headers: Record<string, string> = {};
  if (activeMcMSessionToken) {
    headers['X-McM-Session'] = activeMcMSessionToken;
  }
  const params = new URLSearchParams();
  if (opts?.date) params.set('date', opts.date);
  if (includeHistory) params.set('includeHistory', 'true');
  const qs = params.toString();

  const res = await fetchApiJson<{
    ok: boolean;
    empty?: boolean;
    error?: string;
    availableDates?: string[];
    targetDate?: string;
    includeHistory?: boolean;
    diariosHeaders?: string[];
    diarios?: DailyRow[];
  }>(
    `/api/portal/daily${qs ? `?${qs}` : ''}`,
    { credentials: 'include', headers },
    0,
    includeHistory ? 65_000 : 40_000
  );
  if (!res.ok) {
    throw new Error(res.error || `Error cargando indicadores diarios (${res.status})`);
  }
  if (res.data.empty) return null;
  return {
    availableDates: res.data.availableDates || [],
    targetDate: res.data.targetDate || '',
    includeHistory: Boolean(res.data.includeHistory),
    diariosHeaders: res.data.diariosHeaders || [],
    diarios: res.data.diarios || [],
  };
}

export async function fetchPortalNormalidad(
  role: Role,
  opts?: string | { month?: string; listOnly?: boolean }
): Promise<{
  availableMonths: Array<{ key: string; label: string; rows?: number }>;
  loadedMonth: string;
  normalidadRaw: RawSpreadsheetData['normalidadRaw'];
} | null> {
  const isPrivileged = role === 'admin' || role === 'directivo' || role === 'direccion';
  if (!isPrivileged) {
    return { availableMonths: [], loadedMonth: '', normalidadRaw: [] };
  }

  const month = typeof opts === 'string' ? opts : opts?.month;
  const listOnly = typeof opts === 'object' && Boolean(opts?.listOnly);

  if (!activeMcMSessionToken && directAppsScriptToken) {
    const token = directAppsScriptToken;
    let availableMonths: Array<{ key: string; label: string; rows?: number }> = [];
    let targetMonth = String(month || '').trim();

    if (!targetMonth) {
      const listRes = await callAppsScriptClient<{
        items?: Array<{ key: string; label?: string; rows?: number }>;
        reportes?: Array<{ key: string; label?: string; rows?: number }>;
      }>(
        {
          action: 'report_list',
          report: 'cobranza_mensual',
          session_token: token,
        },
        65_000
      );
      const rawItems = listRes.items || listRes.reportes || [];
      availableMonths = rawItems
        .filter((i) => Boolean(i && i.key))
        .map((i) => ({
          key: String(i.key).trim(),
          label: String(i.label || i.key).trim(),
          rows: i.rows !== undefined ? num(i.rows) : undefined,
        }))
        .sort((a, b) => b.key.localeCompare(a.key));
      if (!availableMonths.length || listOnly) {
        return { availableMonths, loadedMonth: '', normalidadRaw: [] };
      }
      targetMonth = availableMonths[0].key;
    }

    const mr = await callAppsScriptClient<{
      data?: { month?: string; rows?: Array<[string, string, string, number, number, number, number, number]> };
      reporte?: { month?: string; rows?: Array<[string, string, string, number, number, number, number, number]> };
    }>(
      {
        action: 'report_get',
        report: 'cobranza_mensual',
        key: targetMonth,
        session_token: token,
      },
      65_000
    );
    const payload = mr.data || mr.reporte;
    const mKey = payload?.month || targetMonth;
    const normalidadRaw: RawSpreadsheetData['normalidadRaw'] = (payload?.rows || []).map(
      ([region, agency, date, esp, rec, amtE, amtER, amtNE]) => ({
        region: String(region ?? '').trim(),
        agency: String(agency ?? '').trim() || 'SIN AGENCIA',
        ejecutivo: '',
        date: dailyDateKey(date),
        monthKey: mKey,
        esp: num(esp),
        rec: num(rec),
        amtE: num(amtE),
        amtR: num(amtER) + num(amtNE),
        amtER: num(amtER),
        amtNE: num(amtNE),
      })
    );
    return { availableMonths, loadedMonth: mKey, normalidadRaw };
  }

  const headers: Record<string, string> = {};
  if (activeMcMSessionToken) {
    headers['X-McM-Session'] = activeMcMSessionToken;
  }
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  if (listOnly) params.set('listOnly', 'true');
  const qs = params.toString();

  const res = await fetchApiJson<{
    ok: boolean;
    empty?: boolean;
    error?: string;
    availableMonths?: Array<{ key: string; label: string; rows?: number }>;
    loadedMonth?: string;
    normalidadRaw?: RawSpreadsheetData['normalidadRaw'];
  }>(
    `/api/portal/normalidad${qs ? `?${qs}` : ''}`,
    { credentials: 'include', headers },
    0,
    75_000
  );
  if (!res.ok) {
    throw new Error(res.error || `Error cargando reportes mensuales (${res.status})`);
  }
  if (res.data.empty) return null;
  return {
    availableMonths: res.data.availableMonths || [],
    loadedMonth: res.data.loadedMonth || '',
    normalidadRaw: res.data.normalidadRaw || [],
  };
}

export async function fetchPortalAdminExtras(role: Role): Promise<{
  usuarios: UserRecord[];
  backups: BackupInfo[];
} | null> {
  if (role !== 'admin') return null;
  if (!activeMcMSessionToken && directAppsScriptToken) {
    const token = directAppsScriptToken;
    const [usuarios, backups] = await Promise.all([
      callAppsScriptClient<{ users?: Record<string, unknown>[] }>({
        action: 'admin_users',
        session_token: token,
      })
        .then((r) =>
          (r.users || [])
            .map((u) => ({
              username: String(u.username ?? '').trim().toLowerCase(),
              role: normalizeRoleFromScript(u.role),
              nombre: String(u.nombre ?? '').trim().toUpperCase(),
              estado: (String(u.estado ?? 'activo').trim().toLowerCase() === 'inactivo'
                ? 'inactivo'
                : 'activo') as 'activo' | 'inactivo',
            }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        )
        .catch(() => []),
      callAppsScriptClient<{ backups?: Record<string, unknown>[] }>({
        action: 'list_backups',
        session_token: token,
      })
        .then((r) =>
          (r.backups || []).map((b, idx) => ({
            sheetId: idx + 1,
            name: String(b.name ?? '').trim(),
            source: String(b.source ?? 'HOJA').trim(),
            week: (b.week ? Number(b.week) : '') as number | '',
            created: String(b.created ?? '').trim(),
            rows: num(b.rows),
            columns: num(b.cols ?? b.columns),
          }))
        )
        .catch(() => []),
    ]);
    return { usuarios, backups };
  }

  const headers: Record<string, string> = {};
  if (activeMcMSessionToken) {
    headers['X-McM-Session'] = activeMcMSessionToken;
  }
  const res = await fetchApiJson<{
    ok: boolean;
    empty?: boolean;
    usuarios?: UserRecord[];
    backups?: BackupInfo[];
  }>('/api/portal/admin-extras', { credentials: 'include', headers }, 0, 25_000);
  if (!res.ok || res.data.empty) return null;
  return {
    usuarios: res.data.usuarios || [],
    backups: res.data.backups || [],
  };
}

export async function fetchServerHealth(): Promise<ServerHealthStatus> {
  const res = await fetchApiJson<ServerHealthStatus>('/api/health', undefined, 1, 8_000);
  if (!res.ok) {
    return {
      ok: false,
      serviceAccountConfigured: false,
      appsScriptConfigured: true,
      adminBridgeActive: false,
      unattendedReady: true,
      spreadsheetId: DEFAULT_SPREADSHEET_ID,
    };
  }
  return res.data;
}

export async function loginWithCredentials(
  username: string,
  password: string,
  spreadsheetId: string
): Promise<{
  session: {
    username: string;
    role: Role;
    nombre: string;
    mode: 'usuario_interno' | 'google_workspace';
    googleEmail?: string;
  };
  sessionToken: string;
  data: RawSpreadsheetData;
}> {
  const res = await fetchApiJson<{
    ok: boolean;
    error?: string;
    session: {
      username: string;
      role: Role;
      nombre: string;
      mode: 'usuario_interno' | 'google_workspace';
      googleEmail?: string;
    };
    sessionToken: string;
    data: RawSpreadsheetData;
  }>(
    '/api/auth/login',
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, spreadsheetId }),
    },
    0,
    25_000
  );

  if (!res.ok) {
    // If backend endpoint is unreachable / static Shared URL / proxy HTML, fall back directly to Apps Script Web App
    if (res.isHtml || res.status === 404 || res.status === 502 || res.status === 503 || res.status === 0) {
      return appsScriptPortalFallback({ username, password });
    }
    throw new Error(res.error || `Error de acceso (${res.status})`);
  }
  if (!res.data.ok) {
    throw new Error(res.data.error || `Error de acceso (${res.status})`);
  }
  directAppsScriptToken = null;
  setMcMSessionToken(res.data.sessionToken || null);
  return res.data;
}

export async function loginWithGoogleToken(
  googleAccessToken: string,
  spreadsheetId: string
): Promise<{
  session: {
    username: string;
    role: Role;
    nombre: string;
    mode: 'usuario_interno' | 'google_workspace';
    googleEmail?: string;
  };
  sessionToken: string;
  data: RawSpreadsheetData;
}> {
  const res = await fetchApiJson<{
    ok: boolean;
    error?: string;
    session: {
      username: string;
      role: Role;
      nombre: string;
      mode: 'usuario_interno' | 'google_workspace';
      googleEmail?: string;
    };
    sessionToken: string;
    data: RawSpreadsheetData;
  }>('/api/auth/google', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${googleAccessToken}`,
    },
    body: JSON.stringify({ spreadsheetId }),
  });

  if (!res.ok) {
    // If backend endpoint returned HTML / 404 / 502 (e.g. static Shared URL or proxy interception),
    // verify directly with the user's Google OAuth token in-browser so Google login always works.
    if (res.isHtml || res.status === 404 || res.status === 502 || res.status === 0) {
      return directGoogleLoginFallback(googleAccessToken, spreadsheetId);
    }
    throw new Error(res.error || `Error validando cuenta de Google (${res.status})`);
  }
  if (!res.data.ok) {
    throw new Error(res.data.error || `Error validando cuenta de Google (${res.status})`);
  }
  setMcMSessionToken(res.data.sessionToken || null);
  return res.data;
}

export async function fetchScopedPortalData(
  spreadsheetId: string,
  googleAccessToken?: string | null
): Promise<{
  session: {
    username: string;
    role: Role;
    nombre: string;
    mode: 'usuario_interno' | 'google_workspace';
    googleEmail?: string;
  };
  data: RawSpreadsheetData;
}> {
  const headers: Record<string, string> = {};
  if (googleAccessToken && googleAccessToken !== '__SERVER_SESSION__') {
    headers.Authorization = `Bearer ${googleAccessToken}`;
  }
  if (activeMcMSessionToken) {
    headers['X-McM-Session'] = activeMcMSessionToken;
  }

  // If logged in via direct Apps Script fallback (no server session token), reload directly via Apps Script
  if (!activeMcMSessionToken && directAppsScriptToken) {
    return appsScriptPortalFallback({ sessionToken: directAppsScriptToken });
  }

  // If logged in via direct Google fallback (no server session token), reload directly via Google token
  if (
    !activeMcMSessionToken &&
    googleAccessToken &&
    googleAccessToken !== '__SERVER_SESSION__'
  ) {
    return directGoogleLoginFallback(googleAccessToken, spreadsheetId);
  }

  const res = await fetchApiJson<{
    ok: boolean;
    error?: string;
    session: {
      username: string;
      role: Role;
      nombre: string;
      mode: 'usuario_interno' | 'google_workspace';
      googleEmail?: string;
    };
    data: RawSpreadsheetData;
  }>(`/api/portal/data?spreadsheetId=${encodeURIComponent(spreadsheetId)}`, {
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    if (
      (res.isHtml || res.status === 404 || res.status === 502) &&
      directAppsScriptToken
    ) {
      return appsScriptPortalFallback({ sessionToken: directAppsScriptToken });
    }
    if (
      (res.isHtml || res.status === 404 || res.status === 502) &&
      googleAccessToken &&
      googleAccessToken !== '__SERVER_SESSION__'
    ) {
      return directGoogleLoginFallback(googleAccessToken, spreadsheetId);
    }
    if (res.isHtml) {
      throw new WorkspaceAuthError(
        'El servidor respondió con HTML en lugar de JSON al recargar los datos. Recarga la página e intenta nuevamente.',
        res.status || 502
      );
    }
    throw new WorkspaceAuthError(res.error || `Error HTTP ${res.status}`, res.status);
  }
  if (!res.data.ok) {
    throw new WorkspaceAuthError(
      res.data.error || `Error HTTP ${res.status}`,
      res.status
    );
  }
  return res.data;
}

export async function logoutPortalSession(): Promise<void> {
  directAppsScriptToken = null;
  setMcMSessionToken(null);
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore network failure on logout
  }
}

async function googleFetch<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  if (
    accessToken === '__SERVER_SESSION__' &&
    url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (activeMcMSessionToken) {
      headers['X-McM-Session'] = activeMcMSessionToken;
    }
    const res = await fetch('/api/admin/sheets-proxy', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        url,
        method: init.method || 'GET',
        body: init.body,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = `Error HTTP ${res.status}`;
      if (text && !text.trimStart().startsWith('<')) {
        try {
          const errJson = JSON.parse(text);
          msg = errJson?.error?.message || errJson?.error || msg;
        } catch {
          // ignore parse failure
        }
      }
      throw new WorkspaceAuthError(msg, res.status);
    }
    if (text.trimStart().startsWith('<')) {
      throw new WorkspaceAuthError(
        'El proxy de Google Sheets devolvió HTML inesperado. Reconecta tu sesión de Google.',
        502
      );
    }
    return JSON.parse(text) as T;
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Error HTTP ${res.status}`;
    if (text && !text.trimStart().startsWith('<')) {
      try {
        const errJson = JSON.parse(text);
        msg = errJson?.error?.message || msg;
      } catch {
        // ignore parse failure
      }
    }
    throw new WorkspaceAuthError(msg, res.status);
  }
  return JSON.parse(text) as T;
}

export async function listDriveSpreadsheets(
  accessToken: string,
  query = ''
): Promise<DriveSpreadsheet[]> {
  const qParts = [
    "mimeType='application/vnd.google-apps.spreadsheet'",
    'trashed=false',
  ];
  if (query.trim()) {
    const clean = query.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${clean}'`);
  }
  const params = new URLSearchParams({
    q: qParts.join(' and '),
    pageSize: '25',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,modifiedTime,webViewLink)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const data = await googleFetch<{ files?: DriveSpreadsheet[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );
  return data.files || [];
}

interface SpreadsheetMetaResponse {
  spreadsheetId: string;
  properties?: { title?: string };
  sheets?: Array<{
    properties?: {
      sheetId: number;
      title: string;
      hidden?: boolean;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
  }>;
}

type CellVal = string | number | boolean | null | undefined;
type Matrix = CellVal[][];

function canonFieldKey(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .trim();
}

function matrixToObjects(matrix: Matrix): Record<string, CellVal>[] {
  if (!matrix.length) return [];
  const headers = (matrix[0] || []).map((h) => String(h ?? '').trim());
  const normHeaders = headers.map((h) => canonFieldKey(h));
  const out: Record<string, CellVal>[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !row.some((v) => v !== '' && v !== null && v !== undefined)) continue;
    const obj: Record<string, CellVal> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const val = row[idx] ?? '';
      obj[h] = val;
      const nh = normHeaders[idx];
      if (nh && obj[nh] === undefined) {
        obj[nh] = val;
      }
    });
    out.push(obj);
  }
  return out;
}

function normStr(v: unknown): string {
  return String(v ?? '').trim();
}

function canonHeader(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export async function loadPortalData(
  accessToken: string,
  spreadsheetId: string
): Promise<RawSpreadsheetData> {
  const meta = await googleFetch<SpreadsheetMetaResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,properties.title,sheets.properties`,
    accessToken
  );

  const sheetMeta = (meta.sheets || [])
    .map((s) => s.properties)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      sheetId: p.sheetId,
      title: p.title,
      rowCount: p.gridProperties?.rowCount ?? 0,
      columnCount: p.gridProperties?.columnCount ?? 0,
      hidden: Boolean(p.hidden),
    }));

  const existingTitles = new Set(sheetMeta.map((s) => s.title));
  const metasTitle =
    Array.from(existingTitles).find((t) => /^metas?$/i.test(t.trim())) ||
    Array.from(existingTitles).find((t) => /metas/i.test(t)) ||
    'Metas';
  const wantedSheets = Object.values(SHEET_NAMES)
    .map(
      (name) =>
        Array.from(existingTitles).find(
          (t) => t.trim().toUpperCase() === name.trim().toUpperCase()
        ) || name
    )
    .filter((name) => existingTitles.has(name));
  if (existingTitles.has(metasTitle) && !wantedSheets.includes(metasTitle)) {
    wantedSheets.push(metasTitle);
  }

  const matrices = new Map<string, Matrix>();
  if (wantedSheets.length) {
    const rangesParams = wantedSheets
      .map((s) => `ranges=${encodeURIComponent(`'${s.replace(/'/g, "''")}'`)}`)
      .join('&');
    const batch = await googleFetch<{
      valueRanges?: Array<{ range?: string; values?: Matrix }>;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values:batchGet?${rangesParams}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
      accessToken
    );

    (batch.valueRanges || []).forEach((vr, idx) => {
      const sheetTitle = wantedSheets[idx];
      if (sheetTitle) {
        matrices.set(sheetTitle, vr.values || []);
      }
    });
  }

  // 1. CORTES
  const cortes: CorteRow[] = matrixToObjects(matrices.get(SHEET_NAMES.CORTES) || [])
    .map((r) => ({
      MES: nullableNum(r.MES ?? r.mes),
      SEMANA: num(r.SEMANA ?? r.semana),
      CORTE: num(r.CORTE ?? r.corte),
      PERIODO: normStr(r.PERIODO ?? r.periodo),
    }))
    .filter((r) => r.CORTE > 0)
    .sort((a, b) => a.CORTE - b.CORTE);

  // 2. INDICADORES
  const indicadores: IndicadorRow[] = matrixToObjects(
    matrices.get(SHEET_NAMES.INDICADORES) || []
  ).map((r) => {
    const montoNuevos = num(r.monto_nuevos);
    const montoRenov = num(r.monto_renovaciones);
    return {
      corte: num(r.corte),
      ejecutivo: normStr(r.ejecutivo),
      region: normStr(r.region),
      agencia: normStr(r.agencia),
      estatus: normStr(r.estatus),
      coordinador: normStr(r.coordinador) || '-',
      sin_roster: r.sin_roster as boolean | string,
      num_creditos: num(r.num_creditos),
      pagos_esperados: num(r.pagos_esperados),
      pagos_recibidos: num(r.pagos_recibidos),
      monto_esperado: num(r.monto_esperado),
      monto_recibido: num(r.monto_recibido),
      monto_recibido_esperado: num(r.monto_recibido_esperado),
      monto_recibido_no_esperado: num(r.monto_recibido_no_esperado),
      mora_capital: num(r.mora_capital),
      mora_total: num(r.mora_total),
      dias_mora_prom: num(r.dias_mora_prom),
      clientes_vigentes: num(r.clientes_vigentes),
      saldo_capital: num(r.saldo_capital),
      saldo_total: num(r.saldo_total),
      desembolso: num(r.desembolso),
      colocacion_semanal: num(r.colocacion_semanal),
      monto_colocacion_semanal: num(r.monto_colocacion_semanal),
      clientes_nuevos: num(r.clientes_nuevos),
      renovaciones: num(r.renovaciones),
      pct_normalidad: nullableNum(r.pct_normalidad),
      pct_mora: num(r.pct_mora),
      monto_nuevos: montoNuevos,
      monto_renovaciones: montoRenov,
      monto_nuevos_dashboard: montoNuevos,
      monto_renovaciones_dashboard: montoRenov,
      renov_tiempo: num(r.renov_tiempo),
      renov_tardia: num(r.renov_tardia),
      productivo: num(r.productivo),
      pagare: num(r.pagare),
      comision_cartera_heredada: num(r.comision_cartera_heredada),
      apoyo_familiar: num(r.apoyo_familiar),
    };
  });

  // 3. EJECUTIVO COMISIONES
  const ejecutivoCom: ComisionEjecutivoRow[] = matrixToObjects(
    matrices.get(SHEET_NAMES.EJECUTIVO) || []
  ).map((r) => ({
    mes: num(r.mes),
    semana: num(r.semana),
    corte: num(r.corte),
    periodo: normStr(r.periodo),
    region: normStr(r.region),
    agencia: normStr(r.agencia),
    ejecutivo: normStr(r.ejecutivo),
    estatus: normStr(r.estatus),
    puesto: normStr(r.puesto),
    coordinador: normStr(r.coordinador) || '-',
    tipo_esquema: normStr(r.tipo_esquema),
    pagos_esperados: num(r.pagos_esperados),
    pagos_recibidos: num(r.pagos_recibidos),
    pct_normalidad: nullableNum(r.pct_normalidad),
    monto_esperado: num(r.monto_esperado),
    monto_recibido: num(r.monto_recibido),
    monto_recibido_no_esperado: num(r.monto_recibido_no_esperado),
    cobranza_total: num(r.cobranza_total),
    comision_cobranza: num(r.comision_cobranza),
    bono_excelencia: num(r.bono_excelencia),
    cobranza_credito_adicional: num(r.cobranza_credito_adicional),
    comision_cobranza_adicional: num(r.comision_cobranza_adicional),
    comision_cartera_heredada: num(r.comision_cartera_heredada),
    recuperacion_cartera_heredada: num(r.recuperacion_cartera_heredada),
    clientes_nuevos: num(r.clientes_nuevos),
    clientes_en_tiempo: num(r.clientes_en_tiempo),
    clientes_tardias: num(r.clientes_tardias),
    total_clientes: num(r.total_clientes),
    monto_nuevos: num(r.monto_nuevos),
    monto_en_tiempo: num(r.monto_en_tiempo),
    monto_tardias: num(r.monto_tardias),
    monto_renovaciones: num(r.monto_renovaciones),
    total_colocado: num(r.total_colocado),
    comision_colocacion_total: num(r.comision_colocacion_total),
    comision_apoyo_familiar: num(r.comision_apoyo_familiar),
    comision_modelo_tradicional: num(r.comision_modelo_tradicional),
    comision_modelo_ej_nuevo: num(r.comision_modelo_ej_nuevo),
    apoyo_economico: num(r.apoyo_economico),
    bono_mensual: num(r.bono_mensual),
    campanas: num(r.campanas),
    bono_crecimiento_neto: num(r.bono_crecimiento_neto),
    convenio: num(r.convenio),
    incapacidad: num(r.incapacidad),
    multas: num(r.multas),
    penalizacion_traspaso: num(r.penalizacion_traspaso),
    penalizacion_decremento: num(r.penalizacion_decremento),
    prestamo_capital_humano: num(r.prestamo_capital_humano),
    prestamo_caja_ahorro: num(r.prestamo_caja_ahorro),
    descuentos_prestamos: num(r.descuentos_prestamos),
    comision_final: num(r.comision_final),
    retencion_caja_ahorro: num(r.retencion_caja_ahorro),
    retroactivos_otros_apoyos: num(r.retroactivos_otros_apoyos),
    total_a_cobrar: num(r.total_a_cobrar),
    comision_mayor:
      r.comision_mayor !== undefined && r.comision_mayor !== ''
        ? num(r.comision_mayor)
        : undefined,
    productivo:
      r.productivo !== undefined && r.productivo !== ''
        ? num(r.productivo)
        : undefined,
  }));

  const semanaToCorte = new Map<number, number>();
  cortes.forEach((c) => {
    if (c.SEMANA > 0 && c.CORTE > 0) {
      semanaToCorte.set(c.SEMANA, c.CORTE);
    }
  });

  // 4. DIRECTORIO (COORDINADOR, GERENTE, GERENTE_REGIONAL)
  const parseDir = (
    sheetName: string,
    rolPersona: DirectorioRow['rol_persona']
  ): DirectorioRow[] =>
    matrixToObjects(matrices.get(sheetName) || []).map((r) => {
      const semana = num(r.semana);
      const rawCorte = num(r.corte);
      const resolvedCorte = rawCorte > 0 ? rawCorte : semanaToCorte.get(semana) || 0;
      const empleado = normStr(
        r.empleado ||
          r.regional ||
          r.gerente ||
          r.coordinador ||
          r.ejecutivo ||
          r.nombre
      );
      return {
        mes: num(r.mes),
        semana,
        corte: resolvedCorte,
        periodo: normStr(r.periodo),
        region: normStr(r.region),
        agencia: normStr(r.agencia || r.sucursal),
        empleado,
        estatus: normStr(r.estatus),
        puesto: normStr(r.puesto),
        rol_persona: rolPersona,
        pagos_esperados: num(r.pagos_esperados),
        pagos_recibidos: num(r.pagos_recibidos),
        pct_normalidad: nullableNum(r.pct_normalidad),
        comision_cobranza: num(r.comision_cobranza),
        num_ejecutivos: num(r.num_ejecutivos),
        ejecutivos_productivos: num(r.ejecutivos_productivos),
        pct_productividad_equipo: num(r.pct_productividad_equipo),
        pct_comision_productividad: num(r.pct_comision_productividad),
        comision_productividad: num(r.comision_productividad),
        apoyo_familiar: num(r.apoyo_familiar),
        comision_modelo_tradicional: num(r.comision_modelo_tradicional),
        apoyo_economico: num(r.apoyo_economico),
        bono_mensual: num(r.bono_mensual),
        comision_mayor: num(r.comision_mayor),
        multas: num(r.multas),
        prestamo_capital_humano: num(r.prestamo_capital_humano),
        prestamo_caja_ahorro: num(r.prestamo_caja_ahorro),
        descuentos_prestamos: num(r.descuentos_prestamos),
        incentivo_final: num(r.incentivo_final),
        retencion_caja_ahorro: num(r.retencion_caja_ahorro),
        retroactivos_otros_apoyos: num(r.retroactivos_otros_apoyos),
        total_a_cobrar: num(r.total_a_cobrar),
      };
    });

  const coordinadorCom = parseDir(SHEET_NAMES.COORDINADOR, 'coordinador');
  const gerenteCom = parseDir(SHEET_NAMES.GERENTE, 'gerente');
  const regionalCom = parseDir(SHEET_NAMES.REGIONAL, 'regional');

  // 5. USUARIOS & SCOPES
  const normalizeRoleVal = (rawRole: unknown): Role => {
    const k = canonHeader(rawRole).toLowerCase().replace(/\s+/g, '_');
    if (k === 'administrador' || k === 'admin' || k.includes('admin')) return 'admin';
    if (k.includes('directiv') || k.includes('director')) return 'directivo';
    if (k.includes('direccion')) return 'direccion';
    if (k === 'gerente_regional' || k.includes('regional')) return 'regional';
    if (k.includes('gerente')) return 'gerente';
    if (k.includes('coordinador')) return 'coordinador';
    return 'ejecutivo';
  };
  const uMat = matrices.get(SHEET_NAMES.USUARIOS) || [];
  const uHdr = (uMat[0] || []).map((h) => canonHeader(h));
  const findUCol = (aliases: string[], fb: number) => {
    const i = uHdr.findIndex((h) => aliases.includes(h));
    return i >= 0 ? i : fb;
  };
  const uIdx = findUCol(['USERNAME', 'USUARIO', 'USER'], 0);
  const pIdx = findUCol(['PASSWORD', 'CONTRASENA', 'CLAVE', 'PASS'], 1);
  const rIdx = findUCol(['ROLE', 'ROL', 'PERFIL'], 2);
  const nIdx = findUCol(['NOMBRE', 'NAME'], 3);
  const eIdx = uHdr.findIndex((h) => ['ESTADO', 'ESTATUS', 'STATUS'].includes(h));

  const usuarios: UserRecord[] = uMat
    .slice(1)
    .filter((r) => r && normStr(r[uIdx]) !== '')
    .map((r) => ({
      username: normStr(r[uIdx]).toLowerCase(),
      password: String(r[pIdx] ?? ''),
      role: normalizeRoleVal(r[rIdx]),
      nombre: normStr(r[nIdx]).toUpperCase(),
      estado: (eIdx >= 0 && normStr(r[eIdx] || 'activo').toLowerCase() === 'inactivo'
        ? 'inactivo'
        : 'activo') as UserRecord['estado'],
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const parseScope = (sheetName: string, keyField: string): ScopeEntry[] =>
    matrixToObjects(matrices.get(sheetName) || [])
      .map((r) => ({
        persona: normStr(
          r[keyField] || r.empleado || r.persona || r.nombre
        ).toUpperCase(),
        region: normStr(r.region).toUpperCase(),
        agencia: normStr(r.agencia || r.sucursal).toUpperCase(),
      }))
      .filter((s) => s.persona !== '');

  const scopeEjecutivo = parseScope(SHEET_NAMES.SCOPE_EJECUTIVO, 'ejecutivo');
  const scopeCoordinador = parseScope(SHEET_NAMES.SCOPE_COORDINADOR, 'coordinador');
  const scopeGerente = parseScope(SHEET_NAMES.SCOPE_GERENTE, 'gerente');
  const scopeRegional = parseScope(SHEET_NAMES.SCOPE_REGIONAL, 'regional');

  // 6. INDICADORES_DIARIOS
  const diariosMatrix = matrices.get(SHEET_NAMES.DIARIOS) || [];
  const diariosHeaders = (diariosMatrix[0] || []).map((h) => String(h ?? '').trim());
  const diarios: DailyRow[] = matrixToObjects(diariosMatrix).map((r) => ({
    ...(r as Record<string, string | number | boolean | null | undefined>),
    FECHACORTE: dailyDateKey(r.FECHACORTE),
    COD_ASESOR: normStr(r.COD_ASESOR),
    ASESOR: normStr(r.ASESOR),
    COD_REGIONAL: normStr(r.COD_REGIONAL),
    REGIONAL: normStr(r.REGIONAL),
    COD_SUCURSAL: normStr(r.COD_SUCURSAL),
    SUCURSAL: normStr(r.SUCURSAL),
    COORDINADOR: normStr(r.COORDINADOR),
    ESTATUS: normStr(r.ESTATUS),
    ID_PERIODO: normStr(r.ID_PERIODO),
    PERIODO: normStr(r.PERIODO),
    MODELO_COMISION_PAGADO: normStr(r.MODELO_COMISION_PAGADO || r.TIPO_ESQUEMA),
  }));

  // 7. NORMALIDAD
  const nrmMatrix = matrices.get(SHEET_NAMES.NORMALIDAD) || [];
  let normalidadRaw: NormalidadRawRow[] = [];
  let normalidadMeta: RawSpreadsheetData['normalidadMeta'] = null;

  if (nrmMatrix.length > 1) {
    let hdr = -1;
    let col: Record<string, number> = {};
    for (let i = 0; i < Math.min(nrmMatrix.length, 30); i++) {
      const m: Record<string, number> = {};
      (nrmMatrix[i] || []).forEach((h, j) => {
        const c = canonHeader(h);
        if (c && m[c] === undefined) m[c] = j;
      });
      if (m['REGION'] !== undefined && m['AGENCIA'] !== undefined && m['EJECUTIVO'] !== undefined) {
        hdr = i;
        col = m;
        break;
      }
    }
    if (hdr >= 0 && col['ESPERADO'] !== undefined && col['RECIBIDO'] !== undefined) {
      const cands: Array<{ header: string; c: string; j: number; set: Set<string>; valid: number; total: number }> = [];
      (nrmMatrix[hdr] || []).forEach((h, j) => {
        const c = canonHeader(h);
        if (c && /CORTE|SEMAN|\bSEM\b|FECHA|\bMES\b|MENSUAL/.test(c)) {
          cands.push({ header: String(h ?? '').trim(), c, j, set: new Set(), valid: 0, total: 0 });
        }
      });
      for (let i = hdr + 1; i < nrmMatrix.length; i++) {
        const r = nrmMatrix[i];
        const reg = r?.[col['REGION']];
        const ej = r?.[col['EJECUTIVO']];
        if (typeof reg !== 'string' || !reg.trim() || typeof ej !== 'string' || !ej.trim()) continue;
        cands.forEach((cd) => {
          const v = r[cd.j];
          if (v === '' || v == null) return;
          cd.total++;
          const d = dailyDateKey(v);
          if (d) {
            cd.valid++;
            cd.set.add(d);
          }
        });
      }
      const dateCols = cands.filter((cd) => cd.valid > 0 && cd.valid >= 0.8 * cd.total);
      let weekly =
        dateCols
          .filter((cd) => /SEMAN|\bSEM\b/.test(cd.c))
          .sort((a, b) => b.set.size - a.set.size)[0] || null;
      if (!weekly && dateCols.length) {
        const blank = cands.find((cd) => cd.total === 0 && /SEMAN|\bSEM\b/.test(cd.c));
        if (blank) weekly = blank;
      }
      if (!weekly) {
        for (const cd of dateCols) {
          if (
            !weekly ||
            cd.set.size > weekly.set.size ||
            (cd.set.size === weekly.set.size && cd.c === 'CORTE')
          ) {
            weekly = cd;
          }
        }
      }
      const monthly =
        dateCols.find((cd) => cd !== weekly && /\bMES\b|MENSUAL/.test(cd.c)) ||
        dateCols.find((cd) => cd !== weekly && cd.c === 'CORTE') ||
        null;

      if (weekly) {
        col['WEEK'] = weekly.j;
        if (monthly) col['MONTH'] = monthly.j;
        normalidadMeta = {
          headerRow: hdr,
          headers: (nrmMatrix[hdr] || []).map((h) => String(h ?? '').trim()),
          weeklyHeader: weekly.header,
          monthlyHeader: monthly ? monthly.header : '',
          rawMatrix: nrmMatrix as (string | number | boolean | null)[][],
          colMap: col,
        };

        for (let i = hdr + 1; i < nrmMatrix.length; i++) {
          const r = nrmMatrix[i];
          if (!r) continue;
          const reg = r[col['REGION']];
          const ej = r[col['EJECUTIVO']];
          if (typeof reg !== 'string' || !reg.trim() || typeof ej !== 'string' || !ej.trim()) continue;
          const cutDate = monthly ? dailyDateKey(r[monthly.j]) : '';
          let weekDate = dailyDateKey(r[weekly.j]);
          if (!weekDate) weekDate = cutDate;
          if (!weekDate) continue;
          const monthKey = cutDate ? cutDate.slice(0, 7) : nrmMonthKeyFromCut(weekDate);
          const amtER = num(r[col['$ ESPERADA RECIBIDA']]);
          const amtNE = num(r[col['$ RECIBIDA NO ESPERADA']]);
          normalidadRaw.push({
            region: reg.trim(),
            agency: String(r[col['AGENCIA']] ?? '').trim() || 'SIN AGENCIA',
            ejecutivo: ej.trim(),
            date: weekDate,
            cutDate,
            monthKey,
            esp: num(r[col['ESPERADO']]),
            rec: num(r[col['RECIBIDO']]),
            amtE: num(r[col['$ ESPERADA']]),
            amtR:
              col['$ RECIBIDA'] !== undefined
                ? num(r[col['$ RECIBIDA']])
                : amtER + amtNE,
            amtER,
            amtNE,
          });
        }
      }
    }
  }

  // 8. BACKUPS
  const backups: BackupInfo[] = sheetMeta
    .map((s) => parseBackupInfo(s.sheetId, s.title, s.rowCount, s.columnCount))
    .filter((b): b is BackupInfo => Boolean(b))
    .sort((a, b) => {
      const wa = Number(a.week) || 0;
      const wb = Number(b.week) || 0;
      if (wb !== wa) return wb - wa;
      return b.name.localeCompare(a.name);
    });

  // 9. LOGS
  const logs: LogEntry[] = matrixToObjects(matrices.get(SHEET_NAMES.LOG) || [])
    .map((r) => ({
      fecha_hora:
        typeof r.fecha_hora === 'number'
          ? serialToDate(r.fecha_hora).toISOString().replace('T', ' ').slice(0, 19)
          : normStr(r.fecha_hora),
      usuario: normStr(r.usuario),
      accion: normStr(r.accion),
      semana: normStr(r.semana),
      corte: normStr(r.corte),
      periodo: normStr(r.periodo),
      archivo: normStr(r.archivo),
      registros_antes: num(r.registros_antes),
      registros_nuevos: num(r.registros_nuevos),
      resultado: normStr(r.resultado),
      detalle: normStr(r.detalle),
      id_operacion: normStr(r.id_operacion),
    }))
    .reverse()
    .slice(0, 120);

  const foundMetasKey =
    Array.from(matrices.keys()).find((k) => /^metas?$/i.test(k.trim())) ||
    Array.from(matrices.keys()).find((k) => /metas/i.test(k)) ||
    metasTitle;
  const metasMatrix = matrices.get(foundMetasKey) || [];
  const parseMetaNum = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v == null || v === '') return 0;
    const str = String(v)
      .trim()
      .replace(/[$MXN\s]/gi, '')
      .replace(/,/g, '');
    const n = Number(str);
    return Number.isFinite(n) ? n : 0;
  };

  let metasHeaderIdx = -1;
  let colA = 0;
  let colRegion = -1;
  let colSucursal = -1;
  let colD = 3;
  const colH = 7;
  const colI = 8;
  const colJ = 9;

  for (let i = 0; i < Math.min(metasMatrix.length, 10); i++) {
    const row = metasMatrix[i] || [];
    const canonCells = row.map((c) => canonHeader(c));
    const hasKnownHeader = canonCells.some((h) =>
      [
        'ASESOR',
        'EJECUTIVO',
        'PROMOTOR',
        'EMPLEADO',
        'FECHA',
        'CORTE',
        'FECHA CORTE',
        'REGIONAL',
        'REGION',
        'SUCURSAL',
        'AGENCIA',
      ].includes(h)
    );
    if (hasKnownHeader) {
      metasHeaderIdx = i;
      let exactAsesorCol = -1;
      let fallbackNombreCol = -1;
      canonCells.forEach((h, idx) => {
        if (h === 'FECHA' || h === 'CORTE' || h === 'FECHA CORTE' || h === 'MES' || h === 'PERIODO') {
          colA = idx;
        } else if (h === 'REGION' || h === 'REGIONAL') {
          colRegion = idx;
        } else if (h === 'SUCURSAL' || h === 'AGENCIA' || h === 'PLAZA') {
          colSucursal = idx;
        } else if (h === 'ASESOR' || h === 'EJECUTIVO' || h === 'PROMOTOR') {
          if (exactAsesorCol < 0 || idx === 3) exactAsesorCol = idx;
        } else if (h === 'EMPLEADO' || h === 'NOMBRE') {
          if (fallbackNombreCol < 0 || idx === 3) fallbackNombreCol = idx;
        }
      });
      if (exactAsesorCol >= 0) colD = exactAsesorCol;
      else if (fallbackNombreCol >= 0) colD = fallbackNombreCol;
      break;
    }
  }

  const sortedWords = (v: unknown) =>
    normText(v)
      .replace(/[^A-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join('|');

  // Enrich missing region / sucursal from INDICADORES, EJECUTIVO, and DIARIOS
  const execTerritoryByPk = new Map<string, { region: string; agencia: string }>();
  const execTerritoryByWords = new Map<string, { region: string; agencia: string }>();
  const knownRegions = new Set<string>();
  const knownAgencias = new Set<string>();

  const registerExecTerr = (name: string, reg: string, ag: string) => {
    const r = normStr(reg);
    const a = normStr(ag);
    if (r) knownRegions.add(normText(r));
    if (a) knownAgencias.add(normText(a));
    const k = personKey(name);
    const wk = sortedWords(name);
    if (k && (r || a)) execTerritoryByPk.set(k, { region: r, agencia: a });
    if (wk && (r || a)) execTerritoryByWords.set(wk, { region: r, agencia: a });
  };

  diarios.forEach((r) =>
    registerExecTerr(String(r.ASESOR || ''), String(r.REGIONAL || ''), String(r.SUCURSAL || ''))
  );
  ejecutivoCom.forEach((r) => registerExecTerr(r.ejecutivo, r.region, r.agencia));
  indicadores.forEach((r) => registerExecTerr(r.ejecutivo, r.region, r.agencia));

  const metasStartIdx = metasHeaderIdx >= 0 ? metasHeaderIdx + 1 : 1;
  let lastMetaFecha = '';
  const metas = metasMatrix
    .slice(metasStartIdx)
    .map((r) => {
      const rawFecha = r[colA];
      let fecha = dailyDateKey(rawFecha) || String(rawFecha ?? '').trim();
      const asesor = normStr(r[colD]);
      if (fecha) {
        lastMetaFecha = fecha;
      } else if (asesor && lastMetaFecha) {
        fecha = lastMetaFecha;
      }
      const terr =
        execTerritoryByPk.get(personKey(asesor)) ||
        execTerritoryByWords.get(sortedWords(asesor));
      const rawReg = colRegion >= 0 ? normStr(r[colRegion]) : '';
      const rawAg = colSucursal >= 0 ? normStr(r[colSucursal]) : '';
      const region =
        (rawReg && (knownRegions.size === 0 || knownRegions.has(normText(rawReg))) ? rawReg : '') ||
        terr?.region ||
        rawReg;
      const agencia =
        (rawAg && (knownAgencias.size === 0 || knownAgencias.has(normText(rawAg))) ? rawAg : '') ||
        terr?.agencia ||
        rawAg;
      const metaH = parseMetaNum(r[colH]);
      const metaI = parseMetaNum(r[colI]);
      const metaJ = parseMetaNum(r[colJ]);
      const metaSumHI = metaH + metaI;
      return {
        fecha,
        region: region || undefined,
        agencia: agencia || undefined,
        asesor,
        metaH,
        metaI,
        metaJ,
        metaTotal: metaSumHI > 0 ? metaSumHI : metaJ,
      };
    })
    .filter((m) => {
      const uAsesor = m.asesor.toUpperCase();
      const uFecha = m.fecha.toUpperCase();
      const uReg = (m.region || '').toUpperCase();
      const uAg = (m.agencia || '').toUpperCase();
      if (
        ['ASESOR', 'EJECUTIVO', 'PROMOTOR', 'EMPLEADO'].includes(uAsesor) ||
        ['FECHA', 'MES', 'PERIODO', 'CORTE'].includes(uFecha) ||
        /^TOTAL\b/.test(uAsesor) ||
        /^TOTAL\b/.test(uFecha) ||
        /^TOTAL\b/.test(uReg) ||
        /^TOTAL\b/.test(uAg) ||
        uAsesor === 'SUBTOTAL' ||
        uAsesor === 'GRAN TOTAL' ||
        uAsesor === 'PROMEDIO'
      ) {
        return false;
      }
      return m.metaTotal > 0 || m.asesor !== '';
    });

  return {
    spreadsheetId,
    spreadsheetTitle: meta.properties?.title || 'McM_Datos_DashBoard',
    sheetMeta,
    cortes,
    indicadores,
    ejecutivoCom,
    coordinadorCom,
    gerenteCom,
    regionalCom,
    usuarios,
    scopeEjecutivo,
    scopeCoordinador,
    scopeGerente,
    scopeRegional,
    diariosHeaders,
    diarios,
    normalidadRaw,
    normalidadMeta,
    backups,
    logs,
    metas,
  };
}

/* ==================== WRITE / MUTATION HELPERS ==================== */

async function readRawSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<Matrix> {
  const safeName = `'${sheetName.replace(/'/g, "''")}'`;
  const res = await googleFetch<{ values?: Matrix }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(
      safeName
    )}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    accessToken
  );
  return res.values || [];
}

async function rewriteSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  rows: CellVal[][]
): Promise<void> {
  const safeName = `'${sheetName.replace(/'/g, "''")}'`;
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(safeName)}:clear`,
    accessToken,
    { method: 'POST', body: '{}' }
  );
  const values = [headers, ...rows];
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(`${safeName}!A1`)}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }
  );
}

async function appendSheetRows(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  rows: CellVal[][]
): Promise<void> {
  if (!rows.length) return;
  const safeName = `'${sheetName.replace(/'/g, "''")}'`;
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(
      `${safeName}!A1`
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    }
  );
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function createBackupSheet(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  source: string,
  week: number | string,
  headers: string[],
  rows: CellVal[][]
): Promise<string> {
  if (!rows.length) return '';
  let name = `BK_ADMIN_${source}_${week ? `S${week}_` : ''}${nowStamp()}`.slice(0, 95);
  while (existingTitles.has(name)) {
    name = `${name.slice(0, 88)}_${Math.floor(Math.random() * 9999)}`;
  }
  existingTitles.add(name);

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: name,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      }),
    }
  );

  await rewriteSheet(accessToken, spreadsheetId, name, headers, rows);
  return name;
}

async function ensureSheetExists(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  sheetName: string,
  headers: string[]
): Promise<void> {
  if (existingTitles.has(sheetName)) return;
  existingTitles.add(sheetName);
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      }),
    }
  );
  await rewriteSheet(accessToken, spreadsheetId, sheetName, headers, []);
}

async function appendLogOperation(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  entry: Partial<LogEntry>
): Promise<void> {
  await ensureSheetExists(accessToken, spreadsheetId, existingTitles, SHEET_NAMES.LOG, [
    'fecha_hora',
    'usuario',
    'accion',
    'semana',
    'corte',
    'periodo',
    'archivo',
    'registros_antes',
    'registros_nuevos',
    'resultado',
    'detalle',
    'id_operacion',
  ]);
  await appendSheetRows(accessToken, spreadsheetId, SHEET_NAMES.LOG, [
    [
      new Date().toISOString().replace('T', ' ').slice(0, 19),
      entry.usuario || 'admin',
      entry.accion || '',
      entry.semana || '',
      entry.corte || '',
      entry.periodo || '',
      entry.archivo || '',
      entry.registros_antes ?? 0,
      entry.registros_nuevos ?? 0,
      entry.resultado || 'OK',
      entry.detalle || '',
      entry.id_operacion || crypto.randomUUID(),
    ],
  ]);
}

function sameNum(a: unknown, b: number): boolean {
  const na = Number(a);
  return Number.isFinite(na) && Math.abs(na - b) < 0.0001;
}

async function syncScopesAdditive(
  accessToken: string,
  spreadsheetId: string,
  role: 'ejecutivo' | 'coordinador' | 'gerente' | 'regional',
  candidates: Array<{ nombre: string; region: string; agencia: string }>
): Promise<number> {
  const sheetMap = {
    ejecutivo: SHEET_NAMES.SCOPE_EJECUTIVO,
    coordinador: SHEET_NAMES.SCOPE_COORDINADOR,
    gerente: SHEET_NAMES.SCOPE_GERENTE,
    regional: SHEET_NAMES.SCOPE_REGIONAL,
  };
  const sheetName = sheetMap[role];
  const matrix = await readRawSheet(accessToken, spreadsheetId, sheetName);
  if (!matrix.length) return 0;
  const headers = (matrix[0] || []).map((h) => String(h ?? '').trim());
  const ni = headers.findIndex((h) => h.toLowerCase() === role);
  const ri = headers.findIndex((h) => h.toLowerCase() === 'region');
  const ai = role === 'regional' ? -1 : headers.findIndex((h) => h.toLowerCase() === 'agencia');
  if (ni < 0 || ri < 0 || (role !== 'regional' && ai < 0)) return 0;

  const keyOf = (n: string, r: string, a: string) =>
    `${n.trim().toUpperCase()}|${r.trim().toUpperCase()}|${ai < 0 ? '' : a.trim().toUpperCase()}`;

  const existing = new Set<string>();
  for (const r of matrix.slice(1)) {
    const nm = String(r[ni] ?? '').trim();
    if (!nm) continue;
    existing.add(keyOf(nm, String(r[ri] ?? ''), ai < 0 ? '' : String(r[ai] ?? '')));
  }

  const toAppend: CellVal[][] = [];
  for (const c of candidates) {
    const nm = c.nombre.trim().toUpperCase();
    if (!nm || nm === '-') continue;
    const reg = c.region.trim().toUpperCase();
    const ag = ai < 0 ? '' : c.agencia.trim().toUpperCase();
    const k = keyOf(nm, reg, ag);
    if (existing.has(k)) continue;
    existing.add(k);
    const row: CellVal[] = headers.map(() => '');
    row[ni] = nm;
    row[ri] = reg;
    if (ai >= 0) row[ai] = ag;
    toAppend.push(row);
  }
  if (toAppend.length) {
    await appendSheetRows(accessToken, spreadsheetId, sheetName, toAppend);
  }
  return toAppend.length;
}

export async function publishWeekToSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  parsed: ParsedWeeklyWorkbook,
  scope: 'indicadores' | 'completo',
  mode: 'add' | 'replace',
  actor: string
): Promise<{ corte: number; periodo: string; detalles: Record<string, number> }> {
  const week = parsed.week;
  // Resolve or create CORTE in CORTES sheet
  const cortesMatrix = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.CORTES);
  if (!cortesMatrix.length) throw new Error('La hoja CORTES no tiene encabezados.');
  const ch = (cortesMatrix[0] || []).map((x) => String(x ?? '').trim());
  const iM = ch.findIndex((x) => x.toUpperCase() === 'MES');
  const iW = ch.findIndex((x) => x.toUpperCase() === 'SEMANA');
  const iC = ch.findIndex((x) => x.toUpperCase() === 'CORTE');
  const iP = ch.findIndex((x) => x.toUpperCase() === 'PERIODO');

  const foundCortes = cortesMatrix.slice(1).filter((r) => sameNum(r[iW], week));
  let corte = 0;
  let periodo = '';
  let mesSerial: number | null = null;

  if (foundCortes.length) {
    corte = num(foundCortes[foundCortes.length - 1][iC]);
    periodo = String(foundCortes[foundCortes.length - 1][iP] ?? '');
    mesSerial = iM >= 0 ? nullableNum(foundCortes[foundCortes.length - 1][iM]) : null;
  } else {
    const prior = cortesMatrix
      .slice(1)
      .map((r) => ({ week: num(r[iW]), corte: num(r[iC]) }))
      .filter((x) => x.week > 0 && x.corte > 0 && x.week < week)
      .sort((a, b) => a.week - b.week);
    if (!prior.length) {
      throw new Error(`No existe una semana previa en CORTES para calcular Semana ${week}.`);
    }
    const p = prior[prior.length - 1];
    corte = p.corte + 7 * (week - p.week);
    const friday = serialToDate(corte);
    const mesDate = lastDayOfMonth(friday);
    mesSerial = dateToSerial(mesDate);
    periodo = formatPeriodo(friday);

    const newRow: CellVal[] = ch.map(() => '');
    if (iM >= 0) newRow[iM] = mesSerial;
    if (iW >= 0) newRow[iW] = week;
    if (iC >= 0) newRow[iC] = corte;
    if (iP >= 0) newRow[iP] = periodo;
    await appendSheetRows(accessToken, spreadsheetId, SHEET_NAMES.CORTES, [newRow]);
  }

  const targets: Array<{
    key: string;
    sheet: string;
    by: 'corte' | 'semana';
    rows: Record<string, unknown>[];
  }> = [
    {
      key: 'indicadores',
      sheet: SHEET_NAMES.INDICADORES,
      by: 'corte',
      rows: parsed.indicadoresRows as unknown as Record<string, unknown>[],
    },
  ];
  if (scope === 'completo') {
    targets.push(
      { key: 'ejecutivo', sheet: SHEET_NAMES.EJECUTIVO, by: 'semana', rows: parsed.ejecutivoRows },
      {
        key: 'coordinador',
        sheet: SHEET_NAMES.COORDINADOR,
        by: 'semana',
        rows: parsed.coordinadorRows,
      },
      { key: 'gerente', sheet: SHEET_NAMES.GERENTE, by: 'semana', rows: parsed.gerenteRows },
      { key: 'regional', sheet: SHEET_NAMES.REGIONAL, by: 'semana', rows: parsed.regionalRows }
    );
  }

  const snapshots: Array<{
    t: (typeof targets)[0];
    headers: string[];
    oldRows: CellVal[][];
    keep: CellVal[][];
  }> = [];

  for (const t of targets) {
    if (!existingTitles.has(t.sheet)) continue;
    const matrix = await readRawSheet(accessToken, spreadsheetId, t.sheet);
    if (!matrix.length) throw new Error(`La hoja ${t.sheet} no tiene encabezados.`);
    const headers = (matrix[0] || []).map((h) => String(h ?? '').trim());
    const colIx = headers.findIndex((h) => h.toLowerCase() === t.by);
    if (colIx < 0) throw new Error(`Falta columna ${t.by} en ${t.sheet}.`);
    const targetVal = t.by === 'corte' ? corte : week;
    const oldRows = matrix.slice(1).filter((r) => sameNum(r[colIx], targetVal));
    const keep = matrix.slice(1).filter((r) => !sameNum(r[colIx], targetVal));
    snapshots.push({ t, headers, oldRows, keep });
  }

  const anyExisting = snapshots.some((s) => s.oldRows.length > 0);
  if (mode === 'add' && anyExisting) {
    throw new Error(`La Semana ${week} ya existe. Usa "Reemplazar semana".`);
  }
  if (mode === 'replace' && !anyExisting) {
    throw new Error(`La Semana ${week} no existe aún. Usa "Agregar semana".`);
  }

  const detalles: Record<string, number> = {};
  let totalOld = 0;
  let totalNew = 0;

  for (const s of snapshots) {
    if (s.oldRows.length) {
      await createBackupSheet(
        accessToken,
        spreadsheetId,
        existingTitles,
        s.t.sheet,
        week,
        s.headers,
        s.oldRows
      );
      totalOld += s.oldRows.length;
    }
    const incoming: CellVal[][] = s.t.rows.map((obj) => {
      const merged: Record<string, unknown> = {
        ...obj,
        semana: week,
        corte,
        periodo,
      };
      if (mesSerial !== null) merged.mes = mesSerial;
      return s.headers.map((h) => {
        const v = merged[h] ?? merged[h.toLowerCase()];
        return v === undefined || v === null || Number.isNaN(v) ? '' : (v as CellVal);
      });
    });
    await rewriteSheet(
      accessToken,
      spreadsheetId,
      s.t.sheet,
      s.headers,
      s.keep.concat(incoming)
    );
    detalles[s.t.key] = incoming.length;
    totalNew += incoming.length;
  }

  // Incremental scope sync
  await syncScopesAdditive(
    accessToken,
    spreadsheetId,
    'ejecutivo',
    parsed.indicadoresRows.map((r) => ({
      nombre: r.ejecutivo,
      region: r.region,
      agencia: r.agencia,
    }))
  );
  await syncScopesAdditive(
    accessToken,
    spreadsheetId,
    'coordinador',
    parsed.indicadoresRows
      .filter((r) => r.coordinador && r.coordinador !== '-')
      .map((r) => ({ nombre: r.coordinador, region: r.region, agencia: r.agencia }))
  );

  await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
    usuario: actor,
    accion:
      scope === 'indicadores'
        ? mode === 'add'
          ? 'AGREGAR_INDICADORES'
          : 'REEMPLAZAR_INDICADORES'
        : mode === 'add'
        ? 'AGREGAR_SEMANA_COMPLETA'
        : 'REEMPLAZAR_SEMANA_COMPLETA',
    semana: String(week),
    corte: String(corte),
    periodo,
    archivo: parsed.fileName,
    registros_antes: totalOld,
    registros_nuevos: totalNew,
    resultado: 'OK',
    detalle: Object.entries(detalles)
      .map(([k, v]) => `${k.toUpperCase()} ${v}`)
      .join(' · '),
  });

  return { corte, periodo, detalles };
}

export async function deleteWeekFromSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  week: number,
  corte: number,
  periodo: string,
  scope: 'indicadores' | 'completo',
  actor: string
): Promise<Record<string, number>> {
  const defs: Array<{ sheet: string; by: 'corte' | 'semana'; value: number }> = [
    { sheet: SHEET_NAMES.INDICADORES, by: 'corte', value: corte },
  ];
  if (scope === 'completo') {
    defs.push(
      { sheet: SHEET_NAMES.EJECUTIVO, by: 'semana', value: week },
      { sheet: SHEET_NAMES.COORDINADOR, by: 'semana', value: week },
      { sheet: SHEET_NAMES.GERENTE, by: 'semana', value: week },
      { sheet: SHEET_NAMES.REGIONAL, by: 'semana', value: week }
    );
  }

  const eliminados: Record<string, number> = {};
  let totalOld = 0;
  for (const d of defs) {
    if (!existingTitles.has(d.sheet)) continue;
    const matrix = await readRawSheet(accessToken, spreadsheetId, d.sheet);
    if (matrix.length < 2) continue;
    const headers = (matrix[0] || []).map((h) => String(h ?? '').trim());
    const ix = headers.findIndex((h) => h.toLowerCase() === d.by);
    if (ix < 0) continue;
    const oldRows = matrix.slice(1).filter((r) => sameNum(r[ix], d.value));
    if (!oldRows.length) continue;
    const keep = matrix.slice(1).filter((r) => !sameNum(r[ix], d.value));
    await createBackupSheet(
      accessToken,
      spreadsheetId,
      existingTitles,
      d.sheet,
      week,
      headers,
      oldRows
    );
    await rewriteSheet(accessToken, spreadsheetId, d.sheet, headers, keep);
    eliminados[d.sheet] = oldRows.length;
    totalOld += oldRows.length;
  }

  if (!totalOld) {
    throw new Error(`La Semana ${week} no tiene registros para eliminar.`);
  }

  // Update CORTES if removing full week or EJECUTIVO no longer has this week
  let shouldRemoveCorte = scope === 'completo';
  if (!shouldRemoveCorte && existingTitles.has(SHEET_NAMES.EJECUTIVO)) {
    const ejMatrix = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.EJECUTIVO);
    if (ejMatrix.length >= 2) {
      const eh = (ejMatrix[0] || []).map((x) => String(x ?? '').trim().toLowerCase());
      const wix = eh.indexOf('semana');
      if (wix >= 0) {
        shouldRemoveCorte = !ejMatrix.slice(1).some((r) => sameNum(r[wix], week));
      }
    }
  }
  if (shouldRemoveCorte) {
    const cm = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.CORTES);
    if (cm.length >= 2) {
      const ch = (cm[0] || []).map((x) => String(x ?? '').trim());
      const wix = ch.findIndex((x) => x.toUpperCase() === 'SEMANA');
      if (wix >= 0) {
        const rem = cm.slice(1).filter((r) => sameNum(r[wix], week));
        if (rem.length) {
          await createBackupSheet(
            accessToken,
            spreadsheetId,
            existingTitles,
            'CORTES',
            week,
            ch,
            rem
          );
          await rewriteSheet(
            accessToken,
            spreadsheetId,
            SHEET_NAMES.CORTES,
            ch,
            cm.slice(1).filter((r) => !sameNum(r[wix], week))
          );
        }
      }
    }
  }

  await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
    usuario: actor,
    accion: scope === 'indicadores' ? 'ELIMINAR_INDICADORES' : 'ELIMINAR_SEMANA_COMPLETA',
    semana: String(week),
    corte: String(corte),
    periodo,
    registros_antes: totalOld,
    registros_nuevos: 0,
    resultado: 'OK',
    detalle: Object.entries(eliminados)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · '),
  });

  return eliminados;
}

export async function publishDailyToSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  parsed: ParsedDailyWorkbook,
  actor: string
): Promise<{ backupName: string; rowsWritten: number }> {
  let backupName = '';
  let priorCount = 0;

  if (existingTitles.has(SHEET_NAMES.DIARIOS)) {
    const oldMatrix = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.DIARIOS);
    if (oldMatrix.length > 1) {
      priorCount = oldMatrix.length - 1;
      const oldHeaders = (oldMatrix[0] || []).map((x) => String(x ?? '').trim());
      backupName = await createBackupSheet(
        accessToken,
        spreadsheetId,
        existingTitles,
        'DIARIOS',
        '',
        oldHeaders,
        oldMatrix.slice(1)
      );
    }
  } else {
    await ensureSheetExists(
      accessToken,
      spreadsheetId,
      existingTitles,
      SHEET_NAMES.DIARIOS,
      parsed.headers
    );
  }

  await rewriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_NAMES.DIARIOS,
    parsed.headers,
    parsed.rows
  );

  // Sync scopes for latest date
  const latestDate = parsed.dates[parsed.dates.length - 1] || '';
  const fIx = parsed.headers.indexOf('FECHACORTE');
  const aIx = parsed.headers.indexOf('ASESOR');
  const rIx = parsed.headers.indexOf('REGIONAL');
  const sIx = parsed.headers.indexOf('SUCURSAL');
  const cIx = parsed.headers.indexOf('COORDINADOR');
  const eIx = parsed.headers.indexOf('ESTATUS');

  const latestRows = parsed.rows.filter(
    (r) =>
      String(r[fIx]) === latestDate &&
      isCurrentStaffRow({ estatus: eIx >= 0 ? r[eIx] : 'ACTIVO' })
  );

  if (aIx >= 0 && rIx >= 0 && sIx >= 0) {
    await syncScopesAdditive(
      accessToken,
      spreadsheetId,
      'ejecutivo',
      latestRows.map((r) => ({
        nombre: String(r[aIx] ?? ''),
        region: String(r[rIx] ?? ''),
        agencia: String(r[sIx] ?? ''),
      }))
    );
  }
  if (cIx >= 0 && rIx >= 0 && sIx >= 0) {
    await syncScopesAdditive(
      accessToken,
      spreadsheetId,
      'coordinador',
      latestRows.map((r) => ({
        nombre: String(r[cIx] ?? ''),
        region: String(r[rIx] ?? ''),
        agencia: String(r[sIx] ?? ''),
      }))
    );
  }

  await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
    usuario: actor,
    accion: 'REEMPLAZAR_INDICADORES_DIARIOS',
    archivo: parsed.fileName,
    registros_antes: priorCount,
    registros_nuevos: parsed.totalRows,
    resultado: 'OK',
    detalle: `Fechas ${parsed.dates[0]} a ${latestDate}${backupName ? ` · backup ${backupName}` : ''}`,
  });

  return { backupName, rowsWritten: parsed.totalRows };
}

export async function publishNormalidadMonthToSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  monthKey: string,
  rows: NormalidadRawRow[],
  actor: string
): Promise<{ removed: number; added: number; backup: string }> {
  const defaultHeaders = [
    'REGION',
    'AGENCIA',
    'EJECUTIVO',
    'CORTE SEMANAL',
    'CORTE MES',
    'ESPERADO',
    'RECIBIDO',
    '%',
    '$ ESPERADA',
    '$ RECIBIDA',
    '$ ESPERADA RECIBIDA',
    '$ RECIBIDA NO ESPERADA',
  ];

  await ensureSheetExists(
    accessToken,
    spreadsheetId,
    existingTitles,
    SHEET_NAMES.NORMALIDAD,
    defaultHeaders
  );

  const matrix = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.NORMALIDAD);
  let hdr = 0;
  const col: Record<string, number> = {};
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const m: Record<string, number> = {};
    (matrix[i] || []).forEach((h, j) => {
      const c = canonHeader(h);
      if (c && m[c] === undefined) m[c] = j;
    });
    if (m['REGION'] !== undefined && m['AGENCIA'] !== undefined && m['EJECUTIVO'] !== undefined) {
      hdr = i;
      Object.assign(col, m);
      break;
    }
  }
  const headers = (matrix[hdr] || defaultHeaders).map((x) => String(x ?? '').trim());
  const weekCol =
    headers.findIndex((h) => /SEMAN|\bSEM\b/i.test(canonHeader(h))) >= 0
      ? headers.findIndex((h) => /SEMAN|\bSEM\b/i.test(canonHeader(h)))
      : headers.findIndex((h) => /CORTE|FECHA/i.test(canonHeader(h)));
  const monthCol = headers.findIndex(
    (h, idx) => idx !== weekCol && /\bMES\b|MENSUAL|CORTE/i.test(canonHeader(h))
  );

  const keep: CellVal[][] = [];
  const removed: CellVal[][] = [];

  for (let i = hdr + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r || !r.some((v) => v !== '' && v != null)) continue;
    const cutD = monthCol >= 0 ? dailyDateKey(r[monthCol]) : '';
    const wkD = weekCol >= 0 ? dailyDateKey(r[weekCol]) : '';
    const eff = wkD || cutD;
    const mk = cutD ? cutD.slice(0, 7) : eff ? nrmMonthKeyFromCut(eff) : '';
    if (mk === monthKey) {
      removed.push(r);
    } else {
      keep.push(r);
    }
  }

  let backup = '';
  if (removed.length) {
    backup = await createBackupSheet(
      accessToken,
      spreadsheetId,
      existingTitles,
      'NORMALIDAD',
      monthKey.replace('-', ''),
      headers,
      removed
    );
  }

  const newRows: CellVal[][] = rows.map((o) => {
    const row: CellVal[] = headers.map(() => '');
    const set = (name: string, val: CellVal) => {
      const ix = headers.findIndex((h) => canonHeader(h) === name);
      if (ix >= 0) row[ix] = val;
    };
    set('REGION', o.region);
    set('AGENCIA', o.agency);
    set('EJECUTIVO', o.ejecutivo);
    if (weekCol >= 0) row[weekCol] = o.date;
    if (monthCol >= 0) row[monthCol] = `${monthKey}-28`;
    set('ESPERADO', o.esp);
    set('RECIBIDO', o.rec);
    set('%', o.esp > 0 ? o.rec / o.esp : 0);
    set('$ ESPERADA', o.amtE);
    set('$ RECIBIDA', o.amtR);
    set('$ ESPERADA RECIBIDA', o.amtER);
    set('$ RECIBIDA NO ESPERADA', o.amtNE);
    return row;
  });

  await rewriteSheet(
    accessToken,
    spreadsheetId,
    SHEET_NAMES.NORMALIDAD,
    headers,
    keep.concat(newRows)
  );

  await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
    usuario: actor,
    accion: rows.length ? 'NORMALIDAD_PUBLICAR_MES' : 'NORMALIDAD_QUITAR_MES',
    archivo: monthKey,
    registros_antes: removed.length,
    registros_nuevos: newRows.length,
    resultado: 'OK',
    detalle: `NORMALIDAD mes ${monthKey}${backup ? ` · respaldo ${backup}` : ''}`,
  });

  return { removed: removed.length, added: newRows.length, backup };
}

export async function deleteBackupSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  backups: BackupInfo[],
  actor: string
): Promise<number> {
  if (!backups.length) return 0;
  const requests = backups.map((b) => ({
    deleteSheet: { sheetId: b.sheetId },
  }));
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ requests }),
    }
  );
  backups.forEach((b) => existingTitles.delete(b.name));
  await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
    usuario: actor,
    accion: 'ELIMINAR_RESPALDOS',
    registros_antes: backups.length,
    registros_nuevos: 0,
    resultado: 'OK',
    detalle: `Respaldos eliminados: ${backups.map((b) => b.name).join(' | ')}`,
  });
  return backups.length;
}

function generateUsername(nombre: string, existing: Set<string>): string {
  const parts = nombre
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const base = ((parts[0] || 'u')[0] || 'u') + (parts[parts.length - 1] || 'usuario');
  const trimmed = base.slice(0, 18);
  let candidate = trimmed;
  let n = 1;
  while (existing.has(candidate)) {
    candidate = `${trimmed}${n}`;
    n++;
  }
  existing.add(candidate);
  return candidate;
}

export function generateTempPassword(): string {
  return 'mcm' + String(Math.floor(100000 + Math.random() * 900000));
}

export async function approvePendingUsersInSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  selected: PendingUserCandidate[],
  actor: string
): Promise<Array<{ username: string; password: string; role: string; nombre: string }>> {
  const matrix = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.USUARIOS);
  const headers = (matrix[0] || ['username', 'password', 'role', 'nombre', 'estado']).map((h) =>
    String(h ?? '').trim()
  );
  const cHdr = headers.map((h) => canonHeader(h));
  const findCol = (aliases: string[], fb: number) => {
    const idx = cHdr.findIndex((h) => aliases.includes(h));
    return idx >= 0 ? idx : fb;
  };
  const ui = findCol(['USERNAME', 'USUARIO', 'USER'], 0);
  const pi = findCol(['PASSWORD', 'CONTRASENA', 'CLAVE', 'PASS'], 1);
  const ri = findCol(['ROLE', 'ROL', 'PERFIL'], 2);
  const ni = findCol(['NOMBRE', 'NAME'], 3);
  const ei = cHdr.findIndex((h) => ['ESTADO', 'ESTATUS', 'STATUS'].includes(h));

  const existingUsernames = new Set(
    matrix.slice(1).map((r) => String(r[ui] ?? '').trim().toLowerCase())
  );
  const existingKeys = new Set(
    matrix.slice(1).map((r) => `${String(r[ri] ?? '').toLowerCase()}|${personKey(r[ni])}`)
  );

  const newRows: CellVal[][] = [];
  const created: Array<{ username: string; password: string; role: string; nombre: string }> = [];

  for (const item of selected) {
    const k = `${item.role}|${personKey(item.nombre)}`;
    if (existingKeys.has(k)) continue;
    existingKeys.add(k);
    const username = generateUsername(item.nombre, existingUsernames);
    const password = generateTempPassword();
    const row: CellVal[] = headers.map(() => '');
    row[ui] = username;
    row[pi] = password;
    row[ri] = item.role;
    row[ni] = item.nombre;
    if (ei >= 0) row[ei] = 'activo';
    newRows.push(row);
    created.push({ username, password, role: item.role, nombre: item.nombre });

    await syncScopesAdditive(
      accessToken,
      spreadsheetId,
      item.role,
      item.scopes.map((s) => ({
        nombre: item.nombre,
        region: s.region,
        agencia: s.agencia,
      }))
    );
  }

  if (newRows.length) {
    await appendSheetRows(accessToken, spreadsheetId, SHEET_NAMES.USUARIOS, newRows);
    await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
      usuario: actor,
      accion: 'ALTA_USUARIOS',
      registros_nuevos: created.length,
      resultado: 'OK',
      detalle: `Usuarios autorizados: ${created.map((c) => c.username).join(', ')}`,
    });
  }
  return created;
}

export async function updateUserInSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  username: string,
  newRole: Role,
  newEstado: 'activo' | 'inactivo',
  candidates: PendingUserCandidate[],
  actor: string
): Promise<void> {
  const matrix = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.USUARIOS);
  if (matrix.length < 2) throw new Error('Hoja USUARIOS vacía.');
  const headers = (matrix[0] || []).map((h) => String(h ?? '').trim());
  const cHdr = headers.map((h) => canonHeader(h));
  const findCol = (aliases: string[], fb: number) => {
    const idx = cHdr.findIndex((h) => aliases.includes(h));
    return idx >= 0 ? idx : fb;
  };
  const ui = findCol(['USERNAME', 'USUARIO', 'USER'], 0);
  const ri = findCol(['ROLE', 'ROL', 'PERFIL'], 2);
  const ei = cHdr.findIndex((h) => ['ESTADO', 'ESTATUS', 'STATUS'].includes(h));
  const ni = findCol(['NOMBRE', 'NAME'], 3);

  const rowIdx = matrix
    .slice(1)
    .findIndex((r) => String(r[ui] ?? '').trim().toLowerCase() === username.toLowerCase());
  if (rowIdx < 0) throw new Error('Usuario no encontrado.');

  const rows = matrix.slice(1).map((r) => [...r]);
  const nombre = String(rows[rowIdx][ni] ?? '').trim().toUpperCase();
  rows[rowIdx][ri] = newRole;
  if (ei >= 0) rows[rowIdx][ei] = newEstado;

  await rewriteSheet(accessToken, spreadsheetId, SHEET_NAMES.USUARIOS, headers, rows);

  // Sync scopes for restricted roles if active
  if (
    newEstado === 'activo' &&
    (['ejecutivo', 'coordinador', 'gerente', 'regional'] as Role[]).includes(newRole)
  ) {
    const match = candidates.filter(
      (c) => c.role === newRole && personKey(c.nombre) === personKey(nombre)
    );
    if (match.length) {
      await syncScopesAdditive(
        accessToken,
        spreadsheetId,
        newRole as 'ejecutivo' | 'coordinador' | 'gerente' | 'regional',
        match.flatMap((m) =>
          m.scopes.map((s) => ({ nombre, region: s.region, agencia: s.agencia }))
        )
      );
    }
  }

  await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
    usuario: actor,
    accion: 'MODIFICAR_USUARIO',
    resultado: 'OK',
    detalle: `${username} · ${newRole} · ${newEstado}`,
  });
}

export async function resetPasswordInSheets(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: Set<string>,
  username: string,
  customPassword: string,
  actor: string
): Promise<string> {
  const pw = customPassword.trim() || generateTempPassword();
  if (pw.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

  const matrix = await readRawSheet(accessToken, spreadsheetId, SHEET_NAMES.USUARIOS);
  if (matrix.length < 2) throw new Error('Hoja USUARIOS vacía.');
  const headers = (matrix[0] || []).map((h) => String(h ?? '').trim());
  const cHdr = headers.map((h) => canonHeader(h));
  const findCol = (aliases: string[], fb: number) => {
    const idx = cHdr.findIndex((h) => aliases.includes(h));
    return idx >= 0 ? idx : fb;
  };
  const ui = findCol(['USERNAME', 'USUARIO', 'USER'], 0);
  const pi = findCol(['PASSWORD', 'CONTRASENA', 'CLAVE', 'PASS'], 1);
  const rows = matrix.slice(1).map((r) => [...r]);
  const idx = rows.findIndex(
    (r) => String(r[ui] ?? '').trim().toLowerCase() === username.toLowerCase()
  );
  if (idx < 0) throw new Error('Usuario no encontrado.');
  rows[idx][pi] = pw;

  await rewriteSheet(accessToken, spreadsheetId, SHEET_NAMES.USUARIOS, headers, rows);
  await appendLogOperation(accessToken, spreadsheetId, existingTitles, {
    usuario: actor,
    accion: 'RESET_PASSWORD',
    resultado: 'OK',
    detalle: `Usuario: ${username}`,
  });
  return pw;
}

export { dailyRegionScopeKey };

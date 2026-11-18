import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1UnWSSYLEHfrdmX21NipwdjcRJ9xWr-vo1GfM-o2QqeE';
const DEFAULT_APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL !== undefined
    ? process.env.APPS_SCRIPT_URL.trim()
    : 'https://script.google.com/macros/s/AKfycby6ay6s4W3n0mh2xC34d8YHHiyRO6aUigcE0lvUt_6GgZ8JpO2fVroLHajpfEL5IOYoeA/exec';
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

type Role =
  | 'ejecutivo'
  | 'coordinador'
  | 'gerente'
  | 'regional'
  | 'directivo'
  | 'direccion'
  | 'admin';

interface SessionPayload {
  username: string;
  role: Role;
  nombre: string;
  googleEmail?: string;
  mode: 'google_workspace' | 'usuario_interno';
  appsScriptToken?: string;
  exp: number;
}

// In-memory Service Account token cache
let saTokenCache: { token: string; exp: number } | null = null;
// In-memory Admin Workspace token bridge (cleared when server restarts or admin disconnects)
let adminWorkspaceBridge: { token: string; setAt: number; email?: string } | null = null;

function hasServiceAccountConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
}

function hasAppsScriptConfigured(): boolean {
  return Boolean(DEFAULT_APPS_SCRIPT_URL);
}

function publicSessionView(s: SessionPayload) {
  return {
    username: s.username,
    role: s.role,
    nombre: s.nombre,
    googleEmail: s.googleEmail,
    mode: s.mode,
    exp: s.exp,
  };
}

async function getServiceAccountToken(): Promise<string | null> {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawJson) return null;
  if (saTokenCache && Date.now() < saTokenCache.exp - 60_000) {
    return saTokenCache.token;
  }
  const sa = JSON.parse(rawJson) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
    'base64url'
  );
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope:
        'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  ).toString('base64url');
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(sa.private_key, 'base64url');
  const assertion = `${unsigned}.${signature}`;

  const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Error Service Account OAuth: ${text}`);
  }
  const json = (await tokenRes.json()) as { access_token: string; expires_in?: number };
  saTokenCache = {
    token: json.access_token,
    exp: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return json.access_token;
}

async function resolveGoogleAccessToken(bearerFromReq?: string): Promise<string | null> {
  if (bearerFromReq) return bearerFromReq;
  const saToken = await getServiceAccountToken();
  if (saToken) return saToken;
  if (
    adminWorkspaceBridge &&
    Date.now() - adminWorkspaceBridge.setAt < 55 * 60 * 1000
  ) {
    return adminWorkspaceBridge.token;
  }
  return null;
}

/* ==================== SIGNED SESSION HELPERS ==================== */

function signSessionToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function readSessionFromReq(req: Request): SessionPayload | null {
  const headerTok = req.headers['x-mcm-session'];
  if (typeof headerTok === 'string' && headerTok) {
    const verified = verifySessionToken(headerTok);
    if (verified) return verified;
  }
  const cookies = parseCookies(req);
  return verifySessionToken(cookies.mcm_session);
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '').includes('https');
  const attrs = isHttps
    ? 'Path=/; HttpOnly; Secure; SameSite=None; Max-Age=21600'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=21600';
  res.setHeader('Set-Cookie', `mcm_session=${encodeURIComponent(token)}; ${attrs}`);
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '').includes('https');
  const attrs = isHttps
    ? 'Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', `mcm_session=; ${attrs}`);
}

/* ==================== SHEET READING & RBAC ==================== */

type CellVal = string | number | boolean | null | undefined;
type Matrix = CellVal[][];

const SHEET_NAMES = {
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
} as const;

function normText(v: unknown): string {
  return String(v == null ? '' : v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function personKey(v: unknown): string {
  return String(v == null ? '' : v)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function dailyRegionScopeKey(value: unknown): string {
  const region = personKey(value);
  if (region === 'VOLCANESORIENTE') return 'VOLCANES';
  if (region === 'EDOMEX' || region === 'ESTADODEMEXICO') return 'EDOMEXICO';
  return region;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function normalizeRole(rawRole: unknown): Role {
  const k = normText(rawRole).toLowerCase().replace(/\s+/g, '_');
  if (k === 'administrador' || k === 'admin' || k.includes('admin')) return 'admin';
  if (k.includes('directiv') || k.includes('director')) return 'directivo';
  if (k.includes('direccion')) return 'direccion';
  if (k === 'gerente_regional' || k.includes('regional')) return 'regional';
  if (k.includes('gerente')) return 'gerente';
  if (k.includes('coordinador')) return 'coordinador';
  return 'ejecutivo';
}

function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000);
}

function dailyDateKey(v: unknown): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return v.toISOString().slice(0, 10);
  }
  const text = String(v == null ? '' : v).trim();
  if (!text) return '';
  if (typeof v === 'number' || /^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(v);
    if (!Number.isFinite(serial) || serial < 20000 || serial >= 2958466) return '';
    return serialToDate(Math.floor(serial)).toISOString().slice(0, 10);
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (local) {
    return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  }
  return '';
}

function nrmMonthKeyFromCut(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 2);
  return d.toISOString().slice(0, 7);
}

function isCurrentStaffRow(r: { estatus?: unknown; ESTATUS?: unknown }): boolean {
  const est = String(r.estatus ?? r.ESTATUS ?? 'ACTIVO').trim().toUpperCase();
  return !['BAJA', 'INACTIVO', 'INACTIVA'].includes(est);
}

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

async function googleFetch<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `Error HTTP ${res.status}`;
    try {
      const errText = await res.text();
      if (errText && !errText.trimStart().startsWith('<')) {
        const errJson = JSON.parse(errText) as { error?: { message?: string } };
        msg = errJson?.error?.message || msg;
      }
    } catch {
      // ignore
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const okText = await res.text();
  return JSON.parse(okText) as T;
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

async function loadRawSpreadsheet(accessToken: string, spreadsheetId: string) {
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
  const wantedSheets = Object.values(SHEET_NAMES).filter((name) =>
    existingTitles.has(name)
  );

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
      const title = wantedSheets[idx];
      if (title) matrices.set(title, vr.values || []);
    });
  }

  const cortes = matrixToObjects(matrices.get(SHEET_NAMES.CORTES) || [])
    .map((r) => ({
      MES: nullableNum(r.MES ?? r.mes),
      SEMANA: num(r.SEMANA ?? r.semana),
      CORTE: num(r.CORTE ?? r.corte),
      PERIODO: normStr(r.PERIODO ?? r.periodo),
    }))
    .filter((r) => r.CORTE > 0)
    .sort((a, b) => a.CORTE - b.CORTE);

  const indicadores = matrixToObjects(matrices.get(SHEET_NAMES.INDICADORES) || []).map(
    (r) => ({
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
      monto_nuevos: num(r.monto_nuevos),
      monto_renovaciones: num(r.monto_renovaciones),
      monto_nuevos_dashboard: num(r.monto_nuevos),
      monto_renovaciones_dashboard: num(r.monto_renovaciones),
      renov_tiempo: num(r.renov_tiempo),
      renov_tardia: num(r.renov_tardia),
      productivo: num(r.productivo),
      pagare: num(r.pagare),
      comision_cartera_heredada: num(r.comision_cartera_heredada),
      apoyo_familiar: num(r.apoyo_familiar),
    })
  );

  const ejecutivoCom = matrixToObjects(matrices.get(SHEET_NAMES.EJECUTIVO) || []).map(
    (r) => ({
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
    })
  );

  const semanaToCorte = new Map<number, number>();
  cortes.forEach((c) => {
    if (c.SEMANA > 0 && c.CORTE > 0) {
      semanaToCorte.set(c.SEMANA, c.CORTE);
    }
  });

  const parseDir = (
    sheetName: string,
    rolPersona: 'coordinador' | 'gerente' | 'regional'
  ) =>
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

  const usuariosMatrix = matrices.get(SHEET_NAMES.USUARIOS) || [];
  const uHdr = (usuariosMatrix[0] || []).map((h) => canonHeader(h));
  const findCol = (aliases: string[], fallbackIdx: number): number => {
    const idx = uHdr.findIndex((h) => aliases.includes(h));
    return idx >= 0 ? idx : fallbackIdx;
  };
  const ui = findCol(['USERNAME', 'USUARIO', 'USER'], 0);
  const pi = findCol(['PASSWORD', 'CONTRASENA', 'CLAVE', 'PASS'], 1);
  const ri = findCol(['ROLE', 'ROL', 'PERFIL'], 2);
  const ni = findCol(['NOMBRE', 'NAME'], 3);
  const ei = uHdr.findIndex((h) => ['ESTADO', 'ESTATUS', 'STATUS'].includes(h));

  const usuarios = usuariosMatrix
    .slice(1)
    .filter((r) => r && normStr(r[ui]) !== '')
    .map((r) => ({
      username: normStr(r[ui]).toLowerCase(),
      password: String(r[pi] ?? ''),
      role: normalizeRole(r[ri]),
      nombre: normStr(r[ni]).toUpperCase(),
      estado: (ei >= 0 && normStr(r[ei] || 'activo').toLowerCase() === 'inactivo'
        ? 'inactivo'
        : 'activo') as 'activo' | 'inactivo',
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const parseScope = (sheetName: string, keyField: string) =>
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

  const diariosMatrix = matrices.get(SHEET_NAMES.DIARIOS) || [];
  const diariosHeaders = (diariosMatrix[0] || []).map((h) => String(h ?? '').trim());
  const diarios = matrixToObjects(diariosMatrix).map((r) => ({
    ...r,
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

  const nrmMatrix = matrices.get(SHEET_NAMES.NORMALIDAD) || [];
  const normalidadRaw: Array<{
    region: string;
    agency: string;
    ejecutivo: string;
    date: string;
    monthKey: string;
    cutDate?: string;
    esp: number;
    rec: number;
    amtE: number;
    amtR: number;
    amtER: number;
    amtNE: number;
  }> = [];

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
      const cands: Array<{
        header: string;
        c: string;
        j: number;
        set: Set<string>;
        valid: number;
        total: number;
      }> = [];
      (nrmMatrix[hdr] || []).forEach((h, j) => {
        const c = canonHeader(h);
        if (c && /CORTE|SEMAN|\bSEM\b|FECHA|\bMES\b|MENSUAL/.test(c)) {
          cands.push({
            header: String(h ?? '').trim(),
            c,
            j,
            set: new Set(),
            valid: 0,
            total: 0,
          });
        }
      });
      for (let i = hdr + 1; i < nrmMatrix.length; i++) {
        const r = nrmMatrix[i];
        const reg = r?.[col['REGION']];
        const ej = r?.[col['EJECUTIVO']];
        if (typeof reg !== 'string' || !reg.trim() || typeof ej !== 'string' || !ej.trim()) {
          continue;
        }
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
        for (let i = hdr + 1; i < nrmMatrix.length; i++) {
          const r = nrmMatrix[i];
          if (!r) continue;
          const reg = r[col['REGION']];
          const ej = r[col['EJECUTIVO']];
          if (typeof reg !== 'string' || !reg.trim() || typeof ej !== 'string' || !ej.trim()) {
            continue;
          }
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
            amtR: col['$ RECIBIDA'] !== undefined ? num(r[col['$ RECIBIDA']]) : amtER + amtNE,
            amtER,
            amtNE,
          });
        }
      }
    }
  }

  const backups = sheetMeta
    .filter((s) => /^BK_ADMIN_/.test(s.title))
    .map((s) => {
      const m = s.title.match(/^BK_ADMIN_(.+)_S(\d+)_(\d{8})_(\d{6})(?:_.+)?$/);
      let source = '';
      let week: number | '' = '';
      let created = '';
      if (m) {
        source = m[1];
        week = Number(m[2]);
        const d = m[3];
        const t = m[4];
        created = `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
      } else {
        source = s.title.replace(/^BK_ADMIN_/, '');
      }
      return {
        sheetId: s.sheetId,
        name: s.title,
        source,
        week,
        created,
        rows: Math.max(0, s.rowCount - 1),
        columns: s.columnCount,
      };
    });

  const logs = matrixToObjects(matrices.get(SHEET_NAMES.LOG) || [])
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
    normalidadMeta: null,
    backups,
    logs,
  };
}

function scopePayloadForSession(
  raw: Awaited<ReturnType<typeof loadRawSpreadsheet>>,
  session: SessionPayload
) {
  const { role, nombre } = session;
  const pk = personKey(nombre);

  const scopeWeekly = <T extends { region?: string; agencia?: string; ejecutivo?: string }>(
    rows: T[]
  ): T[] => {
    if (role === 'admin' || role === 'directivo' || role === 'direccion') return rows;
    if (role === 'ejecutivo') return rows.filter((r) => personKey(r.ejecutivo) === pk);
    if (role === 'coordinador') {
      const allowed = new Set(
        raw.scopeCoordinador
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
      );
      return rows.filter((r) =>
        allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`)
      );
    }
    if (role === 'gerente') {
      const allowed = new Set(
        raw.scopeGerente
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
      );
      return rows.filter((r) =>
        allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`)
      );
    }
    if (role === 'regional') {
      const allowed = new Set(
        raw.scopeRegional
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => dailyRegionScopeKey(s.region))
      );
      return rows.filter((r) => allowed.has(dailyRegionScopeKey(r.region)));
    }
    return [];
  };

  const scopeDir = (rows: typeof raw.coordinadorCom) => {
    if (role === 'admin' || role === 'directivo' || role === 'direccion') return rows;
    if (role === 'ejecutivo') return [];
    if (role === 'regional') {
      const allowed = new Set(
        raw.scopeRegional
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => dailyRegionScopeKey(s.region))
      );
      return rows.filter((r) => allowed.has(dailyRegionScopeKey(r.region)));
    }
    if (role === 'gerente') {
      const allowed = new Set(
        raw.scopeGerente
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
      );
      const regions = new Set(
        raw.scopeGerente
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => dailyRegionScopeKey(s.region))
      );
      return rows.filter(
        (r) =>
          allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`) ||
          (r.rol_persona === 'regional' && regions.has(dailyRegionScopeKey(r.region)))
      );
    }
    if (role === 'coordinador') {
      const allowed = new Set(
        raw.scopeCoordinador
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
      );
      return rows.filter((r) =>
        allowed.has(`${dailyRegionScopeKey(r.region)}|${normText(r.agencia)}`)
      );
    }
    return [];
  };

  const scopeDiarios = () => {
    const rows = raw.diarios;
    if (role === 'admin' || role === 'directivo' || role === 'direccion') return rows;
    if (role === 'ejecutivo') return rows.filter((r) => personKey(r.ASESOR) === pk);
    if (!rows.length) return [];
    const newest = rows.reduce((m, r) => (r.FECHACORTE > m ? r.FECHACORTE : m), '');
    const latest = rows.filter((r) => r.FECHACORTE === newest);
    if (role === 'coordinador') {
      const manual = new Set(
        raw.scopeCoordinador
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
        raw.scopeGerente
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => `${dailyRegionScopeKey(s.region)}|${normText(s.agencia)}`)
      );
      const maxWeek = raw.gerenteCom.reduce((m, r) => Math.max(m, num(r.semana)), 0);
      const current = new Set(
        raw.gerenteCom
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
        raw.scopeRegional
          .filter((s) => personKey(s.persona) === pk)
          .map((s) => dailyRegionScopeKey(s.region))
      );
      const maxWeek = raw.regionalCom.reduce((m, r) => Math.max(m, num(r.semana)), 0);
      const current = new Set(
        raw.regionalCom
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
  };

  const isPrivilegedMonthly = role === 'admin' || role === 'directivo' || role === 'direccion';
  const isAdmin = role === 'admin';

  return {
    spreadsheetId: raw.spreadsheetId,
    spreadsheetTitle: raw.spreadsheetTitle,
    sheetMeta: isAdmin ? raw.sheetMeta : [],
    cortes: raw.cortes,
    indicadores: scopeWeekly(raw.indicadores),
    ejecutivoCom: scopeWeekly(raw.ejecutivoCom),
    coordinadorCom: role === 'coordinador' || role === 'gerente' || role === 'regional' || isPrivilegedMonthly
      ? scopeDir(raw.coordinadorCom)
      : [],
    gerenteCom: role === 'gerente' || role === 'regional' || isPrivilegedMonthly
      ? scopeDir(raw.gerenteCom)
      : [],
    regionalCom: role === 'gerente' || role === 'regional' || isPrivilegedMonthly
      ? scopeDir(raw.regionalCom)
      : [],
    // Strip passwords even for Admin!
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
    scopeGerente: isPrivilegedMonthly || role === 'gerente' ? raw.scopeGerente : [],
    scopeRegional: isPrivilegedMonthly || role === 'regional' ? raw.scopeRegional : [],
    diariosHeaders: raw.diariosHeaders,
    diarios: scopeDiarios(),
    normalidadRaw: isPrivilegedMonthly ? raw.normalidadRaw : [],
    normalidadMeta: null,
    backups: isAdmin ? raw.backups : [],
    logs: isAdmin ? raw.logs : [],
  };
}

/* ==================== APPS SCRIPT WEB APP BRIDGE ==================== */

async function callAppsScript<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  timeoutMs = 25_000
): Promise<T> {
  if (!DEFAULT_APPS_SCRIPT_URL) {
    throw new Error('APPS_SCRIPT_URL no configurada.');
  }
  const res = await fetch(DEFAULT_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!text || text.trimStart().startsWith('<')) {
    throw new Error(
      `Apps Script devolvió una respuesta no JSON (HTTP ${res.status}). Verifica que la Web App esté implementada con acceso para "Cualquier usuario".`
    );
  }
  const json = JSON.parse(text) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    const err = new Error(json.error || `Error en Apps Script (HTTP ${res.status})`) as Error & {
      status?: number;
    };
    if (String(json.error || '').includes('SESSION_REVOKED')) {
      err.status = 401;
    } else if (res.status >= 400) {
      err.status = res.status;
    } else {
      err.status = 401;
    }
    throw err;
  }
  return json;
}

function mapAppsScriptPayloadToPortal(
  base: Record<string, unknown>,
  dailyRows: Array<Record<string, unknown>>,
  dailyHeaders: string[],
  normalidadRows: Array<{
    region: string;
    agency: string;
    ejecutivo: string;
    date: string;
    monthKey: string;
    esp: number;
    rec: number;
    amtE: number;
    amtR: number;
    amtER: number;
    amtNE: number;
  }>,
  adminUsers: Array<Record<string, unknown>>,
  adminBackups: Array<Record<string, unknown>>
) {
  const role = normalizeRole(base.role);
  const nombre = normStr(base.nombre).toUpperCase();
  const username = normStr(base.username).toLowerCase();

  const cortes = ((base.cortes as Array<Record<string, unknown>>) || [])
    .map((c) => ({
      MES: nullableNum(c.MES ?? c.mes),
      SEMANA: num(c.SEMANA ?? c.semana),
      CORTE: num(c.CORTE ?? c.corte),
      PERIODO: normStr(c.PERIODO ?? c.periodo),
    }))
    .filter((c) => c.CORTE > 0)
    .sort((a, b) => a.CORTE - b.CORTE);

  const corteToMeta = new Map<number, { semana: number; mes: number; periodo: string }>();
  cortes.forEach((c) => {
    corteToMeta.set(c.CORTE, {
      semana: c.SEMANA,
      mes: num(c.MES),
      periodo: c.PERIODO,
    });
  });

  const indicadores = ((base.ejecutivo_indicadores as Array<Record<string, unknown>>) || []).map(
    (r) => {
      const montoNuevos = num(r.monto_nuevos);
      const montoRenov = num(r.monto_renovaciones);
      return {
        corte: num(r.corte),
        ejecutivo: normStr(r.ejecutivo),
        region: normStr(r.region),
        agencia: normStr(r.agencia),
        estatus: normStr(r.estatus),
        coordinador: normStr(r.coordinador) || '-',
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
        monto_nuevos: montoNuevos,
        monto_renovaciones: montoRenov,
        monto_nuevos_dashboard: num(r.monto_nuevos_dashboard ?? montoNuevos),
        monto_renovaciones_dashboard: num(r.monto_renovaciones_dashboard ?? montoRenov),
        renov_tiempo: num(r.renov_tiempo),
        renov_tardia: num(r.renov_tardia),
        productivo: num(r.productivo),
        pagare: num(r.pagare),
        comision_cartera_heredada: num(r.comision_cartera_heredada),
        apoyo_familiar: num(r.apoyo_familiar),
      };
    }
  );

  const ejecutivoCom = ((base.ejecutivo_comisiones as Array<Record<string, unknown>>) || []).map(
    (r) => ({
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
        r.comision_mayor !== undefined && r.comision_mayor !== '' && r.comision_mayor !== null
          ? num(r.comision_mayor)
          : undefined,
      productivo:
        r.productivo !== undefined && r.productivo !== '' && r.productivo !== null
          ? num(r.productivo)
          : undefined,
    })
  );

  const dirAll = ((base.directorio_comisiones as Array<Record<string, unknown>>) || []).map(
    (r) => {
      const corte = num(r.corte);
      const cMeta = corteToMeta.get(corte);
      const rolPersona = (
        normStr(r.rol_persona).toLowerCase() === 'regional'
          ? 'regional'
          : normStr(r.rol_persona).toLowerCase() === 'gerente'
          ? 'gerente'
          : 'coordinador'
      ) as 'coordinador' | 'gerente' | 'regional';
      return {
        mes: num(r.mes) || cMeta?.mes || 0,
        semana: num(r.semana) || cMeta?.semana || 0,
        corte,
        periodo: normStr(r.periodo) || cMeta?.periodo || '',
        region: normStr(r.region),
        agencia: normStr(r.agencia),
        empleado: normStr(r.empleado),
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
    }
  );

  const coordinadorCom = dirAll.filter((d) => d.rol_persona === 'coordinador');
  const gerenteCom = dirAll.filter((d) => d.rol_persona === 'gerente');
  const regionalCom = dirAll.filter((d) => d.rol_persona === 'regional');

  // Synthesize matching scope entries from the authorized rows returned by Apps Script
  const buildScopesFromDir = (
    rows: typeof dirAll,
    onlyRegion: boolean
  ): Array<{ persona: string; region: string; agencia: string }> => {
    const seen = new Set<string>();
    const out: Array<{ persona: string; region: string; agencia: string }> = [];
    rows.forEach((r) => {
      const persona = normStr(r.empleado).toUpperCase();
      const region = normStr(r.region).toUpperCase();
      const agencia = onlyRegion ? '' : normStr(r.agencia).toUpperCase();
      if (!persona || !region) return;
      const key = `${persona}|${region}|${agencia}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ persona, region, agencia });
      }
    });
    return out;
  };

  const diarios = dailyRows.map((r) => ({
    ...r,
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

  const isPrivileged = role === 'admin' || role === 'directivo' || role === 'direccion';
  const isAdmin = role === 'admin';

  const usuarios = isAdmin
    ? adminUsers
        .map((u) => ({
          username: normStr(u.username).toLowerCase(),
          role: normalizeRole(u.role),
          nombre: normStr(u.nombre).toUpperCase(),
          estado: (normStr(u.estado || 'activo').toLowerCase() === 'inactivo'
            ? 'inactivo'
            : 'activo') as 'activo' | 'inactivo',
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    : [];

  const backups = isAdmin
    ? adminBackups.map((b, idx) => ({
        sheetId: idx + 1,
        name: normStr(b.name),
        source: normStr(b.source || 'HOJA'),
        week: (b.week ? Number(b.week) : '') as number | '',
        created: normStr(b.created),
        rows: num(b.rows),
        columns: num(b.cols ?? b.columns),
      }))
    : [];

  const scopeCoord =
    isPrivileged || role === 'coordinador'
      ? buildScopesFromDir(coordinadorCom, false)
      : [];
  const scopeGer =
    isPrivileged || role === 'gerente' ? buildScopesFromDir(gerenteCom, false) : [];
  const scopeReg =
    isPrivileged || role === 'regional' ? buildScopesFromDir(regionalCom, true) : [];

  return {
    sessionInfo: { username, role, nombre },
    data: {
      spreadsheetId: normStr(base.spreadsheet_id) || DEFAULT_SPREADSHEET_ID,
      spreadsheetTitle: 'McM_Datos_DashBoard (Apps Script)',
      sheetMeta: [],
      cortes,
      indicadores,
      ejecutivoCom,
      coordinadorCom,
      gerenteCom,
      regionalCom,
      usuarios,
      scopeEjecutivo: [],
      scopeCoordinador: scopeCoord,
      scopeGerente: scopeGer,
      scopeRegional: scopeReg,
      diariosHeaders: dailyHeaders,
      diarios,
      normalidadRaw: isPrivileged ? normalidadRows : [],
      normalidadMeta: null,
      backups,
      logs: [],
      preScoped: true,
    },
  };
}

async function loadViaAppsScript(params: {
  username?: string;
  password?: string;
  sessionToken?: string;
}): Promise<{
  sessionToken: string;
  sessionInfo: { username: string; role: Role; nombre: string };
  data: ReturnType<typeof mapAppsScriptPayloadToPortal>['data'];
}> {
  const base = params.sessionToken
    ? await callAppsScript<Record<string, unknown>>({
        action: 'refresh_data',
        session_token: params.sessionToken,
      })
    : await callAppsScript<Record<string, unknown>>({
        action: 'login',
        username: params.username || '',
        password: params.password || '',
      });

  const token = String(base.session_token || params.sessionToken || '');
  const mapped = mapAppsScriptPayloadToPortal(base, [], [], [], [], []);
  return {
    sessionToken: token,
    sessionInfo: mapped.sessionInfo,
    data: mapped.data,
  };
}

function mapAppsScriptDailyRows(rawRows: Array<Record<string, unknown>>) {
  return rawRows.map((r) => ({
    ...r,
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
}

async function loadViaAppsScriptDaily(
  token: string,
  opts?: { date?: string; includeHistory?: boolean }
) {
  const includeHistory = Boolean(opts?.includeHistory);
  const datesRes = await callAppsScript<{ dates?: string[] }>(
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
      availableDates: [] as string[],
      targetDate: '',
      includeHistory: true,
      diariosHeaders: [] as string[],
      diarios: [] as Array<Record<string, unknown>>,
    };
  }

  const requestedDate = opts?.date ? dailyDateKey(opts.date) || opts.date : '';
  const targetDate =
    requestedDate && availableDates.includes(requestedDate)
      ? requestedDate
      : availableDates[availableDates.length - 1];

  const dataRes = await callAppsScript<{
    headers?: string[];
    rows?: Array<Record<string, unknown>>;
    history?: Array<Record<string, unknown>>;
  }>(
    {
      action: 'daily_data',
      session_token: token,
      date: targetDate,
      include_history: includeHistory,
    },
    includeHistory ? 60_000 : 35_000
  );

  const combinedMap = new Map<string, Record<string, unknown>>();
  const addRow = (r: Record<string, unknown>) => {
    const k = `${dailyDateKey(r.FECHACORTE)}|${normStr(r.COD_ASESOR) || personKey(r.ASESOR)}`;
    combinedMap.set(k, r);
  };
  if (includeHistory) {
    (dataRes.history || []).forEach(addRow);
  }
  (dataRes.rows || []).forEach(addRow);

  return {
    availableDates,
    targetDate,
    includeHistory,
    diariosHeaders: dataRes.headers || [],
    diarios: mapAppsScriptDailyRows(Array.from(combinedMap.values())),
  };
}

async function loadViaAppsScriptNormalidad(
  token: string,
  role: Role,
  opts?: { month?: string; listOnly?: boolean }
) {
  const isPrivileged = role === 'admin' || role === 'directivo' || role === 'direccion';
  if (!isPrivileged) {
    return {
      availableMonths: [] as Array<{ key: string; label: string; rows?: number }>,
      loadedMonth: '',
      normalidadRaw: [] as Array<{
        region: string;
        agency: string;
        ejecutivo: string;
        date: string;
        monthKey: string;
        esp: number;
        rec: number;
        amtE: number;
        amtR: number;
        amtER: number;
        amtNE: number;
      }>,
    };
  }

  let availableMonths: Array<{ key: string; label: string; rows?: number }> = [];
  let targetMonth = String(opts?.month || '').trim();

  if (!targetMonth) {
    const listRes = await callAppsScript<{
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
    if (!availableMonths.length || opts?.listOnly) {
      return { availableMonths, loadedMonth: '', normalidadRaw: [] };
    }
    targetMonth = availableMonths[0].key;
  }

  const mr = await callAppsScript<{
    data?: {
      month?: string;
      rows?: Array<[string, string, string, number, number, number, number, number]>;
    };
    reporte?: {
      month?: string;
      rows?: Array<[string, string, string, number, number, number, number, number]>;
    };
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
  const normalidadRaw = (payload?.rows || []).map((tup) => {
    const [region, agency, date, esp, rec, amtE, amtER, amtNE] = tup;
    return {
      region: normStr(region),
      agency: normStr(agency) || 'SIN AGENCIA',
      ejecutivo: '',
      date: dailyDateKey(date),
      monthKey: mKey,
      esp: num(esp),
      rec: num(rec),
      amtE: num(amtE),
      amtR: num(amtER) + num(amtNE),
      amtER: num(amtER),
      amtNE: num(amtNE),
    };
  });

  return {
    availableMonths,
    loadedMonth: mKey,
    normalidadRaw,
  };
}

async function loadViaAppsScriptAdminExtras(token: string, role: Role) {
  if (role !== 'admin') {
    return { usuarios: [], backups: [] };
  }
  const [usuarios, backups] = await Promise.all([
    callAppsScript<{ users?: Array<Record<string, unknown>> }>({
      action: 'admin_users',
      session_token: token,
    })
      .then((r) =>
        (r.users || [])
          .map((u) => ({
            username: normStr(u.username).toLowerCase(),
            role: normalizeRole(u.role),
            nombre: normStr(u.nombre).toUpperCase(),
            estado: (normStr(u.estado || 'activo').toLowerCase() === 'inactivo'
              ? 'inactivo'
              : 'activo') as 'activo' | 'inactivo',
          }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      )
      .catch(() => []),
    callAppsScript<{ backups?: Array<Record<string, unknown>> }>({
      action: 'list_backups',
      session_token: token,
    })
      .then((r) =>
        (r.backups || []).map((b, idx) => ({
          sheetId: idx + 1,
          name: normStr(b.name),
          source: normStr(b.source || 'HOJA'),
          week: (b.week ? Number(b.week) : '') as number | '',
          created: normStr(b.created),
          rows: num(b.rows),
          columns: num(b.cols ?? b.columns),
        }))
      )
      .catch(() => []),
  ]);
  return { usuarios, backups };
}

async function loadViaAppsScriptExtras(token: string, role: Role) {
  const [daily, norm, admin] = await Promise.all([
    loadViaAppsScriptDaily(token, { includeHistory: false }).catch(() => ({
      availableDates: [] as string[],
      diariosHeaders: [] as string[],
      diarios: [] as Array<Record<string, unknown>>,
    })),
    loadViaAppsScriptNormalidad(token, role).catch(() => ({
      availableMonths: [] as Array<{ key: string; label: string; rows?: number }>,
      normalidadRaw: [],
    })),
    loadViaAppsScriptAdminExtras(token, role),
  ]);

  return {
    dailyAvailableDates: daily.availableDates,
    diariosHeaders: daily.diariosHeaders,
    diarios: daily.diarios,
    normalidadMonths: norm.availableMonths,
    normalidadRaw: norm.normalidadRaw,
    usuarios: admin.usuarios,
    backups: admin.backups,
  };
}

/* ==================== EXPRESS APP ==================== */

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', async (_req: Request, res: Response) => {
    const hasSa = hasServiceAccountConfigured();
    const hasAs = hasAppsScriptConfigured();
    let serviceAccountEmail = '';
    if (hasSa) {
      try {
        const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}') as {
          client_email?: string;
        };
        serviceAccountEmail = String(parsed.client_email || '');
      } catch {
        serviceAccountEmail = '';
      }
    }
    const hasBridge =
      Boolean(adminWorkspaceBridge) &&
      Date.now() - (adminWorkspaceBridge?.setAt || 0) < 55 * 60 * 1000;
    res.json({
      ok: true,
      serviceAccountConfigured: hasSa,
      serviceAccountEmail,
      appsScriptConfigured: hasAs,
      adminBridgeActive: hasBridge,
      unattendedReady: hasSa || hasBridge || hasAs,
      spreadsheetId: DEFAULT_SPREADSHEET_ID,
    });
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const session = readSessionFromReq(req);
    if (!session) {
      res.status(401).json({ ok: false, error: 'Sin sesión activa.' });
      return;
    }
    res.json({ ok: true, session: publicSessionView(session) });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // 1. Login con Usuario y Contraseña de hoja USUARIOS (para Ejecutivo, Coordinador, Gerente, Regional, Directivo, Admin)
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const username = String(req.body?.username || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const spreadsheetId = String(req.body?.spreadsheetId || DEFAULT_SPREADSHEET_ID).trim();
      if (!username || !password) {
        res.status(400).json({ ok: false, error: 'Usuario y contraseña requeridos.' });
        return;
      }

      const authHeader = req.headers.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : undefined;
      const token = await resolveGoogleAccessToken(bearer);

      if (token) {
        const raw = await loadRawSpreadsheet(token, spreadsheetId);
        const user = raw.usuarios.find(
          (u) =>
            u.username === username &&
            String(u.password || '') === password &&
            u.estado !== 'inactivo'
        );
        if (!user) {
          res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos, o cuenta inactiva.' });
          return;
        }

        const session: SessionPayload = {
          username: user.username,
          role: user.role,
          nombre: user.nombre,
          mode: 'usuario_interno',
          exp: Date.now() + SESSION_TTL_MS,
        };
        const sessionToken = signSessionToken(session);
        setSessionCookie(req, res, sessionToken);

        const scopedData = scopePayloadForSession(raw, session);
        res.json({ ok: true, session: publicSessionView(session), sessionToken, data: scopedData });
        return;
      }

      if (hasAppsScriptConfigured()) {
        const asResult = await loadViaAppsScript({ username, password });
        const session: SessionPayload = {
          username: asResult.sessionInfo.username,
          role: asResult.sessionInfo.role,
          nombre: asResult.sessionInfo.nombre,
          mode: 'usuario_interno',
          appsScriptToken: asResult.sessionToken,
          exp: Date.now() + SESSION_TTL_MS,
        };
        const sessionToken = signSessionToken(session);
        setSessionCookie(req, res, sessionToken);
        res.json({
          ok: true,
          session: publicSessionView(session),
          sessionToken,
          data: asResult.data,
        });
        return;
      }

      res.status(503).json({
        ok: false,
        code: 'NO_SERVER_SHEET_BRIDGE',
        error:
          'El acceso con usuario y contraseña requiere configurar APPS_SCRIPT_URL, GOOGLE_SERVICE_ACCOUNT_JSON en Secrets o que el Administrador haya conectado Google Drive/Sheets en esta sesión.',
      });
    } catch (err) {
      const status = (err as { status?: number })?.status || 500;
      res.status(status).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error validando credenciales.',
      });
    }
  });

  // 2. Login via Google Workspace OAuth (verifies email + sheet permissions / USUARIOS match)
  app.post('/api/auth/google', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : '';
      if (!token) {
        res.status(401).json({ ok: false, error: 'Falta Bearer token de Google.' });
        return;
      }

      const spreadsheetId = String(req.body?.spreadsheetId || DEFAULT_SPREADSHEET_ID).trim();

      // Verify Google access token identity
      const tokenInfoRes = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`
      );
      if (!tokenInfoRes.ok) {
        res.status(401).json({ ok: false, error: 'Token de Google inválido o expirado.' });
        return;
      }
      const tokenInfo = (await tokenInfoRes.json()) as { email?: string };
      const email = String(tokenInfo.email || '').trim().toLowerCase();

      // Check Drive permissions to see if this user is an Editor/Owner of the master Sheet
      let canEditMasterSheet = false;
      try {
        const driveMeta = await googleFetch<{ capabilities?: { canEdit?: boolean } }>(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            spreadsheetId
          )}?fields=capabilities(canEdit)&supportsAllDrives=true`,
          token
        );
        canEditMasterSheet = Boolean(driveMeta.capabilities?.canEdit);
      } catch {
        canEditMasterSheet = false;
      }

      // Read spreadsheet with user's token if they have access, else service account
      const saToken = await getServiceAccountToken();
      let raw: Awaited<ReturnType<typeof loadRawSpreadsheet>>;
      try {
        raw = await loadRawSpreadsheet(token, spreadsheetId);
      } catch (err) {
        if (saToken) {
          raw = await loadRawSpreadsheet(saToken, spreadsheetId);
        } else {
          throw err;
        }
      }

      // Determine RBAC role: Editor/Owner -> admin, otherwise match email/username in USUARIOS
      let matchedUser = raw.usuarios.find(
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
        // Register in-memory bridge so teammates can test USUARIOS login during active session
        adminWorkspaceBridge = { token, setAt: Date.now(), email };
      } else if (matchedUser) {
        role = matchedUser.role;
        nombre = matchedUser.nombre;
        username = matchedUser.username;
      } else {
        res.status(403).json({
          ok: false,
          error:
            `La cuenta ${email || 'Google'} no tiene permisos de Administrador ni está registrada en USUARIOS. Inicia sesión con tu usuario y contraseña de McM.`,
        });
        return;
      }

      const session: SessionPayload = {
        username,
        role,
        nombre,
        googleEmail: email || undefined,
        mode: 'google_workspace',
        exp: Date.now() + SESSION_TTL_MS,
      };
      const sessionToken = signSessionToken(session);
      setSessionCookie(req, res, sessionToken);

      const scopedData = scopePayloadForSession(raw, session);
      res.json({ ok: true, session, sessionToken, data: scopedData });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error conectando con Google Sheets.',
      });
    }
  });

  // 3. Reload scoped data for current authenticated session
  app.get('/api/portal/data', async (req: Request, res: Response) => {
    try {
      const session = readSessionFromReq(req);
      if (!session) {
        res.status(401).json({ ok: false, error: 'Sesión requerida.' });
        return;
      }

      const spreadsheetId = String(req.query.spreadsheetId || DEFAULT_SPREADSHEET_ID).trim();
      const authHeader = req.headers.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : undefined;
      const token = await resolveGoogleAccessToken(bearer);
      if (!token) {
        if (session.appsScriptToken && hasAppsScriptConfigured()) {
          const asResult = await loadViaAppsScript({
            sessionToken: session.appsScriptToken,
          });
          const effectiveSession: SessionPayload = {
            ...session,
            role: asResult.sessionInfo.role,
            nombre: asResult.sessionInfo.nombre,
          };
          res.json({
            ok: true,
            session: publicSessionView(effectiveSession),
            data: asResult.data,
          });
          return;
        }
        res.status(401).json({
          ok: false,
          error: 'El acceso a Google Sheets expiró. Vuelve a iniciar sesión.',
        });
        return;
      }

      const raw = await loadRawSpreadsheet(token, spreadsheetId);
      let effectiveSession = session;
      if (session.mode === 'usuario_interno') {
        const liveUser = raw.usuarios.find((u) => u.username === session.username);
        if (!liveUser || liveUser.estado === 'inactivo') {
          clearSessionCookie(req, res);
          res.status(401).json({
            ok: false,
            error: 'Tu cuenta fue desactivada o eliminada en USUARIOS.',
          });
          return;
        }
        effectiveSession = {
          ...session,
          role: liveUser.role,
          nombre: liveUser.nombre,
        };
      }
      const scopedData = scopePayloadForSession(raw, effectiveSession);
      res.json({ ok: true, session: publicSessionView(effectiveSession), data: scopedData });
    } catch (err) {
      const status = (err as { status?: number })?.status || 500;
      res.status(status).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error cargando datos del portal.',
      });
    }
  });

  // 3b. Independent lazy loaders for Indicadores Diarios, Reportes Mensuales & Admin extras
  app.get('/api/portal/daily', async (req: Request, res: Response) => {
    try {
      const session = readSessionFromReq(req);
      if (!session) {
        res.status(401).json({ ok: false, error: 'Sesión requerida.' });
        return;
      }
      if (!session.appsScriptToken || !hasAppsScriptConfigured()) {
        res.json({ ok: true, empty: true });
        return;
      }
      const date = typeof req.query.date === 'string' ? req.query.date.trim() : undefined;
      const includeHistory = String(req.query.includeHistory || '').toLowerCase() === 'true';
      const daily = await loadViaAppsScriptDaily(session.appsScriptToken, {
        date,
        includeHistory,
      });
      res.json({ ok: true, ...daily });
    } catch (err) {
      const status = (err as { status?: number })?.status || 500;
      res.status(status).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error cargando indicadores diarios.',
      });
    }
  });

  app.get('/api/portal/normalidad', async (req: Request, res: Response) => {
    try {
      const session = readSessionFromReq(req);
      if (!session) {
        res.status(401).json({ ok: false, error: 'Sesión requerida.' });
        return;
      }
      if (
        session.role !== 'admin' &&
        session.role !== 'directivo' &&
        session.role !== 'direccion'
      ) {
        res.status(403).json({
          ok: false,
          error: 'Los reportes mensuales solo están disponibles para Dirección y Administrador.',
        });
        return;
      }
      if (!session.appsScriptToken || !hasAppsScriptConfigured()) {
        res.json({ ok: true, empty: true });
        return;
      }
      const month = typeof req.query.month === 'string' ? req.query.month.trim() : undefined;
      const listOnly = String(req.query.listOnly || '').toLowerCase() === 'true';
      const result = await loadViaAppsScriptNormalidad(
        session.appsScriptToken,
        session.role,
        { month, listOnly }
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      const status = (err as { status?: number })?.status || 500;
      res.status(status).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error cargando reportes mensuales.',
      });
    }
  });

  app.get('/api/portal/admin-extras', async (req: Request, res: Response) => {
    try {
      const session = readSessionFromReq(req);
      if (!session) {
        res.status(401).json({ ok: false, error: 'Sesión requerida.' });
        return;
      }
      if (session.role !== 'admin') {
        res.status(403).json({ ok: false, error: 'Solo Administrador.' });
        return;
      }
      if (!session.appsScriptToken || !hasAppsScriptConfigured()) {
        res.json({ ok: true, empty: true });
        return;
      }
      const extras = await loadViaAppsScriptAdminExtras(session.appsScriptToken, session.role);
      res.json({ ok: true, ...extras });
    } catch (err) {
      const status = (err as { status?: number })?.status || 500;
      res.status(status).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error cargando utilidades de administrador.',
      });
    }
  });

  app.get('/api/portal/extras', async (req: Request, res: Response) => {
    try {
      const session = readSessionFromReq(req);
      if (!session) {
        res.status(401).json({ ok: false, error: 'Sesión requerida.' });
        return;
      }
      if (!session.appsScriptToken || !hasAppsScriptConfigured()) {
        res.json({ ok: true, empty: true });
        return;
      }
      const extras = await loadViaAppsScriptExtras(session.appsScriptToken, session.role);
      res.json({ ok: true, ...extras });
    } catch (err) {
      const status = (err as { status?: number })?.status || 500;
      res.status(status).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error cargando módulos complementarios.',
      });
    }
  });

  // 4. Secure Google Sheets Proxy for Admin mutations (strictly validates role === 'admin' + Google Sheets URL)
  app.post('/api/admin/sheets-proxy', async (req: Request, res: Response) => {
    try {
      const session = readSessionFromReq(req);
      if (!session || session.role !== 'admin') {
        res.status(403).json({
          ok: false,
          error: 'Solo el perfil Administrador puede ejecutar modificaciones en Google Sheets.',
        });
        return;
      }

      const targetUrl = String(req.body?.url || '');
      if (!targetUrl.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
        res.status(400).json({ ok: false, error: 'Destino de API no permitido.' });
        return;
      }

      const authHeader = req.headers.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : undefined;
      const token = await resolveGoogleAccessToken(bearer);
      if (!token) {
        res.status(401).json({
          ok: false,
          error: 'Se requiere sesión de Google o Service Account para escribir en Sheets.',
        });
        return;
      }

      const method = String(req.body?.method || 'GET').toUpperCase();
      const bodyPayload = req.body?.body;

      const googleRes = await fetch(targetUrl, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: method === 'GET' || bodyPayload === undefined ? undefined : String(bodyPayload),
      });
      const text = await googleRes.text();
      res.status(googleRes.status).type('application/json').send(text);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error en proxy de Google Sheets.',
      });
    }
  });

  // Ensure any unmatched /api/* route or middleware error returns JSON, never HTML
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'Ruta de API no encontrada.' });
  });
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number })?.status || 500;
    const msg = err instanceof Error ? err.message : 'Error interno en el servidor.';
    res.status(status).json({ ok: false, error: msg });
  });

  // Vite Dev Middleware or Static Production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Indicadores McM server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

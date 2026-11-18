export type Role =
  | 'ejecutivo'
  | 'coordinador'
  | 'gerente'
  | 'regional'
  | 'directivo'
  | 'direccion'
  | 'admin';

export type ActiveTab =
  | 'indicadores'
  | 'comisiones'
  | 'diarios'
  | 'reportes'
  | 'administracion';

export interface CorteRow {
  MES: number | null;
  SEMANA: number;
  CORTE: number;
  PERIODO: string;
}

export interface IndicadorRow {
  corte: number;
  ejecutivo: string;
  region: string;
  agencia: string;
  estatus: string;
  coordinador: string;
  sin_roster: boolean | string;
  num_creditos: number;
  pagos_esperados: number;
  pagos_recibidos: number;
  monto_esperado: number;
  monto_recibido: number;
  monto_recibido_esperado: number;
  monto_recibido_no_esperado: number;
  mora_capital: number;
  mora_total: number;
  dias_mora_prom: number;
  clientes_vigentes: number;
  saldo_capital: number;
  saldo_total: number;
  desembolso: number;
  colocacion_semanal: number;
  monto_colocacion_semanal: number;
  clientes_nuevos: number;
  renovaciones: number;
  pct_normalidad: number | null;
  pct_mora: number;
  monto_nuevos: number;
  monto_renovaciones: number;
  monto_nuevos_dashboard?: number;
  monto_renovaciones_dashboard?: number;
  renov_tiempo: number;
  renov_tardia: number;
  productivo: number;
  pagare: number;
  comision_cartera_heredada?: number;
  apoyo_familiar?: number;
}

export interface ComisionEjecutivoRow {
  mes: number;
  semana: number;
  corte: number;
  periodo: string;
  region: string;
  agencia: string;
  ejecutivo: string;
  estatus: string;
  puesto: string;
  coordinador: string;
  tipo_esquema: string;
  pagos_esperados: number;
  pagos_recibidos: number;
  pct_normalidad: number | null;
  monto_esperado: number;
  monto_recibido: number;
  monto_recibido_no_esperado: number;
  cobranza_total: number;
  comision_cobranza: number;
  bono_excelencia: number;
  cobranza_credito_adicional: number;
  comision_cobranza_adicional: number;
  comision_cartera_heredada: number;
  recuperacion_cartera_heredada: number;
  clientes_nuevos: number;
  clientes_en_tiempo: number;
  clientes_tardias: number;
  total_clientes: number;
  monto_nuevos: number;
  monto_en_tiempo: number;
  monto_tardias: number;
  monto_renovaciones: number;
  total_colocado: number;
  comision_colocacion_total: number;
  comision_apoyo_familiar: number;
  comision_modelo_tradicional: number;
  comision_modelo_ej_nuevo: number;
  apoyo_economico: number;
  bono_mensual: number;
  campanas: number;
  bono_crecimiento_neto: number;
  convenio: number;
  incapacidad: number;
  multas: number;
  penalizacion_traspaso: number;
  penalizacion_decremento: number;
  prestamo_capital_humano: number;
  prestamo_caja_ahorro: number;
  descuentos_prestamos: number;
  comision_final: number;
  retencion_caja_ahorro: number;
  retroactivos_otros_apoyos: number;
  total_a_cobrar: number;
  comision_mayor?: number;
  productivo?: number;
}

export interface DirectorioRow {
  mes?: number;
  semana?: number;
  corte: number;
  periodo?: string;
  region: string;
  agencia: string;
  empleado: string;
  estatus: string;
  puesto: string;
  rol_persona: 'coordinador' | 'gerente' | 'regional';
  pagos_esperados: number;
  pagos_recibidos: number;
  pct_normalidad: number | null;
  comision_cobranza: number;
  num_ejecutivos: number;
  ejecutivos_productivos: number;
  pct_productividad_equipo: number;
  pct_comision_productividad: number;
  comision_productividad: number;
  apoyo_familiar: number;
  comision_modelo_tradicional: number;
  apoyo_economico: number;
  bono_mensual: number;
  comision_mayor: number;
  multas: number;
  prestamo_capital_humano: number;
  prestamo_caja_ahorro: number;
  descuentos_prestamos: number;
  incentivo_final: number;
  retencion_caja_ahorro: number;
  retroactivos_otros_apoyos: number;
  total_a_cobrar: number;
}

export interface DailyRow {
  FECHACORTE: string;
  COD_ASESOR: string;
  ASESOR: string;
  COD_REGIONAL: string;
  REGIONAL: string;
  COD_SUCURSAL: string;
  SUCURSAL: string;
  COORDINADOR: string;
  ESTATUS: string;
  ID_PERIODO: string;
  PERIODO: string;
  MODELO_COMISION_PAGADO: string;
  TIPO_ESQUEMA?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface UserRecord {
  username: string;
  password?: string;
  role: Role;
  nombre: string;
  estado: 'activo' | 'inactivo';
}

export interface ScopeEntry {
  persona: string;
  region: string;
  agencia: string;
}

export interface NormalidadRawRow {
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
}

export interface BackupInfo {
  sheetId: number;
  name: string;
  source: string;
  week: number | '';
  created: string;
  rows: number;
  columns: number;
}

export interface LogEntry {
  fecha_hora: string;
  usuario: string;
  accion: string;
  semana: string;
  corte: string;
  periodo: string;
  archivo: string;
  registros_antes: number;
  registros_nuevos: number;
  resultado: string;
  detalle: string;
  id_operacion: string;
}

export interface DriveSpreadsheet {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface FilterState {
  selectedCortes: number[];
  region: string;
  agencia: string;
  estatus: string;
  ejecutivo: string;
}

export interface MetaRow {
  fecha: string;
  region?: string;
  agencia?: string;
  asesor: string;
  metaH: number;
  metaI: number;
  metaJ: number;
  metaTotal: number;
}

export interface PortalSession {
  username: string;
  role: Role;
  nombre: string;
  googleEmail?: string;
  mode: 'google_workspace' | 'usuario_interno';
}

export interface RawSpreadsheetData {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetMeta: Array<{ sheetId: number; title: string; rowCount: number; columnCount: number; hidden: boolean }>;
  cortes: CorteRow[];
  indicadores: IndicadorRow[];
  ejecutivoCom: ComisionEjecutivoRow[];
  coordinadorCom: DirectorioRow[];
  gerenteCom: DirectorioRow[];
  regionalCom: DirectorioRow[];
  usuarios: UserRecord[];
  scopeEjecutivo: ScopeEntry[];
  scopeCoordinador: ScopeEntry[];
  scopeGerente: ScopeEntry[];
  scopeRegional: ScopeEntry[];
  diariosHeaders: string[];
  diarios: DailyRow[];
  normalidadRaw: NormalidadRawRow[];
  normalidadMeta: {
    headerRow: number;
    headers: string[];
    weeklyHeader: string;
    monthlyHeader: string;
    rawMatrix: (string | number | boolean | null)[][];
    colMap: Record<string, number>;
  } | null;
  backups: BackupInfo[];
  logs: LogEntry[];
  metas?: MetaRow[];
  preScoped?: boolean;
  dailyAvailableDates?: string[];
  dailyHistoryLoaded?: boolean;
  normalidadMonths?: Array<{ key: string; label: string; rows?: number }>;
}

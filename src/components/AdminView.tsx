import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CalendarClock,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  KeyRound,
  LogIn,
  RefreshCw,
  Trash2,
  TrendingUp,
  Upload,
  UserCheck,
  Users,
} from 'lucide-react';
import type { AccessLogEntry, RawSpreadsheetData, Role, UserRecord } from '../types/mcm';
import {
  approvePendingUsersInSheets,
  deleteBackupSheets,
  deleteWeekFromSheets,
  fetchAdminAccessLogs,
  publishDailyToSheets,
  publishNormalidadMonthToSheets,
  publishWeekToSheets,
  resetPasswordInSheets,
  updateUserInSheets,
  type ServerHealthStatus,
} from '../services/sheetsApi';
import {
  detectPendingUsers,
  fmtMoneyCompact,
  fmtNum,
  fmtPct,
  mesLabel,
  parseDailyWorkbookFile,
  parseNormalidadWorkbookFile,
  parseWeeklyWorkbookFile,
  ROLE_LABELS,
  type ParsedDailyWorkbook,
  type ParsedNormalidadWorkbook,
  type ParsedWeeklyWorkbook,
} from '../utils/mcmData';
import {
  exportAccessLogsCSV,
  exportAccessLogsExcel,
  exportActiveUsersExcel,
  exportActiveUsersPDF,
  exportPendingUsersExcel,
  exportPendingUsersPDF,
} from '../utils/exports';
import type { ConfirmDialogState, ToastMessage } from './ConfirmModal';

interface AdminViewProps {
  data: RawSpreadsheetData;
  accessToken: string;
  actor: string;
  serverHealth?: ServerHealthStatus | null;
  onReload: () => Promise<void>;
  onConfirm: (dialog: ConfirmDialogState) => void;
  onToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

type AdminSection =
  | 'semanal'
  | 'diarios'
  | 'normalidad'
  | 'respaldos'
  | 'usuarios'
  | 'accesos'
  | 'log';

export const AdminView: React.FC<AdminViewProps> = ({
  data,
  accessToken,
  actor,
  serverHealth,
  onReload,
  onConfirm,
  onToast,
}) => {
  const [section, setSection] = useState<AdminSection>('semanal');

  // Weekly Upload State
  const [weeklyParsed, setWeeklyParsed] = useState<ParsedWeeklyWorkbook | null>(null);
  const [weeklyScope, setWeeklyScope] = useState<'indicadores' | 'completo'>('completo');
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [deleteWeekTarget, setDeleteWeekTarget] = useState<number>(
    data.cortes[data.cortes.length - 1]?.SEMANA || 0
  );
  const [deleteScope, setDeleteScope] = useState<'indicadores' | 'completo'>('completo');

  // Daily Upload State
  const [dailyParsed, setDailyParsed] = useState<ParsedDailyWorkbook | null>(null);

  // Normalidad Monthly Upload State
  const [nrmParsed, setNrmParsed] = useState<ParsedNormalidadWorkbook | null>(null);
  const [nrmUploadMonth, setNrmUploadMonth] = useState<string>('ALL');

  // Backups State
  const [bkSearch, setBkSearch] = useState('');
  const [selectedBkIds, setSelectedBkIds] = useState<Set<number>>(new Set());

  // Users State
  const [pendingSearch, setPendingSearch] = useState('');
  const [selectedPendingKeys, setSelectedPendingKeys] = useState<Set<string>>(new Set());
  const [createdCredentials, setCreatedCredentials] = useState<
    Array<{ username: string; password: string; role: string; nombre: string }>
  >([]);
  const [activeUserSearch, setActiveUserSearch] = useState('');
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [customPw, setCustomPw] = useState('');

  // Log search
  const [logSearch, setLogSearch] = useState('');

  // Access logs state
  const [accessLogs, setAccessLogs] = useState<AccessLogEntry[]>([]);
  const [accessLogsLoading, setAccessLogsLoading] = useState(false);
  const [accessLogsError, setAccessLogsError] = useState('');
  const [accessSheetsSynced, setAccessSheetsSynced] = useState(false);
  const [accessSearch, setAccessSearch] = useState('');
  const [accessRange, setAccessRange] = useState<'all' | 'today' | '7d'>('all');

  const loadAccessLogs = useCallback(async () => {
    setAccessLogsLoading(true);
    setAccessLogsError('');
    try {
      const res = await fetchAdminAccessLogs(accessToken, data.spreadsheetId);
      setAccessLogs(res.logs);
      setAccessSheetsSynced(res.sheetsSynced);
    } catch (err) {
      setAccessLogsError(
        err instanceof Error ? err.message : 'No se pudo cargar la bitácora de accesos.'
      );
    } finally {
      setAccessLogsLoading(false);
    }
  }, [accessToken, data.spreadsheetId]);

  useEffect(() => {
    if (section === 'accesos') {
      void loadAccessLogs();
    }
  }, [section, loadAccessLogs]);

  const existingTitles = useMemo(
    () => new Set(data.sheetMeta.map((s) => s.title)),
    [data.sheetMeta]
  );

  // Check whether parsed week exists in Sheet
  const weekStatusInSheet = useMemo(() => {
    if (!weeklyParsed) return { hasCorte: false, hasInd: false, hasEj: false };
    const corteRow = data.cortes.find((c) => c.SEMANA === weeklyParsed.week);
    const hasInd = corteRow
      ? data.indicadores.some((r) => r.corte === corteRow.CORTE)
      : false;
    const hasEj = data.ejecutivoCom.some((r) => r.semana === weeklyParsed.week);
    return { hasCorte: Boolean(corteRow), hasInd, hasEj };
  }, [weeklyParsed, data.cortes, data.indicadores, data.ejecutivoCom]);

  // Published Normalidad months in Google Sheet
  const publishedNrmMonths = useMemo(() => {
    const byMonth = new Map<string, { rows: number; weeks: Set<string>; exp: number; rec: number }>();
    data.normalidadRaw.forEach((r) => {
      const cur = byMonth.get(r.monthKey) || { rows: 0, weeks: new Set(), exp: 0, rec: 0 };
      cur.rows++;
      cur.weeks.add(r.date);
      cur.exp += r.esp;
      cur.rec += r.rec;
      byMonth.set(r.monthKey, cur);
    });
    return Array.from(byMonth.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, info]) => ({
        month,
        rows: info.rows,
        weeks: Array.from(info.weeks).sort(),
        normality: info.exp > 0 ? info.rec / info.exp : 0,
      }));
  }, [data.normalidadRaw]);

  // Pending Users Detection
  const pendingResult = useMemo(
    () =>
      detectPendingUsers(
        data.usuarios,
        data.cortes,
        data.ejecutivoCom,
        data.coordinadorCom,
        data.gerenteCom,
        data.regionalCom,
        data.diarios
      ),
    [data]
  );

  const filteredPending = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();
    return pendingResult.pending.filter((p) => {
      if (!q) return true;
      return (
        p.nombre.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.scopes.some((s) => `${s.region} ${s.agencia}`.toLowerCase().includes(q))
      );
    });
  }, [pendingResult.pending, pendingSearch]);

  const filteredUsers = useMemo(() => {
    const q = activeUserSearch.trim().toLowerCase();
    return data.usuarios.filter((u) => {
      if (!q) return true;
      return (
        u.nombre.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [data.usuarios, activeUserSearch]);

  const filteredBackups = useMemo(() => {
    const q = bkSearch.trim().toLowerCase();
    return data.backups.filter((b) => {
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        b.source.toLowerCase().includes(q) ||
        String(b.week).includes(q)
      );
    });
  }, [data.backups, bkSearch]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return data.logs.filter((l) => {
      if (!q) return true;
      return (
        l.accion.toLowerCase().includes(q) ||
        l.usuario.toLowerCase().includes(q) ||
        l.detalle.toLowerCase().includes(q) ||
        l.archivo.toLowerCase().includes(q)
      );
    });
  }, [data.logs, logSearch]);

  const mxDayKey = (isoOrDate: Date | string) => {
    try {
      const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
      if (Number.isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    } catch {
      return '';
    }
  };

  const todayMxKey = mxDayKey(new Date());

  const accessSummary = useMemo(() => {
    const todayEntries = accessLogs.filter((l) => mxDayKey(l.timestamp) === todayMxKey);
    const uniqueToday = new Set(todayEntries.map((l) => l.usuario.toLowerCase())).size;
    return {
      total: accessLogs.length,
      todayCount: todayEntries.length,
      uniqueToday,
      latest: accessLogs[0] || null,
    };
  }, [accessLogs, todayMxKey]);

  const filteredAccessLogs = useMemo(() => {
    const q = accessSearch.trim().toLowerCase();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return accessLogs.filter((l) => {
      if (accessRange === 'today' && mxDayKey(l.timestamp) !== todayMxKey) return false;
      if (accessRange === '7d') {
        const ts = Date.parse(l.timestamp);
        if (!Number.isNaN(ts) && ts < sevenDaysAgo) return false;
      }
      if (!q) return true;
      const rolLabel = ROLE_LABELS[l.rol as Role] || l.rol;
      return (
        l.nombre.toLowerCase().includes(q) ||
        l.usuario.toLowerCase().includes(q) ||
        l.rol.toLowerCase().includes(q) ||
        rolLabel.toLowerCase().includes(q) ||
        l.metodo.toLowerCase().includes(q) ||
        l.origen.toLowerCase().includes(q) ||
        l.fecha_hora.toLowerCase().includes(q)
      );
    });
  }, [accessLogs, accessRange, accessSearch, todayMxKey]);

  /* ==================== HANDLERS ==================== */

  const handleWeeklyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setWeeklyBusy(true);
    try {
      const parsed = await parseWeeklyWorkbookFile(file);
      setWeeklyParsed(parsed);
      onToast({
        type: 'info',
        title: `Archivo Semana ${parsed.week} analizado`,
        detail: `${parsed.indicadoresRows.length} ejecutivos en INDICADORES`,
      });
    } catch (err) {
      onToast({
        type: 'error',
        title: 'Error leyendo archivo semanal',
        detail: err instanceof Error ? err.message : 'Formato inválido',
      });
    } finally {
      setWeeklyBusy(false);
      e.target.value = '';
    }
  };

  const triggerPublishWeek = (mode: 'add' | 'replace') => {
    if (!weeklyParsed) return;
    onConfirm({
      title:
        mode === 'add'
          ? `Agregar Semana ${weeklyParsed.week}`
          : `Reemplazar Semana ${weeklyParsed.week}`,
      description:
        mode === 'replace'
          ? 'Se creará un respaldo automático BK_ADMIN_* de las filas existentes antes de reemplazar.'
          : 'Se insertarán los registros nuevos en Google Sheets.',
      tone: mode === 'replace' ? 'warning' : 'primary',
      confirmLabel: mode === 'add' ? 'Agregar ahora' : 'Reemplazar con respaldo',
      details: [
        `Archivo: ${weeklyParsed.fileName}`,
        `Alcance: ${weeklyScope === 'completo' ? 'Semana Completa (Indicadores + Comisiones)' : 'Solo Indicadores'}`,
        `Ejecutivos en INDICADORES: ${weeklyParsed.indicadoresRows.length}`,
        `Comisiones Ejecutivo: ${weeklyParsed.ejecutivoRows.length}`,
      ],
      onConfirm: async () => {
        try {
          const res = await publishWeekToSheets(
            accessToken,
            data.spreadsheetId,
            new Set(existingTitles),
            weeklyParsed,
            weeklyScope,
            mode,
            actor
          );
          onToast({
            type: 'success',
            title: `Semana ${weeklyParsed.week} publicada`,
            detail: `Corte ${res.corte} · ${Object.entries(res.detalles)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')}`,
          });
          setWeeklyParsed(null);
          await onReload();
        } catch (err) {
          onToast({
            type: 'error',
            title: 'Error al publicar semana',
            detail: err instanceof Error ? err.message : 'Error en Google Sheets',
          });
        }
      },
    });
  };

  const triggerDeleteWeek = () => {
    const corteRow = data.cortes.find((c) => c.SEMANA === deleteWeekTarget);
    if (!corteRow) return;
    onConfirm({
      title: `Eliminar Semana ${deleteWeekTarget}`,
      description:
        'Se generará una pestaña de respaldo BK_ADMIN_* con los datos retirados y se actualizará Google Sheets.',
      tone: 'danger',
      confirmLabel: 'Eliminar con respaldo',
      details: [
        `Semana ${corteRow.SEMANA} (Corte ${corteRow.CORTE} · ${corteRow.PERIODO})`,
        `Alcance: ${deleteScope === 'completo' ? 'Semana Completa' : 'Solo Indicadores'}`,
      ],
      onConfirm: async () => {
        try {
          const res = await deleteWeekFromSheets(
            accessToken,
            data.spreadsheetId,
            new Set(existingTitles),
            corteRow.SEMANA,
            corteRow.CORTE,
            corteRow.PERIODO,
            deleteScope,
            actor
          );
          onToast({
            type: 'success',
            title: `Semana ${corteRow.SEMANA} eliminada`,
            detail: Object.entries(res)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · '),
          });
          await onReload();
        } catch (err) {
          onToast({
            type: 'error',
            title: 'No se pudo eliminar',
            detail: err instanceof Error ? err.message : 'Error de escritura',
          });
        }
      },
    });
  };

  const handleDailyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseDailyWorkbookFile(file);
      setDailyParsed(parsed);
      onToast({
        type: 'info',
        title: 'Archivo diario validado',
        detail: `${parsed.totalRows} filas · ${parsed.dates.length} fechas`,
      });
    } catch (err) {
      onToast({
        type: 'error',
        title: 'Archivo diario inválido',
        detail: err instanceof Error ? err.message : 'Error leyendo archivo',
      });
    } finally {
      e.target.value = '';
    }
  };

  const triggerPublishDaily = () => {
    if (!dailyParsed) return;
    onConfirm({
      title: 'Publicar Indicadores Diarios',
      description:
        'Reemplazará el contenido de INDICADORES_DIARIOS previo respaldo automático BK_ADMIN_DIARIOS_*.',
      tone: 'warning',
      confirmLabel: 'Publicar diarios',
      details: [
        `Archivo: ${dailyParsed.fileName}`,
        `Filas válidas: ${dailyParsed.totalRows}`,
        `Rango fechas: ${dailyParsed.dates[0]} → ${dailyParsed.dates[dailyParsed.dates.length - 1]}`,
      ],
      onConfirm: async () => {
        try {
          const res = await publishDailyToSheets(
            accessToken,
            data.spreadsheetId,
            new Set(existingTitles),
            dailyParsed,
            actor
          );
          onToast({
            type: 'success',
            title: 'Indicadores Diarios actualizados',
            detail: `${res.rowsWritten} filas publicadas${res.backupName ? ` · Respaldo ${res.backupName}` : ''}`,
          });
          setDailyParsed(null);
          await onReload();
        } catch (err) {
          onToast({
            type: 'error',
            title: 'Error publicando diarios',
            detail: err instanceof Error ? err.message : 'Error',
          });
        }
      },
    });
  };

  const handleNormalidadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseNormalidadWorkbookFile(file);
      setNrmParsed(parsed);
      setNrmUploadMonth(parsed.months[parsed.months.length - 1]?.month || 'ALL');
      onToast({
        type: 'info',
        title: 'Hoja NORMALIDAD procesada',
        detail: `${parsed.rows.length} filas en ${parsed.months.length} mes(es)`,
      });
    } catch (err) {
      onToast({
        type: 'error',
        title: 'Error leyendo NORMALIDAD',
        detail: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      e.target.value = '';
    }
  };

  const triggerPublishNormalidad = () => {
    if (!nrmParsed) return;
    const monthsToPush =
      nrmUploadMonth === 'ALL'
        ? nrmParsed.months.map((m) => m.month)
        : [nrmUploadMonth];

    onConfirm({
      title: 'Publicar Reporte Mensual (NORMALIDAD)',
      description:
        'Los meses seleccionados reemplazarán únicamente las filas de ese mes en Google Sheets, creando respaldo si ya existían.',
      tone: 'primary',
      confirmLabel: 'Publicar en NORMALIDAD',
      details: monthsToPush.map((mk) => `${mesLabel(mk)}: ${nrmParsed.byMonth[mk]?.length || 0} filas`),
      onConfirm: async () => {
        try {
          const titles = new Set(existingTitles);
          for (const mk of monthsToPush) {
            await publishNormalidadMonthToSheets(
              accessToken,
              data.spreadsheetId,
              titles,
              mk,
              nrmParsed.byMonth[mk] || [],
              actor
            );
          }
          onToast({
            type: 'success',
            title: 'Mes(es) publicados en NORMALIDAD',
            detail: monthsToPush.map(mesLabel).join(', '),
          });
          setNrmParsed(null);
          await onReload();
        } catch (err) {
          onToast({
            type: 'error',
            title: 'Error publicando NORMALIDAD',
            detail: err instanceof Error ? err.message : 'Error',
          });
        }
      },
    });
  };

  const triggerRemoveNormalidadMonth = (monthKey: string) => {
    onConfirm({
      title: `Retirar mes ${mesLabel(monthKey)}`,
      description:
        'Se eliminarán las filas de ese mes de NORMALIDAD y se guardará respaldo BK_ADMIN_NORMALIDAD_*.',
      tone: 'danger',
      confirmLabel: 'Retirar mes',
      onConfirm: async () => {
        try {
          const res = await publishNormalidadMonthToSheets(
            accessToken,
            data.spreadsheetId,
            new Set(existingTitles),
            monthKey,
            [],
            actor
          );
          onToast({
            type: 'success',
            title: `Mes ${mesLabel(monthKey)} retirado`,
            detail: `${res.removed} filas respaldadas en ${res.backup}`,
          });
          await onReload();
        } catch (err) {
          onToast({
            type: 'error',
            title: 'Error retirando mes',
            detail: err instanceof Error ? err.message : 'Error',
          });
        }
      },
    });
  };

  const triggerDeleteBackups = () => {
    const selected = data.backups.filter((b) => selectedBkIds.has(b.sheetId));
    if (!selected.length) return;
    onConfirm({
      title: `Eliminar ${selected.length} respaldo(s) BK_ADMIN`,
      description: 'Esta acción elimina permanentemente las pestañas de respaldo seleccionadas.',
      tone: 'danger',
      confirmLabel: 'Eliminar respaldos',
      details: selected.slice(0, 8).map((b) => `${b.name} (${fmtNum(b.rows)} filas)`),
      onConfirm: async () => {
        try {
          const n = await deleteBackupSheets(
            accessToken,
            data.spreadsheetId,
            new Set(existingTitles),
            selected,
            actor
          );
          setSelectedBkIds(new Set());
          onToast({
            type: 'success',
            title: `${n} respaldo(s) eliminados`,
          });
          await onReload();
        } catch (err) {
          onToast({
            type: 'error',
            title: 'Error eliminando respaldos',
            detail: err instanceof Error ? err.message : 'Error',
          });
        }
      },
    });
  };

  const triggerApprovePending = () => {
    const selected = pendingResult.pending.filter((p) =>
      selectedPendingKeys.has(`${p.role}|${p.nombre}`)
    );
    if (!selected.length) return;
    onConfirm({
      title: `Autorizar ${selected.length} usuario(s) en USUARIOS`,
      description:
        'Se generará username, contraseña temporal y alcance automático en las hojas SCOPE_*.',
      tone: 'primary',
      confirmLabel: 'Autorizar usuarios',
      details: selected.slice(0, 8).map((p) => `${p.nombre} (${ROLE_LABELS[p.role]})`),
      onConfirm: async () => {
        try {
          const created = await approvePendingUsersInSheets(
            accessToken,
            data.spreadsheetId,
            new Set(existingTitles),
            selected,
            actor
          );
          setCreatedCredentials(created);
          setSelectedPendingKeys(new Set());
          onToast({
            type: 'success',
            title: `${created.length} usuario(s) autorizados`,
          });
          await onReload();
        } catch (err) {
          onToast({
            type: 'error',
            title: 'Error autorizando usuarios',
            detail: err instanceof Error ? err.message : 'Error',
          });
        }
      },
    });
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-wrap gap-1">
        {[
          { id: 'semanal' as const, label: 'Carga Semanal', icon: Upload },
          { id: 'diarios' as const, label: 'Indicadores Diarios', icon: CalendarClock },
          { id: 'normalidad' as const, label: 'Reportes Mensuales', icon: TrendingUp },
          { id: 'respaldos' as const, label: `Respaldos (${data.backups.length})`, icon: Archive },
          {
            id: 'usuarios' as const,
            label: `Usuarios (${pendingResult.pending.length} pend.)`,
            icon: Users,
          },
          { id: 'accesos' as const, label: 'Accesos', icon: LogIn },
          { id: 'log' as const, label: 'Bitácora', icon: History },
        ].map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* SECTION 1: CARGA SEMANAL */}
      {section === 'semanal' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Publicar Archivo Semanal (.xlsb / .xlsx)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Lee INDICADORES y pestañas de comisiones, sincroniza CORTES y respalda datos previos.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer shrink-0">
                <Upload className="w-3.5 h-3.5" />
                {weeklyBusy ? 'Leyendo...' : 'Seleccionar Excel'}
                <input
                  type="file"
                  accept=".xlsb,.xlsx,.xlsm"
                  className="hidden"
                  onChange={handleWeeklyFile}
                />
              </label>
            </div>

            {weeklyParsed ? (
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-bold text-slate-900">
                      Semana {weeklyParsed.week}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">{weeklyParsed.fileName}</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${
                      weekStatusInSheet.hasInd || weekStatusInSheet.hasEj
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    }`}
                  >
                    {weekStatusInSheet.hasInd || weekStatusInSheet.hasEj
                      ? 'Ya existe en Google Sheet'
                      : 'Semana nueva'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <p className="text-slate-500">Ejecutivos Ind.</p>
                    <p className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                      {fmtNum(weeklyParsed.indicadoresRows.length)}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <p className="text-slate-500">Com. Ejecutivo</p>
                    <p className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                      {fmtNum(weeklyParsed.ejecutivoRows.length)}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <p className="text-slate-500">Total a Cobrar Ej.</p>
                    <p className="text-base font-bold text-emerald-700 tabular-nums mt-0.5">
                      {fmtMoneyCompact(weeklyParsed.summary.ejecutivoTotalCobrar)}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <p className="text-slate-500">Dir. (C / G / R)</p>
                    <p className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                      {weeklyParsed.coordinadorRows.length} / {weeklyParsed.gerenteRows.length} /{' '}
                      {weeklyParsed.regionalRows.length}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                  <div className="flex items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        checked={weeklyScope === 'indicadores'}
                        onChange={() => setWeeklyScope('indicadores')}
                      />
                      Solo Indicadores
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="radio"
                        checked={weeklyScope === 'completo'}
                        onChange={() => setWeeklyScope('completo')}
                      />
                      Semana Completa (Ind + Comisiones)
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={weekStatusInSheet.hasInd || weekStatusInSheet.hasEj}
                      onClick={() => triggerPublishWeek('add')}
                      className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"
                    >
                      Agregar semana
                    </button>
                    <button
                      type="button"
                      disabled={!weekStatusInSheet.hasInd && !weekStatusInSheet.hasEj}
                      onClick={() => triggerPublishWeek('replace')}
                      className="px-3.5 py-2 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40"
                    >
                      Reemplazar semana
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-slate-200 rounded-xl py-10 text-center text-xs text-slate-500">
                Selecciona un archivo `.xlsb` o `.xlsx` semanal para validar sus pestañas y métricas antes de escribir en Google Sheets.
              </div>
            )}
          </div>

          {/* Delete Week Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Eliminar Semana</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Genera respaldo BK_ADMIN_* antes de retirar los registros de Google Sheets.
              </p>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Semana</label>
                <select
                  value={deleteWeekTarget}
                  onChange={(e) => setDeleteWeekTarget(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                >
                  {[...data.cortes].reverse().map((c) => (
                    <option key={c.CORTE} value={c.SEMANA}>
                      Semana {c.SEMANA} · {c.PERIODO}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Alcance</label>
                <select
                  value={deleteScope}
                  onChange={(e) =>
                    setDeleteScope(e.target.value as 'indicadores' | 'completo')
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="completo">Semana Completa (Ind + Comisiones)</option>
                  <option value="indicadores">Solo Indicadores</option>
                </select>
              </div>
              <button
                type="button"
                disabled={!deleteWeekTarget}
                onClick={triggerDeleteWeek}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar semana seleccionada
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: INDICADORES DIARIOS */}
      {section === 'diarios' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Publicar Indicadores Diarios (INDICADORES_DIARIOS)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Actualmente hay {fmtNum(data.diarios.length)} filas cargadas en Google Sheets.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Cargar archivo diario (.xlsx)
              <input type="file" accept=".xlsx,.xlsb,.xls" className="hidden" onChange={handleDailyFile} />
            </label>
          </div>

          {dailyParsed && (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900">{dailyParsed.fileName}</span>
                <span className="text-slate-600 tabular-nums">
                  {fmtNum(dailyParsed.totalRows)} filas · {dailyParsed.dates.length} fechas (
                  {dailyParsed.dates[0]} a {dailyParsed.dates[dailyParsed.dates.length - 1]})
                </span>
              </div>
              <button
                type="button"
                onClick={triggerPublishDaily}
                className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
              >
                Publicar en INDICADORES_DIARIOS (con respaldo)
              </button>
            </div>
          )}

          {/* Scope Diagnostic Summary */}
          <div className="pt-4 border-t border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Diagnóstico de Scopes en Google Sheets
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'SCOPE_EJECUTIVO', count: data.scopeEjecutivo.length },
                { label: 'SCOPE_COORDINADOR', count: data.scopeCoordinador.length },
                { label: 'SCOPE_GERENTE', count: data.scopeGerente.length },
                { label: 'SCOPE_REGIONAL', count: data.scopeRegional.length },
              ].map((s) => (
                <div key={s.label} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="font-mono text-[11px] text-slate-500">{s.label}</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {fmtNum(s.count)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: REPORTES MENSUALES (NORMALIDAD) */}
      {section === 'normalidad' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Publicar Hoja NORMALIDAD
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sube un archivo `.xlsb` o `.xlsx` que incluya la pestaña NORMALIDAD.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer shrink-0">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Elegir archivo
                <input
                  type="file"
                  accept=".xlsb,.xlsx,.xlsm"
                  className="hidden"
                  onChange={handleNormalidadFile}
                />
              </label>
            </div>

            {nrmParsed && (
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3 text-xs">
                <p className="font-semibold text-slate-900">
                  {nrmParsed.fileName} · {fmtNum(nrmParsed.rows.length)} filas detectadas
                </p>
                <div className="space-y-1.5">
                  {nrmParsed.months.map((m) => (
                    <div
                      key={m.month}
                      className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200"
                    >
                      <span className="font-semibold text-slate-800">{mesLabel(m.month)}</span>
                      <span className="text-slate-600 tabular-nums">
                        {m.weeks.length} sem · {fmtPct(m.total.normality)} · {fmtNum(m.rows)} filas
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <select
                    value={nrmUploadMonth}
                    onChange={(e) => setNrmUploadMonth(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg bg-white flex-1"
                  >
                    <option value="ALL">Todos los meses detectados ({nrmParsed.months.length})</option>
                    {nrmParsed.months.map((m) => (
                      <option key={m.month} value={m.month}>
                        Solo {mesLabel(m.month)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={triggerPublishNormalidad}
                    className="px-4 py-2 font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                  >
                    Publicar en NORMALIDAD
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Meses Publicados Actualmente en Google Sheets
            </h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {publishedNrmMonths.map((m) => (
                <div
                  key={m.month}
                  className="px-4 py-3 flex items-center justify-between gap-2 text-xs bg-white"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{mesLabel(m.month)}</p>
                    <p className="text-slate-500 tabular-nums">
                      {m.weeks.length} cortes semanales · {fmtNum(m.rows)} filas ·{' '}
                      {fmtPct(m.normality)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerRemoveNormalidadMonth(m.month)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Retirar
                  </button>
                </div>
              ))}
              {publishedNrmMonths.length === 0 && (
                <p className="py-8 text-center text-xs text-slate-500">
                  No hay meses publicados en la hoja NORMALIDAD.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: RESPALDOS BK_ADMIN */}
      {section === 'respaldos' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={bkSearch}
                onChange={(e) => setBkSearch(e.target.value)}
                placeholder="Filtrar respaldos por hoja o semana..."
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
              />
            </div>
            <button
              type="button"
              disabled={selectedBkIds.size === 0}
              onClick={triggerDeleteBackups}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Eliminar seleccionados ({selectedBkIds.size})
            </button>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
                <tr>
                  <th className="py-2.5 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={
                        filteredBackups.length > 0 &&
                        filteredBackups.every((b) => selectedBkIds.has(b.sheetId))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedBkIds(new Set(filteredBackups.map((b) => b.sheetId)));
                        } else {
                          setSelectedBkIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="py-2.5 px-3">Pestaña de Respaldo</th>
                  <th className="py-2.5 px-3">Origen</th>
                  <th className="py-2.5 px-3">Semana</th>
                  <th className="py-2.5 px-3">Fecha Creación</th>
                  <th className="py-2.5 px-3 text-right">Filas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredBackups.map((b) => (
                  <tr key={b.sheetId} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <input
                        type="checkbox"
                        checked={selectedBkIds.has(b.sheetId)}
                        onChange={() => {
                          setSelectedBkIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(b.sheetId)) next.delete(b.sheetId);
                            else next.add(b.sheetId);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-900">{b.name}</td>
                    <td className="py-2.5 px-3 text-slate-600">{b.source || '—'}</td>
                    <td className="py-2.5 px-3 text-slate-700">{b.week ? `Sem ${b.week}` : '—'}</td>
                    <td className="py-2.5 px-3 text-slate-500">{b.created || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{fmtNum(b.rows)}</td>
                  </tr>
                ))}
                {filteredBackups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No hay respaldos BK_ADMIN_* registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 5: USUARIOS */}
      {section === 'usuarios' && (
        <div className="space-y-5">
          {/* Unattended Link-Only USUARIOS Access Status Card */}
          <div
            className={`rounded-xl border p-4 text-xs space-y-2 ${
              serverHealth?.serviceAccountConfigured || serverHealth?.appsScriptConfigured
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : serverHealth?.adminBridgeActive
                ? 'bg-blue-50 border-blue-200 text-blue-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-sm">
                Acceso por Link con Usuario y Contraseña (hoja USUARIOS)
              </p>
              <span className="px-2.5 py-0.5 rounded font-semibold bg-white/80 border border-current/20">
                {serverHealth?.serviceAccountConfigured
                  ? 'Activo 24/7 (Service Account)'
                  : serverHealth?.appsScriptConfigured
                  ? 'Activo 24/7 (Apps Script Web App)'
                  : serverHealth?.adminBridgeActive
                  ? 'Puente temporal activo (~55 min)'
                  : 'Pendiente de conexión'}
              </span>
            </div>
            {serverHealth?.serviceAccountConfigured ? (
              <p>
                Cualquier ejecutivo, coordinador, gerente, regional o directivo puede abrir el link e ingresar directo con su usuario y contraseña de <strong>USUARIOS</strong>
                {serverHealth.serviceAccountEmail ? (
                  <>
                    {' '}
                    (cuenta de lectura:{' '}
                    <code className="font-mono bg-white/70 px-1.5 py-0.5 rounded">
                      {serverHealth.serviceAccountEmail}
                    </code>
                    ).
                  </>
                ) : (
                  '.'
                )}
              </p>
            ) : serverHealth?.appsScriptConfigured ? (
              <p>
                Listo para compartir el link: cualquier ejecutivo, coordinador, gerente, regional o directivo puede entrar 24/7 desde <strong>Usuario McM</strong> con su usuario y contraseña de la hoja <strong>USUARIOS</strong> mediante la Web App de Apps Script conectada (sin archivo JSON ni Secrets).
              </p>
            ) : (
              <div className="space-y-1.5">
                <p>
                  {serverHealth?.adminBridgeActive
                    ? 'Actualmente tus usuarios pueden entrar solo con usuario y contraseña mientras tu sesión de Administrador esté activa (~55 min).'
                    : 'Conecta primero como Administrador Google o configura la Web App de Apps Script para habilitar el acceso por link 24/7.'}
                </p>
              </div>
            )}
          </div>

          {createdCredentials.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Credenciales Temporales Generadas
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                {createdCredentials.map((c) => (
                  <div
                    key={c.username}
                    className="bg-white border border-emerald-200 rounded-lg p-2.5"
                  >
                    <p className="font-semibold text-slate-900">{c.nombre}</p>
                    <p className="font-mono text-slate-600 mt-0.5">
                      Usuario: <strong>{c.username}</strong> · Clave: <strong>{c.password}</strong>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Users */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Pendientes de Autorización (Semana {pendingResult.semanaActual})
                </h3>
                <p className="text-xs text-slate-500">
                  Personal detectado en comisiones o cortes diarios aún sin alta en USUARIOS.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  placeholder="Buscar pendiente..."
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => exportPendingUsersExcel(filteredPending)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => exportPendingUsersPDF(filteredPending)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <FileText className="w-3.5 h-3.5 text-red-600" />
                  PDF
                </button>
                <button
                  type="button"
                  disabled={selectedPendingKeys.size === 0}
                  onClick={triggerApprovePending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Autorizar ({selectedPendingKeys.size})
                </button>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="py-2 px-3 w-10">
                      <input
                        type="checkbox"
                        checked={
                          filteredPending.length > 0 &&
                          filteredPending.every((p) =>
                            selectedPendingKeys.has(`${p.role}|${p.nombre}`)
                          )
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPendingKeys(
                              new Set(filteredPending.map((p) => `${p.role}|${p.nombre}`))
                            );
                          } else {
                            setSelectedPendingKeys(new Set());
                          }
                        }}
                      />
                    </th>
                    <th className="py-2 px-3">Nombre</th>
                    <th className="py-2 px-3">Rol Detectado</th>
                    <th className="py-2 px-3">Alcance (Región / Agencia)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPending.map((p) => {
                    const key = `${p.role}|${p.nombre}`;
                    return (
                      <tr key={key} className="hover:bg-slate-50">
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={selectedPendingKeys.has(key)}
                            onChange={() => {
                              setSelectedPendingKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-900">{p.nombre}</td>
                        <td className="py-2 px-3 text-slate-600">{ROLE_LABELS[p.role]}</td>
                        <td className="py-2 px-3 text-slate-500">
                          {p.scopes
                            .map((s) => (s.agencia ? `${s.region} / ${s.agencia}` : s.region))
                            .join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredPending.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500">
                        Sin usuarios pendientes por autorizar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Active Users */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Directorio de Usuarios ({data.usuarios.length})
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={activeUserSearch}
                  onChange={(e) => setActiveUserSearch(e.target.value)}
                  placeholder="Buscar usuario o nombre..."
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => exportActiveUsersExcel(filteredUsers)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => exportActiveUsersPDF(filteredUsers)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <FileText className="w-3.5 h-3.5 text-red-600" />
                  PDF
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3">Nombre</th>
                    <th className="py-2.5 px-3">Usuario</th>
                    <th className="py-2.5 px-3">Rol</th>
                    <th className="py-2.5 px-3">Estado</th>
                    <th className="py-2.5 px-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.slice(0, 100).map((u) => (
                    <tr key={u.username} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-semibold text-slate-900">{u.nombre}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{u.username}</td>
                      <td className="py-2 px-3">
                        <select
                          value={u.role}
                          onChange={(e) => {
                            const nextRole = e.target.value as Role;
                            onConfirm({
                              title: `Cambiar rol de ${u.nombre}`,
                              description: `Se actualizará el rol a ${ROLE_LABELS[nextRole]} en la hoja USUARIOS.`,
                              confirmLabel: 'Guardar rol',
                              onConfirm: async () => {
                                await updateUserInSheets(
                                  accessToken,
                                  data.spreadsheetId,
                                  new Set(existingTitles),
                                  u.username,
                                  nextRole,
                                  u.estado,
                                  pendingResult.pending,
                                  actor
                                );
                                onToast({ type: 'success', title: 'Usuario actualizado' });
                                await onReload();
                              },
                            });
                          }}
                          className="px-2 py-1 border border-slate-200 rounded bg-white text-xs"
                        >
                          {(Object.keys(ROLE_LABELS) as Role[]).map((rk) => (
                            <option key={rk} value={rk}>
                              {ROLE_LABELS[rk]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <button
                          type="button"
                          onClick={() => {
                            const nextEstado = u.estado === 'activo' ? 'inactivo' : 'activo';
                            onConfirm({
                              title: `${nextEstado === 'activo' ? 'Activar' : 'Desactivar'} usuario`,
                              description: `${u.nombre} pasará a estado ${nextEstado}.`,
                              tone: nextEstado === 'inactivo' ? 'warning' : 'primary',
                              confirmLabel: 'Confirmar cambio',
                              onConfirm: async () => {
                                await updateUserInSheets(
                                  accessToken,
                                  data.spreadsheetId,
                                  new Set(existingTitles),
                                  u.username,
                                  u.role,
                                  nextEstado,
                                  pendingResult.pending,
                                  actor
                                );
                                onToast({ type: 'success', title: `Estado cambiado a ${nextEstado}` });
                                await onReload();
                              },
                            });
                          }}
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${
                            u.estado === 'activo'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {u.estado}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(u);
                            setCustomPw('');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                        >
                          <KeyRound className="w-3 h-3" />
                          Reset clave
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {resetTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-900">
                  Restablecer contraseña · {resetTarget.nombre}
                </h3>
                <p className="text-xs text-slate-500">
                  Deja vacío para generar automáticamente una contraseña temporal `mcm######`, o escribe una clave mínima de 6 caracteres.
                </p>
                <input
                  type="text"
                  value={customPw}
                  onChange={(e) => setCustomPw(e.target.value)}
                  placeholder="Nueva contraseña (opcional)"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setResetTarget(null)}
                    className="px-3.5 py-2 text-xs font-medium border border-slate-200 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const pw = await resetPasswordInSheets(
                          accessToken,
                          data.spreadsheetId,
                          new Set(existingTitles),
                          resetTarget.username,
                          customPw,
                          actor
                        );
                        setResetTarget(null);
                        onToast({
                          type: 'success',
                          title: `Clave actualizada para ${resetTarget.username}`,
                          detail: `Nueva contraseña: ${pw}`,
                        });
                        await onReload();
                      } catch (err) {
                        onToast({
                          type: 'error',
                          title: 'Error restableciendo clave',
                          detail: err instanceof Error ? err.message : 'Error',
                        });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Guardar nueva clave
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 6: BITACORA DE ACCESOS */}
      {section === 'accesos' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Accesos Registrados
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {fmtNum(accessSummary.total)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Ingresos Hoy (CDMX)
              </p>
              <p className="text-2xl font-bold text-blue-600 mt-1 tabular-nums">
                {fmtNum(accessSummary.todayCount)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Usuarios Únicos Hoy
              </p>
              <p className="text-2xl font-bold text-emerald-600 mt-1 tabular-nums">
                {fmtNum(accessSummary.uniqueToday)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Último Ingreso
              </p>
              <p className="text-xs font-semibold text-slate-900 mt-1 truncate">
                {accessSummary.latest ? accessSummary.latest.nombre : 'Sin registros'}
              </p>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                {accessSummary.latest ? accessSummary.latest.fecha_hora : '—'}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Bitácora de Accesos ({fmtNum(filteredAccessLogs.length)})
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {accessSheetsSynced
                    ? 'Sincronizado con la pestaña LOG_ACCESOS de Google Sheets y respaldado en servidor.'
                    : 'Guardado en servidor (.cache/access-logs.json). Para crear y sincronizar la pestaña LOG_ACCESOS en Google Sheets, configura GOOGLE_SERVICE_ACCOUNT_JSON o inicia sesión con Google Workspace.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                  {(
                    [
                      { id: 'all', label: 'Todos' },
                      { id: 'today', label: 'Hoy' },
                      { id: '7d', label: '7 días' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAccessRange(opt.id)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                        accessRange === opt.id
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={accessSearch}
                  onChange={(e) => setAccessSearch(e.target.value)}
                  placeholder="Buscar nombre, usuario o rol..."
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => void loadAccessLogs()}
                  disabled={accessLogsLoading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${accessLogsLoading ? 'animate-spin' : ''}`} />
                  Actualizar
                </button>
                <button
                  type="button"
                  onClick={() => exportAccessLogsExcel(filteredAccessLogs)}
                  disabled={filteredAccessLogs.length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => exportAccessLogsCSV(filteredAccessLogs)}
                  disabled={filteredAccessLogs.length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </button>
              </div>
            </div>

            {accessLogsError && (
              <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-700">
                {accessLogsError}
              </div>
            )}

            <div className="overflow-x-auto max-h-[28rem]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3">Fecha y Hora (CDMX)</th>
                    <th className="py-2.5 px-3">Nombre</th>
                    <th className="py-2.5 px-3">Usuario</th>
                    <th className="py-2.5 px-3">Rol</th>
                    <th className="py-2.5 px-3">Método / Origen</th>
                    <th className="py-2.5 px-3">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAccessLogs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {l.fecha_hora}
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-900">{l.nombre}</td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-600">{l.usuario}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-slate-100 text-slate-700">
                          {ROLE_LABELS[l.rol as Role] || l.rol}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-600">
                        {l.metodo} · <span className="text-slate-400">{l.origen}</span>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                        {l.ip || '—'}
                      </td>
                    </tr>
                  ))}
                  {filteredAccessLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        {accessLogsLoading
                          ? 'Cargando bitácora de accesos...'
                          : 'Sin registros de acceso todavía.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 7: BITACORA LOG */}
      {section === 'log' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Bitácora de Operaciones (LOG_ACTUALIZACIONES)
            </h3>
            <input
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Filtrar acción, usuario o detalle..."
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
            />
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
                <tr>
                  <th className="py-2.5 px-3">Fecha / Hora</th>
                  <th className="py-2.5 px-3">Usuario</th>
                  <th className="py-2.5 px-3">Acción</th>
                  <th className="py-2.5 px-3">Archivo / Semana</th>
                  <th className="py-2.5 px-3">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((l, idx) => (
                  <tr key={`${l.id_operacion}-${idx}`} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {l.fecha_hora}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-800">{l.usuario}</td>
                    <td className="py-2 px-3 font-semibold text-blue-700">{l.accion}</td>
                    <td className="py-2 px-3 text-slate-600">
                      {l.semana ? `Sem ${l.semana}` : ''} {l.archivo}
                    </td>
                    <td className="py-2 px-3 text-slate-600">{l.detalle}</td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Sin registros en LOG_ACTUALIZACIONES.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

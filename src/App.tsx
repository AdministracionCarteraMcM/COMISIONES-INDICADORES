import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderSync,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type {
  ActiveTab,
  FilterState,
  PortalSession,
  RawSpreadsheetData,
  Role,
} from './types/mcm';
import {
  clearCachedAccessToken,
  formatGoogleAuthError,
  getCachedAccessToken,
  signInWithGoogleGIS,
  signInWithGoogleWorkspace,
  signOutGoogleWorkspace,
  subscribeAuthState,
} from './services/googleAuth';
import {
  DEFAULT_SPREADSHEET_ID,
  fetchPortalAdminExtras,
  fetchPortalDaily,
  fetchPortalNormalidad,
  fetchScopedPortalData,
  fetchServerHealth,
  getMcMSessionToken,
  loginWithCredentials,
  loginWithGoogleToken,
  logoutPortalSession,
  setMcMSessionToken,
  type ServerHealthStatus,
} from './services/sheetsApi';
import {
  dailyDateKey,
  dailyRegionScopeKey,
  normText,
  personKey,
  regionDisplayName,
  regionMatchesFilter,
  scopeDailyRows,
  scopeDirectorioRows,
  scopeRoleScopes,
  scopeWeeklyRows,
} from './utils/mcmData';
import {
  ConfirmModal,
  ToastStack,
  type ConfirmDialogState,
  type ToastMessage,
} from './components/ConfirmModal';
import { DriveSheetModal } from './components/DriveSheetModal';
import { Layout } from './components/Layout';
import { FilterBar } from './components/FilterBar';
import { IndicadoresView } from './components/IndicadoresView';
import { ComisionesView } from './components/ComisionesView';
import { DiariosView } from './components/DiariosView';
import { ReportesView } from './components/ReportesView';
import { AdminView } from './components/AdminView';

type LoginTab = 'usuario' | 'google';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [health, setHealth] = useState<ServerHealthStatus | null>(null);

  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(() =>
    getCachedAccessToken()
  );
  const [serverSession, setServerSession] = useState<PortalSession | null>(null);
  const [previewSession, setPreviewSession] = useState<PortalSession | null>(null);

  const [loginTab, setLoginTab] = useState<LoginTab>('usuario');
  const [loginTabTouched, setLoginTabTouched] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [spreadsheetId, setSpreadsheetId] = useState<string>(DEFAULT_SPREADSHEET_ID);
  const [data, setData] = useState<RawSpreadsheetData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyLoadingMore, setDailyLoadingMore] = useState(false);
  const [dailyError, setDailyError] = useState('');
  const [normalidadLoading, setNormalidadLoading] = useState(false);
  const [normalidadLoadingMonth, setNormalidadLoadingMonth] = useState<string | null>(null);
  const [normalidadError, setNormalidadError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState('');
  const extrasReqRef = useRef(0);
  const normalidadAttemptedRef = useRef(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('indicadores');
  const [driveModalOpen, setDriveModalOpen] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    selectedCortes: [],
    region: 'ALL',
    agencia: 'ALL',
    estatus: 'ALL',
    ejecutivo: '',
  });

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [adminUsersLoading, setAdminUsersLoading] = useState(false);

  const pushToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 5500);
  }, []);

  const applyLoadedPayload = useCallback((loaded: RawSpreadsheetData) => {
    setData((prev) =>
      prev && loaded.preScoped && loaded.usuarios.length === 0 && prev.usuarios.length > 0
        ? {
            ...loaded,
            usuarios: prev.usuarios,
            backups: loaded.backups.length ? loaded.backups : prev.backups,
          }
        : loaded
    );
    setLastLoadedAt(
      new Date().toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
      })
    );
    setFilters((prev) => {
      if (
        prev.selectedCortes.length > 0 &&
        loaded.cortes.some((c) => prev.selectedCortes.includes(c.CORTE))
      ) {
        return prev;
      }
      const populatedCortes = new Set<number>();
      loaded.indicadores.forEach((r) => {
        if (r.corte > 0) populatedCortes.add(r.corte);
      });
      loaded.ejecutivoCom.forEach((r) => {
        if (r.corte > 0) populatedCortes.add(r.corte);
      });
      const sortedCortes = [...loaded.cortes].sort((a, b) => a.CORTE - b.CORTE);
      const latestPopulated = [...sortedCortes]
        .reverse()
        .find((c) => populatedCortes.has(c.CORTE));
      const latest = latestPopulated || sortedCortes.slice(-1)[0];
      return {
        ...prev,
        selectedCortes: latest ? [latest.CORTE] : [],
      };
    });
  }, []);

  const loadDailySection = useCallback(
    async (opts?: { date?: string; includeHistory?: boolean; reqEpoch?: number }) => {
      const epoch = opts?.reqEpoch ?? extrasReqRef.current;
      const isInitial = !opts?.date && !opts?.includeHistory;
      if (isInitial) {
        setDailyLoading(true);
        setDailyError('');
      } else {
        setDailyLoadingMore(true);
        setDailyError('');
      }
      try {
        const res = await fetchPortalDaily({
          date: opts?.date,
          includeHistory: opts?.includeHistory,
        });
        if (!res || extrasReqRef.current !== epoch) return null;
        setData((prev) => {
          if (!prev) return prev;
          const merged = new Map<string, (typeof prev.diarios)[number]>();
          const push = (r: (typeof prev.diarios)[number]) => {
            const k = `${dailyDateKey(r.FECHACORTE)}|${
              String(r.COD_ASESOR || '').trim() || personKey(r.ASESOR)
            }`;
            merged.set(k, r);
          };
          if (!isInitial) {
            prev.diarios.forEach(push);
          }
          res.diarios.forEach(push);
          return {
            ...prev,
            diariosHeaders: res.diariosHeaders.length
              ? res.diariosHeaders
              : prev.diariosHeaders,
            diarios: Array.from(merged.values()),
            dailyAvailableDates: res.availableDates.length
              ? res.availableDates
              : prev.dailyAvailableDates,
            dailyHistoryLoaded: Boolean(
              (isInitial ? false : prev.dailyHistoryLoaded) || res.includeHistory
            ),
          };
        });
        return res;
      } catch (err) {
        if (extrasReqRef.current === epoch) {
          setDailyError(
            err instanceof Error ? err.message : 'Error cargando indicadores diarios.'
          );
        }
        return null;
      } finally {
        if (extrasReqRef.current === epoch) {
          setDailyLoading(false);
          setDailyLoadingMore(false);
        }
      }
    },
    []
  );

  const loadNormalidadSection = useCallback(
    async (role: Role, month?: string, reqEpoch?: number) => {
      if (role !== 'admin' && role !== 'directivo' && role !== 'direccion') return;
      const epoch = reqEpoch ?? extrasReqRef.current;
      normalidadAttemptedRef.current = true;
      if (!month) {
        setNormalidadLoading(true);
        setNormalidadError('');
      } else {
        setNormalidadLoadingMonth(month);
        setNormalidadError('');
      }
      try {
        let targetMonth = month;
        if (!targetMonth) {
          const listRes = await fetchPortalNormalidad(role, { listOnly: true });
          if (!listRes || extrasReqRef.current !== epoch) return;
          const sortedMonths = [...listRes.availableMonths].sort((a, b) =>
            b.key.localeCompare(a.key)
          );
          if (sortedMonths.length) {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    normalidadMonths: sortedMonths,
                  }
                : prev
            );
          }
          if (!sortedMonths.length) {
            return;
          }
          targetMonth = sortedMonths[0].key;
          setNormalidadLoadingMonth(targetMonth);
        }

        const res = await fetchPortalNormalidad(role, { month: targetMonth });
        if (!res || extrasReqRef.current !== epoch) return;
        const sortedRespMonths = [...res.availableMonths].sort((a, b) =>
          b.key.localeCompare(a.key)
        );
        setData((prev) => {
          if (!prev) return prev;
          const keepOtherMonths = month
            ? prev.normalidadRaw.filter((r) => r.monthKey !== (res.loadedMonth || targetMonth))
            : [];
          return {
            ...prev,
            normalidadRaw: [...keepOtherMonths, ...res.normalidadRaw],
            normalidadMonths: sortedRespMonths.length
              ? sortedRespMonths
              : prev.normalidadMonths,
          };
        });
      } catch (err) {
        if (extrasReqRef.current === epoch) {
          setNormalidadError(
            err instanceof Error ? err.message : 'Error cargando reportes mensuales.'
          );
        }
      } finally {
        if (extrasReqRef.current === epoch) {
          setNormalidadLoading(false);
          setNormalidadLoadingMonth(null);
        }
      }
    },
    []
  );

  const loadAdminExtrasSection = useCallback(
    async (role: Role, reqEpoch?: number) => {
      if (role !== 'admin') return;
      const epoch = reqEpoch ?? extrasReqRef.current;
      setAdminUsersLoading(true);
      try {
        const extras = await fetchPortalAdminExtras(role);
        if (extras && extrasReqRef.current === epoch) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  usuarios: extras.usuarios.length ? extras.usuarios : prev.usuarios,
                  backups: extras.backups.length ? extras.backups : prev.backups,
                }
              : prev
          );
        }
      } catch {
        // non-blocking
      } finally {
        if (extrasReqRef.current === epoch) {
          setAdminUsersLoading(false);
        }
      }
    },
    []
  );

  const hydrateExtrasInBackground = useCallback(
    (role: Role) => {
      const epoch = ++extrasReqRef.current;
      const canSeeNormalidad =
        role === 'admin' || role === 'directivo' || role === 'direccion';
      normalidadAttemptedRef.current = false;
      if (canSeeNormalidad) {
        setNormalidadLoading(true);
        setNormalidadError('');
      } else {
        setNormalidadLoading(false);
        setNormalidadError('');
      }

      // Cargar catálogo de usuarios/respaldos de administrador en paralelo desde el inicio
      if (role === 'admin') {
        void loadAdminExtrasSection(role, epoch);
      }

      void (async () => {
        // 1. Carga rápida del último corte diario
        const latestDaily = await loadDailySection({ reqEpoch: epoch });
        if (extrasReqRef.current !== epoch) return;

        // 2. Evolución de lunes a viernes del período activo para la gráfica diaria
        if (latestDaily?.targetDate) {
          await loadDailySection({
            date: latestDaily.targetDate,
            includeHistory: true,
            reqEpoch: epoch,
          });
          if (extrasReqRef.current !== epoch) return;
        }

        // 3. Reportes mensuales de NORMALIDAD (por defecto solo el mes más actual, solo Dirección / Administrador)
        if (canSeeNormalidad) {
          await loadNormalidadSection(role, undefined, epoch);
        }
      })();
    },
    [loadAdminExtrasSection, loadDailySection, loadNormalidadSection]
  );

  const refreshPortalData = useCallback(
    async (targetSheetId: string, tokenOverride?: string | null) => {
      setSyncing(true);
      setLoadError('');
      try {
        const token = tokenOverride !== undefined ? tokenOverride : googleAccessToken;
        const res = await fetchScopedPortalData(targetSheetId, token);
        setServerSession(res.session);
        applyLoadedPayload(res.data);
        if (res.data.preScoped) {
          hydrateExtrasInBackground(res.session.role);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo cargar Google Sheets.';
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          extrasReqRef.current++;
          setDailyLoading(false);
          setDailyLoadingMore(false);
          setNormalidadLoading(false);
          setNormalidadLoadingMonth(null);
          clearCachedAccessToken();
          setGoogleAccessToken(null);
          setMcMSessionToken(null);
          setServerSession(null);
          setPreviewSession(null);
          setData(null);
          setAuthError('Tu sesión expiró. Inicia sesión nuevamente.');
        } else {
          setLoadError(msg);
        }
      } finally {
        setSyncing(false);
      }
    },
    [googleAccessToken, applyLoadedPayload, hydrateExtrasInBackground]
  );

  // Track Firebase user hint (do NOT clear internal user sessions if firebaseUser is null)
  useEffect(() => {
    const unsub = subscribeAuthState((u) => {
      setFirebaseUser(u);
    });
    return unsub;
  }, []);

  // Bootstrap: check server health & existing McM session on load
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const h = await fetchServerHealth();
        if (!active) return;
        setHealth(h);
        setLoginTab((prev) => {
          if (loginTabTouched) return prev;
          return h.unattendedReady ? 'usuario' : 'google';
        });
      } catch {
        // ignore health check error
      }

      try {
        const tok = getMcMSessionToken();
        const headers: Record<string, string> = {};
        if (tok) headers['X-McM-Session'] = tok;
        const sessionRes = await fetch('/api/auth/session', {
          credentials: 'include',
          headers,
        });
        if (active && sessionRes.ok) {
          const text = await sessionRes.text();
          if (text && !text.trimStart().startsWith('<')) {
            const json = JSON.parse(text) as {
              ok: boolean;
              session?: PortalSession;
            };
            if (json.ok && json.session) {
              setServerSession(json.session);
              await refreshPortalData(DEFAULT_SPREADSHEET_ID, getCachedAccessToken());
            }
          }
        }
      } catch {
        // No active session yet
      } finally {
        if (active) setAuthReady(true);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim() || !passwordInput) {
      setAuthError('Ingresa tu usuario y contraseña McM.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    setLoadError('');
    try {
      const res = await loginWithCredentials(
        usernameInput.trim(),
        passwordInput,
        spreadsheetId
      );
      setServerSession(res.session);
      setPreviewSession(null);
      setPasswordInput('');
      setFilters({
        selectedCortes: [],
        region: 'ALL',
        agencia: 'ALL',
        estatus: 'ALL',
        ejecutivo: '',
      });
      applyLoadedPayload(res.data);
      if (res.data.preScoped) {
        void hydrateExtrasInBackground(res.session.role);
      }
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'No se pudo iniciar sesión.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const completeGoogleServerLogin = async (token: string) => {
    const res = await loginWithGoogleToken(token, spreadsheetId);
    setGoogleAccessToken(token);
    setServerSession(res.session);
    setPreviewSession(null);
    setFilters({
      selectedCortes: [],
      region: 'ALL',
      agencia: 'ALL',
      estatus: 'ALL',
      ejecutivo: '',
    });
    applyLoadedPayload(res.data);
    try {
      const updatedHealth = await fetchServerHealth();
      setHealth(updatedHealth);
    } catch {
      // ignore
    }
  };

  const handleConnectGoogle = async () => {
    setAuthLoading(true);
    setAuthError('');
    setLoadError('');
    try {
      const res = await signInWithGoogleWorkspace();
      await completeGoogleServerLogin(res.accessToken);
    } catch (err) {
      setAuthError(formatGoogleAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleConnectGIS = async () => {
    setAuthLoading(true);
    setAuthError('');
    setLoadError('');
    try {
      const res = await signInWithGoogleGIS();
      await completeGoogleServerLogin(res.accessToken);
    } catch (err) {
      setAuthError(formatGoogleAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDisconnect = async () => {
    extrasReqRef.current++;
    setDailyLoading(false);
    setDailyLoadingMore(false);
    setDailyError('');
    setNormalidadLoading(false);
    setNormalidadLoadingMonth(null);
    setNormalidadError('');
    await logoutPortalSession();
    await signOutGoogleWorkspace();
    clearCachedAccessToken();
    setGoogleAccessToken(null);
    setServerSession(null);
    setPreviewSession(null);
    setData(null);
    setLoadError('');
    setAuthError('');
    setActiveTab('indicadores');
  };

  const isTrueAdmin = serverSession?.role === 'admin';
  const effectiveSession: PortalSession = useMemo(() => {
    if (isTrueAdmin && previewSession) {
      return previewSession;
    }
    return (
      serverSession || {
        username: '',
        role: 'ejecutivo',
        nombre: '',
        mode: 'usuario_interno',
      }
    );
  }, [isTrueAdmin, previewSession, serverSession]);

  const isSimulatingRole = Boolean(
    isTrueAdmin && previewSession && previewSession.role !== 'admin'
  );
  const canBrowseDrive = Boolean(
    isTrueAdmin && googleAccessToken && googleAccessToken !== '__SERVER_SESSION__'
  );

  // Scoped datasets (server already strictly filtered for real non-admin users;
  // client filter also powers Admin's Vista/Rol live preview simulator)
  const rawScopes = useMemo(
    () => ({
      coordinador: data?.scopeCoordinador || [],
      gerente: data?.scopeGerente || [],
      regional: data?.scopeRegional || [],
    }),
    [data]
  );

  const scopedScopes = useMemo(
    () => scopeRoleScopes(rawScopes, effectiveSession.role, effectiveSession.nombre),
    [rawScopes, effectiveSession.role, effectiveSession.nombre]
  );

  const scopedIndicadores = useMemo(
    () =>
      !data
        ? []
        : data.preScoped && !isSimulatingRole
        ? data.indicadores
        : scopeWeeklyRows(
            data.indicadores,
            effectiveSession.role,
            effectiveSession.nombre,
            rawScopes
          ),
    [data, isSimulatingRole, effectiveSession.role, effectiveSession.nombre, rawScopes]
  );

  const scopedEjecutivoCom = useMemo(
    () =>
      !data
        ? []
        : data.preScoped && !isSimulatingRole
        ? data.ejecutivoCom
        : scopeWeeklyRows(
            data.ejecutivoCom,
            effectiveSession.role,
            effectiveSession.nombre,
            rawScopes
          ),
    [data, isSimulatingRole, effectiveSession.role, effectiveSession.nombre, rawScopes]
  );

  const scopedDirectorioCom = useMemo(() => {
    if (!data) return [];
    const all = [...data.coordinadorCom, ...data.gerenteCom, ...data.regionalCom];
    return scopeDirectorioRows(
      all,
      effectiveSession.role,
      effectiveSession.nombre,
      rawScopes
    );
  }, [data, effectiveSession.role, effectiveSession.nombre, rawScopes]);

  const scopedDaily = useMemo(
    () =>
      !data
        ? []
        : data.preScoped && !isSimulatingRole
        ? data.diarios
        : scopeDailyRows(
            data.diarios,
            effectiveSession.role,
            effectiveSession.nombre,
            rawScopes,
            data.gerenteCom,
            data.regionalCom
          ),
    [data, isSimulatingRole, effectiveSession.role, effectiveSession.nombre, rawScopes]
  );

  const scopedMetas = useMemo(() => {
    if (!data?.metas) return data?.metas;
    const role = effectiveSession.role;
    if (role === 'admin' || role === 'directivo' || role === 'direccion') {
      return data.metas;
    }
    if (data.preScoped && !isSimulatingRole) {
      return data.metas;
    }
    const pk = personKey(effectiveSession.nombre);
    const sortWords = (v: unknown) =>
      normText(v)
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');
    const pkWords = sortWords(effectiveSession.nombre);
    if (role === 'ejecutivo') {
      return data.metas.filter((m) => {
        const mk = personKey(m.asesor);
        const mw = sortWords(m.asesor);
        return mk === pk || (pkWords !== '' && mw === pkWords);
      });
    }
    const scopedExecPks = new Set(scopedIndicadores.map((r) => personKey(r.ejecutivo)).filter(Boolean));
    const scopedExecWords = new Set(scopedIndicadores.map((r) => sortWords(r.ejecutivo)).filter(Boolean));
    const allowedRegions = new Set(
      [
        ...scopedIndicadores.map((r) => dailyRegionScopeKey(r.region)),
        ...(role === 'regional'
          ? scopedScopes.regional
              .filter((s) => personKey(s.persona) === pk || (pkWords !== '' && sortWords(s.persona) === pkWords))
              .map((s) => dailyRegionScopeKey(s.region))
          : []),
      ].filter(Boolean)
    );
    const allowedAgencies = new Set(scopedIndicadores.map((r) => normText(r.agencia)).filter(Boolean));
    const terrByPk = new Map<string, { region: string; agencia: string }>();
    data.indicadores.forEach((r) => {
      const k = personKey(r.ejecutivo);
      if (k && (r.region || r.agencia)) {
        terrByPk.set(k, { region: r.region || '', agencia: r.agencia || '' });
      }
    });
    return data.metas.filter((m) => {
      const mk = personKey(m.asesor);
      const mw = sortWords(m.asesor);
      if (m.asesor && (scopedExecPks.has(mk) || (mw && scopedExecWords.has(mw)))) return true;
      const terr = terrByPk.get(mk);
      const reg = m.region || terr?.region || '';
      const ag = m.agencia || terr?.agencia || '';
      if (role === 'regional') {
        return Boolean(reg && allowedRegions.has(dailyRegionScopeKey(reg)));
      }
      return Boolean(ag && allowedAgencies.has(normText(ag)));
    });
  }, [data, scopedIndicadores, isSimulatingRole, effectiveSession.role, effectiveSession.nombre, scopedScopes]);

  const filterOptions = useMemo(() => {
    const src =
      activeTab === 'comisiones' ? scopedEjecutivoCom : scopedIndicadores;
    const regionSet = new Set<string>();
    src.map((r) => r.region).filter(Boolean).forEach((reg) => {
      regionSet.add(regionDisplayName(reg));
    });
    scopedDirectorioCom.forEach((d) => {
      if (d.region) regionSet.add(regionDisplayName(d.region));
    });
    const regions = Array.from(regionSet).sort();
    const agencies = Array.from(
      new Set(
        src
          .filter((r) => regionMatchesFilter(r.region, filters.region))
          .map((r) => r.agencia)
          .filter(Boolean)
      )
    ).sort();
    const statuses = Array.from(new Set(src.map((r) => r.estatus).filter(Boolean))).sort();

    const staffMap = new Map<
      string,
      { name: string; roleHint: string; priority: number }
    >();
    const addStaff = (name: string | undefined, roleHint: string, priority: number) => {
      const clean = (name || '').trim();
      if (!clean || clean === '-') return;
      const pk = personKey(clean);
      if (!pk) return;
      const prev = staffMap.get(pk);
      if (!prev || priority > prev.priority) {
        staffMap.set(pk, { name: clean, roleHint, priority });
      }
    };

    const userPk = personKey(effectiveSession.nombre);
    const activeAgNorm = filters.agencia !== 'ALL' ? normText(filters.agencia) : '';

    // Prioritize Regional -> Gerente -> Coordinador -> Ejecutivo labels, strictly within role + active filters
    scopedDirectorioCom.forEach((d) => {
      if (!d.empleado) return;
      if (!regionMatchesFilter(d.region, filters.region)) return;
      if (activeAgNorm) {
        if (d.rol_persona === 'regional') return;
        if (normText(d.agencia) !== activeAgNorm) return;
      }
      if (filters.estatus !== 'ALL' && d.estatus && d.estatus !== filters.estatus) {
        return;
      }
      const priority =
        d.rol_persona === 'regional' ? 4 : d.rol_persona === 'gerente' ? 3 : 2;
      const lbl =
        d.rol_persona === 'regional'
          ? 'Gerente Regional'
          : d.rol_persona === 'gerente'
          ? 'Gerente'
          : 'Coordinador';
      addStaff(d.empleado, lbl, priority);
    });

    if (!activeAgNorm) {
      scopedScopes.regional.forEach((s) => {
        if (!regionMatchesFilter(s.region, filters.region)) return;
        addStaff(s.persona, 'Gerente Regional', 4);
      });
    }
    scopedScopes.gerente.forEach((s) => {
      if (!regionMatchesFilter(s.region, filters.region)) return;
      if (activeAgNorm && normText(s.agencia) !== activeAgNorm) return;
      addStaff(s.persona, 'Gerente', 3);
    });
    scopedScopes.coordinador.forEach((s) => {
      if (!regionMatchesFilter(s.region, filters.region)) return;
      if (activeAgNorm && normText(s.agencia) !== activeAgNorm) return;
      addStaff(s.persona, 'Coordinador', 2);
    });

    src.forEach((r) => {
      if (!regionMatchesFilter(r.region, filters.region)) return;
      if (filters.agencia !== 'ALL' && r.agencia !== filters.agencia) return;
      if (filters.estatus !== 'ALL' && r.estatus !== filters.estatus) return;
      if (
        r.coordinador &&
        r.coordinador !== '-' &&
        (effectiveSession.role !== 'coordinador' || personKey(r.coordinador) === userPk)
      ) {
        addStaff(r.coordinador, 'Coordinador', 2);
      }
      if (r.ejecutivo) {
        addStaff(r.ejecutivo, 'Ejecutivo', 1);
      }
    });

    const staffOptions = Array.from(staffMap.values())
      .map(({ name, roleHint }) => ({ name, roleHint }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return { regions, agencies, statuses, staffOptions };
  }, [
    activeTab,
    scopedIndicadores,
    scopedEjecutivoCom,
    scopedDirectorioCom,
    scopedScopes,
    filters.region,
    filters.agencia,
    filters.estatus,
    effectiveSession.role,
    effectiveSession.nombre,
  ]);

  const adminSimulationUsers = useMemo(() => {
    if (!isTrueAdmin || !data) return [];
    if (data.usuarios.length > 0) return data.usuarios;

    // Fallback profiles from scopes/indicadores while USUARIOS finishes loading or if unavailable
    const map = new Map<string, { username: string; role: Role; nombre: string; estado: 'activo' }>();
    const addProfile = (nombre: string | undefined, role: Role) => {
      const clean = (nombre || '').trim().toUpperCase();
      if (!clean || clean === '-') return;
      const pk = personKey(clean);
      if (!pk) return;
      const key = `${role}|${pk}`;
      if (!map.has(key)) {
        map.set(key, {
          username: `${role}:${pk.toLowerCase()}`,
          role,
          nombre: clean,
          estado: 'activo',
        });
      }
    };
    data.scopeRegional.forEach((s) => addProfile(s.persona, 'regional'));
    data.regionalCom.forEach((d) => addProfile(d.empleado, 'regional'));
    data.scopeGerente.forEach((s) => addProfile(s.persona, 'gerente'));
    data.gerenteCom.forEach((d) => addProfile(d.empleado, 'gerente'));
    data.scopeCoordinador.forEach((s) => addProfile(s.persona, 'coordinador'));
    data.coordinadorCom.forEach((d) => addProfile(d.empleado, 'coordinador'));
    data.indicadores.forEach((r) => {
      addProfile(r.coordinador, 'coordinador');
      addProfile(r.ejecutivo, 'ejecutivo');
    });
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [isTrueAdmin, data]);

  // Ensure activeTab is valid when role changes
  useEffect(() => {
    if (
      (activeTab === 'administracion' && effectiveSession.role !== 'admin') ||
      (activeTab === 'reportes' &&
        effectiveSession.role !== 'admin' &&
        effectiveSession.role !== 'directivo' &&
        effectiveSession.role !== 'direccion')
    ) {
      setActiveTab('indicadores');
    }
  }, [activeTab, effectiveSession.role]);

  // If user enters Reportes Mensuales and Normalidad hasn't been fetched yet, trigger load
  useEffect(() => {
    const canSeeNormalidad =
      effectiveSession.role === 'admin' ||
      effectiveSession.role === 'directivo' ||
      effectiveSession.role === 'direccion';
    if (
      activeTab === 'reportes' &&
      canSeeNormalidad &&
      data?.preScoped &&
      !data.normalidadRaw.length &&
      !normalidadLoading &&
      !normalidadLoadingMonth &&
      !normalidadError &&
      !normalidadAttemptedRef.current
    ) {
      void loadNormalidadSection(effectiveSession.role);
    }
  }, [
    activeTab,
    effectiveSession.role,
    data?.preScoped,
    data?.normalidadRaw.length,
    normalidadLoading,
    normalidadLoadingMonth,
    normalidadError,
    loadNormalidadSection,
  ]);

  const handleOpenConfirm = (dialog: ConfirmDialogState) => {
    setConfirmDialog(dialog);
  };

  const wrappedConfirmDialog: ConfirmDialogState | null = confirmDialog
    ? {
        ...confirmDialog,
        onConfirm: async () => {
          setConfirmBusy(true);
          try {
            await confirmDialog.onConfirm();
            setConfirmDialog(null);
          } finally {
            setConfirmBusy(false);
          }
        },
      }
    : null;

  // 1. Auth Loading Gate
  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span>Iniciando Indicadores McM...</span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Screen: Usuario McM (todos los roles) + Administrador Google
  if (!serverSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-7 space-y-5">
          <div className="flex flex-col items-start gap-2.5 pb-1 border-b border-slate-100">
            <img
              src="/assets/aistudio/image_d1f7dcd3.png"
              alt="Más con Menos"
              className="h-11 w-auto max-w-full object-contain"
            />
            <div>
              <h1 className="text-lg font-bold text-slate-900">Indicadores McM</h1>
              <p className="text-xs text-slate-500">
                Portal Ejecutivo de Cartera, Comisiones y Reportes
              </p>
            </div>
          </div>

          {/* Access Mode Tabs */}
          <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 border border-slate-200/80 gap-1">
            <button
              type="button"
              onClick={() => {
                setLoginTabTouched(true);
                setLoginTab('usuario');
                setAuthError('');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                loginTab === 'usuario'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserIcon className="w-3.5 h-3.5" />
              Usuario McM
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginTabTouched(true);
                setLoginTab('google');
                setAuthError('');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                loginTab === 'google'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Administrador Google
            </button>
          </div>

          {(authError || loadError) && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{authError || loadError}</span>
            </div>
          )}

          {loginTab === 'usuario' ? (
            <form onSubmit={handleCredentialsLogin} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 space-y-1.5">
                <p className="font-semibold text-slate-800">
                  Acceso por Rol (Ejecutivo, Coordinador, Gerente, Regional, Directivo)
                </p>
                <p>
                  Cada usuario consulta únicamente la información y cortes asignados a su rol sin acceder al archivo maestro.
                </p>
              </div>

              {health && !health.unattendedReady && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  Para habilitar el acceso por usuario/contraseña de forma permanente, conecta primero como{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setLoginTabTouched(true);
                      setLoginTab('google');
                    }}
                    className="underline font-semibold"
                  >
                    Administrador Google
                  </button>
                  .
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="mcm-username"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Usuario
                  </label>
                  <input
                    id="mcm-username"
                    type="text"
                    autoComplete="username"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="ej. juan.perez"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mcm-password"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      id="mcm-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-10 pl-3 pr-10 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full h-11 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
                <span>{authLoading ? 'Validando acceso...' : 'Ingresar al portal'}</span>
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs text-slate-600">
                <div className="flex items-start gap-2.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    Lectura y publicación en tiempo real sobre tu hoja{' '}
                    <strong className="text-slate-900">McM_Datos_DashBoard</strong> en Google Drive.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <BarChart3 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>
                    Indicadores semanales, comisiones por esquema, cortes diarios y normalidad mensual.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
                  <span>
                    Solo cuentas autorizadas con acceso al archivo maestro o registradas en <strong className="text-slate-900">USUARIOS</strong> pueden entrar con Google.
                  </span>
                </div>
              </div>

              {firebaseUser && (
                <div className="px-3.5 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
                  Cuenta detectada: <strong>{firebaseUser.email}</strong>. Autoriza el acceso a Sheets para sincronizar.
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={handleConnectGoogle}
                  className="w-full h-11 px-4 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 text-slate-800 font-semibold text-sm flex items-center justify-center gap-3 shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
                >
                  {authLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  ) : (
                    <svg viewBox="0 0 48 48" className="w-5 h-5 shrink-0" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  )}
                  <span>
                    {authLoading ? 'Conectando...' : 'Iniciar sesión con Google'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={authLoading}
                  onClick={handleConnectGIS}
                  className="w-full h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Conexión directa con Google (alternativa si el popup falla)</span>
                </button>

                <a
                  href={typeof window !== 'undefined' ? window.location.href : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline pt-1"
                >
                  Abrir aplicación en pestaña independiente
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Layout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        session={effectiveSession}
        isTrueAdmin={isTrueAdmin}
        canBrowseDrive={canBrowseDrive}
        isSimulatingRole={isSimulatingRole}
        spreadsheetTitle={data?.spreadsheetTitle || 'McM_Datos_DashBoard'}
        spreadsheetId={spreadsheetId}
        syncing={syncing}
        lastLoadedAt={lastLoadedAt}
        users={adminSimulationUsers}
        usersFromFallback={Boolean(isTrueAdmin && data && data.usuarios.length === 0 && adminSimulationUsers.length > 0)}
        usersLoading={adminUsersLoading}
        onReloadUsers={
          isTrueAdmin && data?.preScoped
            ? () => void loadAdminExtrasSection('admin')
            : undefined
        }
        onRefresh={() => refreshPortalData(spreadsheetId)}
        onOpenDrivePicker={() => setDriveModalOpen(true)}
        onSwitchSession={(next) => {
          if (!isTrueAdmin) return;
          setPreviewSession(next.role === 'admin' ? null : next);
          setFilters((prev) => ({
            ...prev,
            region: 'ALL',
            agencia: 'ALL',
            estatus: 'ALL',
            ejecutivo: '',
          }));
          pushToast({
            type: 'info',
            title: `Vista cambiada a ${next.nombre}`,
            detail: `Rol activo: ${next.role.toUpperCase()}`,
          });
        }}
        onExitSimulation={() => {
          setPreviewSession(null);
          setFilters((prev) => ({
            ...prev,
            region: 'ALL',
            agencia: 'ALL',
            estatus: 'ALL',
            ejecutivo: '',
          }));
        }}
        onDisconnect={handleDisconnect}
      >
        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Error leyendo Google Sheets</p>
                <p className="mt-0.5">{loadError}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canBrowseDrive && (
                <button
                  type="button"
                  onClick={() => setDriveModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-red-200 text-red-800 rounded-lg hover:bg-red-100/50"
                >
                  <FolderSync className="w-3.5 h-3.5" />
                  Elegir hoja en Drive
                </button>
              )}
              <button
                type="button"
                onClick={() => refreshPortalData(spreadsheetId)}
                className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {syncing && !data ? (
          <div className="bg-white border border-slate-200 rounded-xl py-20 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
            <p className="text-sm font-semibold text-slate-800">
              Cargando información autorizada...
            </p>
          </div>
        ) : data ? (
          <>
            {(activeTab === 'indicadores' || activeTab === 'comisiones') && (
              <FilterBar
                cortes={data.cortes}
                filters={filters}
                regions={filterOptions.regions}
                agencies={filterOptions.agencies}
                statuses={filterOptions.statuses}
                staffOptions={filterOptions.staffOptions}
                hideHierarchyFilters={effectiveSession.role === 'ejecutivo'}
                onChange={setFilters}
                onReset={() =>
                  setFilters((prev) => ({
                    ...prev,
                    region: 'ALL',
                    agencia: 'ALL',
                    estatus: 'ALL',
                    ejecutivo: '',
                  }))
                }
              />
            )}

            {activeTab === 'indicadores' && (
              <IndicadoresView
                cortes={data.cortes}
                scopedRows={scopedIndicadores}
                scopedDirRows={scopedDirectorioCom}
                scopes={scopedScopes}
                filters={filters}
                role={effectiveSession.role}
                userNombre={effectiveSession.nombre}
                metas={scopedMetas}
              />
            )}

            {activeTab === 'comisiones' && (
              <ComisionesView
                cortes={data.cortes}
                scopedEjRows={scopedEjecutivoCom}
                scopedDirRows={scopedDirectorioCom}
                scopes={scopedScopes}
                filters={filters}
                role={effectiveSession.role}
                userNombre={effectiveSession.nombre}
                onSelectStaff={(staffName) =>
                  setFilters((prev) => ({
                    ...prev,
                    ejecutivo: staffName,
                  }))
                }
              />
            )}

            {activeTab === 'diarios' && (
              <DiariosView
                scopedDailyRows={scopedDaily}
                availableDates={data.dailyAvailableDates}
                historyLoaded={data.preScoped ? Boolean(data.dailyHistoryLoaded) : true}
                loading={dailyLoading}
                loadingMore={dailyLoadingMore}
                error={dailyError}
                onLoadDate={
                  data.preScoped
                    ? (date) => void loadDailySection({ date, includeHistory: false })
                    : undefined
                }
                onLoadHistory={
                  data.preScoped
                    ? () => void loadDailySection({ includeHistory: true })
                    : undefined
                }
                onRetry={data.preScoped ? () => void loadDailySection() : undefined}
              />
            )}

            {activeTab === 'reportes' &&
              (effectiveSession.role === 'admin' ||
                effectiveSession.role === 'directivo' ||
                effectiveSession.role === 'direccion') && (
                <ReportesView
                  normalidadRaw={data.normalidadRaw}
                  availableMonths={data.normalidadMonths}
                  loading={normalidadLoading}
                  loadingMonth={normalidadLoadingMonth}
                  error={normalidadError}
                  onSelectMonth={
                    data.preScoped
                      ? (m) => void loadNormalidadSection(effectiveSession.role, m)
                      : undefined
                  }
                  onRetry={
                    data.preScoped
                      ? () => void loadNormalidadSection(effectiveSession.role)
                      : undefined
                  }
                />
              )}

            {activeTab === 'administracion' && effectiveSession.role === 'admin' && (
              <AdminView
                data={data}
                accessToken={googleAccessToken || '__SERVER_SESSION__'}
                actor={serverSession.googleEmail || serverSession.username}
                serverHealth={health}
                onReload={() => refreshPortalData(spreadsheetId)}
                onConfirm={handleOpenConfirm}
                onToast={pushToast}
              />
            )}
          </>
        ) : null}
      </Layout>

      {isTrueAdmin && canBrowseDrive && googleAccessToken && (
        <DriveSheetModal
          open={driveModalOpen}
          accessToken={googleAccessToken}
          currentSpreadsheetId={spreadsheetId}
          onSelect={(newId) => {
            setSpreadsheetId(newId);
            setData(null);
            refreshPortalData(newId);
          }}
          onClose={() => setDriveModalOpen(false)}
        />
      )}

      <ConfirmModal
        dialog={wrappedConfirmDialog}
        busy={confirmBusy}
        onClose={() => {
          if (!confirmBusy) setConfirmDialog(null);
        }}
      />

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </>
  );
}

import React, { useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  ChevronRight,
  Coins,
  Database,
  FileSpreadsheet,
  FolderSync,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserCog,
  X,
} from 'lucide-react';
import type { ActiveTab, PortalSession, Role, UserRecord } from '../types/mcm';
import { ROLE_LABELS } from '../utils/mcmData';

interface NavItem {
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'indicadores', label: 'Indicadores', icon: BarChart3 },
  { id: 'comisiones', label: 'Comisiones', icon: Coins },
  { id: 'diarios', label: 'Indicadores Diarios', icon: CalendarClock },
  {
    id: 'reportes',
    label: 'Reportes Mensuales',
    icon: TrendingUp,
    roles: ['admin', 'directivo', 'direccion'],
  },
  {
    id: 'administracion',
    label: 'Administración',
    icon: ShieldCheck,
    roles: ['admin'],
  },
];

interface LayoutProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  session: PortalSession;
  isTrueAdmin: boolean;
  canBrowseDrive: boolean;
  isSimulatingRole: boolean;
  spreadsheetTitle: string;
  spreadsheetId: string;
  syncing: boolean;
  lastLoadedAt: string;
  users: UserRecord[];
  onRefresh: () => void;
  onOpenDrivePicker: () => void;
  onSwitchSession: (next: PortalSession) => void;
  onExitSimulation: () => void;
  onDisconnect: () => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  activeTab,
  onTabChange,
  session,
  isTrueAdmin,
  canBrowseDrive,
  isSimulatingRole,
  spreadsheetTitle,
  spreadsheetId,
  syncing,
  lastLoadedAt,
  users,
  onRefresh,
  onOpenDrivePicker,
  onSwitchSession,
  onExitSimulation,
  onDisconnect,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(session.role)
  );
  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  const filteredUsers = users.filter((u) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      u.nombre.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const SidebarBody = () => (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      {/* Brand */}
      <div className="min-h-[60px] px-4 py-2.5 flex flex-col justify-center border-b border-slate-200 shrink-0">
        <img
          src="/assets/aistudio/image_d1f7dcd3.png"
          alt="Más con Menos"
          className="h-7 w-auto max-w-[180px] object-contain object-left"
        />
        <div className="text-[11px] font-medium text-slate-500 leading-tight truncate mt-0.5">
          Indicadores · Cartera y Comisiones
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Navegación principal">
        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Módulos
        </p>
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onTabChange(item.id);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        {/* Google Sheet source card (Solo Administrador) */}
        {isTrueAdmin && (
          <div className="pt-5 mt-5 border-t border-slate-100">
            <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Fuente Google Drive
            </p>
            <div className="mx-1 p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="flex items-start gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate" title={spreadsheetTitle}>
                    {spreadsheetTitle}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 truncate" title={spreadsheetId}>
                    {spreadsheetId}
                  </p>
                </div>
              </div>
              {canBrowseDrive && (
                <button
                  type="button"
                  onClick={onOpenDrivePicker}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
                >
                  <FolderSync className="w-3.5 h-3.5 text-slate-500" />
                  Cambiar hoja en Drive
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Session & Account Footer */}
      <div className="p-3 border-t border-slate-200 space-y-2 shrink-0 bg-slate-50/50">
        <div className="px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900 truncate">{session.nombre}</span>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-slate-200/80 text-slate-700 shrink-0">
              {ROLE_LABELS[session.role]}
            </span>
          </div>
          {session.googleEmail && (
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{session.googleEmail}</p>
          )}
        </div>

        {isTrueAdmin ? (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <UserCog className="w-3.5 h-3.5 text-slate-500" />
              Vista / Rol
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Salir
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onDisconnect}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cerrar sesión
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        <SidebarBody />
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10 shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-3.5 right-3 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 z-20"
              aria-label="Cerrar menú"
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarBody />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-[60px] bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Abrir navegación"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 font-medium">Indicadores McM</span>
              <ChevronRight className="hidden sm:inline w-4 h-4 text-slate-300 shrink-0" />
              <h1 className="font-semibold text-slate-900 truncate">{activeNav.label}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {lastLoadedAt && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                <Database className="w-3.5 h-3.5 text-slate-400" />
                {lastLoadedAt}
              </span>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-blue-600' : ''}`} />
              <span>{syncing ? 'Sincronizando...' : 'Actualizar'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-5">
          {isSimulatingRole && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
              <span>
                Modo simulación activo: viendo información como{' '}
                <strong>{session.nombre}</strong> ({ROLE_LABELS[session.role]}).
              </span>
              <button
                type="button"
                onClick={onExitSimulation}
                className="px-3 py-1 font-semibold bg-white border border-amber-300 text-amber-900 rounded-lg hover:bg-amber-100 transition-colors"
              >
                Volver a Administrador
              </button>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Switch Role / User Preview Modal (Solo Administrador) */}
      {isTrueAdmin && profileModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Cambiar vista o perfil McM
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Valida los permisos y alcance por usuario desde la hoja USUARIOS.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  onSwitchSession({
                    username: session.googleEmail || 'admin',
                    role: 'admin',
                    nombre: 'Administrador McM',
                    googleEmail: session.googleEmail,
                    mode: 'google_workspace',
                  });
                  setProfileModalOpen(false);
                }}
                className="w-full p-3 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-50 text-left flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-blue-900">
                    Vista Administrador Completa
                  </p>
                  <p className="text-xs text-blue-700">
                    Acceso global a Indicadores, Comisiones, Reportes y Administración
                  </p>
                </div>
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-blue-600 text-white rounded">
                  Admin
                </span>
              </button>

              <div>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Buscar por nombre, usuario o rol en USUARIOS..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {filteredUsers.slice(0, 60).map((u) => (
                  <button
                    key={`${u.username}-${u.role}`}
                    type="button"
                    onClick={() => {
                      onSwitchSession({
                        username: u.username,
                        role: u.role,
                        nombre: u.nombre,
                        googleEmail: session.googleEmail,
                        mode: 'usuario_interno',
                      });
                      setProfileModalOpen(false);
                    }}
                    className="w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{u.nombre}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{u.username}</p>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-slate-100 text-slate-700 shrink-0">
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  </button>
                ))}
                {filteredUsers.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No se encontraron usuarios en la hoja USUARIOS.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

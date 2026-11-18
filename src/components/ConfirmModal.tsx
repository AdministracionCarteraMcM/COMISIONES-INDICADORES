import React from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';

export interface ConfirmDialogState {
  title: string;
  description: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
  onConfirm: () => Promise<void> | void;
}

interface ConfirmModalProps {
  dialog: ConfirmDialogState | null;
  busy?: boolean;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ dialog, busy, onClose }) => {
  if (!dialog) return null;
  const tone = dialog.tone || 'primary';

  const toneStyles = {
    danger: {
      iconBg: 'bg-red-50 text-red-600 border-red-200',
      btn: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
      Icon: ShieldAlert,
    },
    warning: {
      iconBg: 'bg-amber-50 text-amber-600 border-amber-200',
      btn: 'bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-500',
      Icon: AlertTriangle,
    },
    primary: {
      iconBg: 'bg-blue-50 text-blue-600 border-blue-200',
      btn: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
      Icon: Info,
    },
  }[tone];

  const Icon = toneStyles.Icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
          <div className="flex items-start gap-3.5">
            <div
              className={`shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center ${toneStyles.iconBg}`}
            >
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 id="confirm-modal-title" className="text-base font-semibold text-slate-900">
                {dialog.title}
              </h3>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">{dialog.description}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {dialog.details && dialog.details.length > 0 && (
          <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Alcance de la operación
            </p>
            <ul className="space-y-1.5 text-xs text-slate-700">
              {dialog.details.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-5 py-3.5 bg-white flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {dialog.cancelLabel || 'Cancelar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              await dialog.onConfirm();
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-60 ${toneStyles.btn}`}
          >
            {busy ? 'Procesando...' : dialog.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

export const ToastStack: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const cls =
          t.type === 'success'
            ? 'border-emerald-200 bg-white text-slate-900'
            : t.type === 'error'
            ? 'border-red-200 bg-white text-slate-900'
            : 'border-blue-200 bg-white text-slate-900';
        const Icon =
          t.type === 'success' ? CheckCircle2 : t.type === 'error' ? AlertTriangle : Info;
        const iconColor =
          t.type === 'success'
            ? 'text-emerald-600'
            : t.type === 'error'
            ? 'text-red-600'
            : 'text-blue-600';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border shadow-lg p-3.5 flex items-start gap-3 ${cls}`}
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">{t.title}</p>
              {t.detail && <p className="text-xs text-slate-600 mt-0.5 break-words">{t.detail}</p>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="text-slate-400 hover:text-slate-600 p-0.5"
              aria-label="Cerrar notificación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

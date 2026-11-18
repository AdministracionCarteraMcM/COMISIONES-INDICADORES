import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2, RotateCcw, Search, X } from 'lucide-react';
import type { DriveSpreadsheet } from '../types/mcm';
import { DEFAULT_SPREADSHEET_ID, listDriveSpreadsheets } from '../services/sheetsApi';

interface DriveSheetModalProps {
  open: boolean;
  accessToken: string | null;
  currentSpreadsheetId: string;
  onSelect: (spreadsheetId: string) => void;
  onClose: () => void;
}

function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}

export const DriveSheetModal: React.FC<DriveSheetModalProps> = ({
  open,
  accessToken,
  currentSpreadsheetId,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [files, setFiles] = useState<DriveSpreadsheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchFiles = async (q: string) => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const list = await listDriveSpreadsheets(accessToken, q);
      setFiles(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron listar las hojas en Drive.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && accessToken) {
      fetchFiles('');
    }
  }, [open, accessToken]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Seleccionar Google Sheet desde Drive
              </h2>
              <p className="text-xs text-slate-500">
                Elige la hoja de cálculo McM o pega un ID / enlace directo de Google Sheets.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fetchFiles(query);
            }}
            className="flex flex-wrap gap-2"
          >
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar hoja en Google Drive (ej. McM_Datos_DashBoard)..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Buscar
            </button>
            {currentSpreadsheetId !== DEFAULT_SPREADSHEET_ID && (
              <button
                type="button"
                onClick={() => {
                  onSelect(DEFAULT_SPREADSHEET_ID);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Hoja Principal McM
              </button>
            )}
          </form>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {loading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Consultando Google Drive...
              </div>
            ) : files.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No se encontraron hojas de cálculo con ese filtro.
              </div>
            ) : (
              files.map((f) => {
                const isCurrent = f.id === currentSpreadsheetId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      onSelect(f.id);
                      onClose();
                    }}
                    className={`w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors ${
                      isCurrent ? 'bg-blue-50/60' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {f.name}
                        </span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 text-[11px] font-semibold bg-blue-100 text-blue-700 rounded">
                            Actual
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                        {f.id}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs text-slate-500">
                        {f.modifiedTime
                          ? new Date(f.modifiedTime).toLocaleDateString('es-MX', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          : ''}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              O pega directamente el enlace o ID de la hoja
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1UnWSSY..."
                className="flex-1 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <button
                type="button"
                disabled={!manualInput.trim()}
                onClick={() => {
                  const id = extractSpreadsheetId(manualInput);
                  if (id) {
                    onSelect(id);
                    onClose();
                  }
                }}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                Conectar ID
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

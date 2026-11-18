import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ComisionEjecutivoRow,
  DirectorioRow,
  IndicadorRow,
  UserRecord,
} from '../types/mcm';
import {
  comisionCobranzaTotalRow,
  comisionPagarRow,
  fmtMoney,
  fmtNum,
  fmtPct,
  incentivoColocacionPagarRow,
  regionDisplayName,
  ROLE_LABELS,
  totalDescuentosRow,
  type PendingUserCandidate,
  type TreeNode,
} from './mcmData';

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
  filename: string
) {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportIndicadoresExcel(rows: IndicadorRow[], filename = 'Indicadores_McM.xlsx') {
  const data = rows.map((r) => ({
    Ejecutivo: r.ejecutivo,
    Región: r.region,
    Agencia: r.agencia,
    Estatus: r.estatus,
    'Pagos Esperados': r.pagos_esperados,
    'Pagos Recibidos': r.pagos_recibidos,
    '% Normalidad': r.pct_normalidad != null ? Number((r.pct_normalidad * 100).toFixed(2)) : 0,
    '$ Esperado': r.monto_esperado,
    '$ Recibido': r.monto_recibido,
    'Clientes Vigentes': r.clientes_vigentes,
    'Saldo Total': r.saldo_total,
    'Mora Total': r.mora_total,
    '% Mora': Number((r.pct_mora * 100).toFixed(2)),
    'Clientes Nuevos': r.clientes_nuevos,
    'Monto Nuevos': r.monto_nuevos,
    Renovaciones: r.renovaciones,
    'Monto Renovaciones': r.monto_renovaciones,
    'Colocación Total $': r.monto_colocacion_semanal,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Indicadores');
  XLSX.writeFile(wb, filename);
}

export function exportIndicadoresCSV(rows: IndicadorRow[], filename = 'Indicadores_McM.csv') {
  const headers = [
    'Ejecutivo',
    'Región',
    'Agencia',
    'Estatus',
    'Pagos Esperados',
    'Pagos Recibidos',
    '% Normalidad',
    '$ Esperado',
    '$ Recibido',
    'Clientes Vigentes',
    'Saldo Total',
    'Mora Total',
    '% Mora',
    'Clientes Nuevos',
    'Monto Nuevos',
    'Renovaciones',
    'Monto Renovaciones',
    'Colocación Total $',
  ];
  const body = rows.map((r) => [
    r.ejecutivo,
    regionDisplayName(r.region),
    r.agencia,
    r.estatus,
    r.pagos_esperados,
    r.pagos_recibidos,
    r.pct_normalidad != null ? Number((r.pct_normalidad * 100).toFixed(2)) : 0,
    r.monto_esperado,
    r.monto_recibido,
    r.clientes_vigentes,
    r.saldo_total,
    r.mora_total,
    Number((r.pct_mora * 100).toFixed(2)),
    r.clientes_nuevos,
    r.monto_nuevos,
    r.renovaciones,
    r.monto_renovaciones,
    r.monto_colocacion_semanal,
  ]);
  downloadCsv(headers, body, filename);
}

export function exportIndicadoresEstructuraCSV(
  root: TreeNode,
  expanded: Set<string>,
  filename = 'Indicadores_Estructura_McM.csv'
) {
  const levelNames = ['Total', 'Territorio', 'Región', 'Agencia', 'Ejecutivo'];
  const rows: Array<Array<string | number>> = [];
  const walk = (node: TreeNode) => {
    const normPct = node.m.pe > 0 ? Number(((node.m.pr / node.m.pe) * 100).toFixed(2)) : 0;
    const moraPct =
      node.m.saldo > 0 ? Number(((node.m.mora / node.m.saldo) * 100).toFixed(2)) : 0;
    rows.push([
      levelNames[node.lvl] || `Nivel ${node.lvl}`,
      node.label,
      node.estatus && node.estatus !== '-' ? node.estatus : '',
      node.m.pag,
      node.m.cli,
      node.m.pr,
      node.m.pe,
      normPct,
      node.m.saldo,
      moraPct,
    ]);
    if (node.kids.length > 0 && expanded.has(node.id)) {
      node.kids.forEach(walk);
    }
  };
  walk(root);
  downloadCsv(
    [
      'Nivel',
      'Unidad / Ejecutivo',
      'Estatus',
      'Desembolso',
      'Clientes',
      'Pagos Recibidos',
      'Pagos Esperados',
      '% Normalidad',
      'Saldo Total',
      '% Mora',
    ],
    rows,
    filename
  );
}

export function exportIndicadoresRankingCSV(
  best: IndicadorRow[],
  worst: IndicadorRow[],
  filename = 'Indicadores_Ranking_McM.csv'
) {
  const mapRow = (grupo: string, r: IndicadorRow, idx: number) => [
    grupo,
    idx + 1,
    r.ejecutivo,
    regionDisplayName(r.region),
    r.agencia,
    r.pagos_recibidos,
    r.pagos_esperados,
    r.pct_normalidad != null ? Number((r.pct_normalidad * 100).toFixed(2)) : 0,
  ];
  const rows = [
    ...best.map((r, i) => mapRow('Top 10 Mejores', r, i)),
    ...worst.map((r, i) => mapRow('Top 10 Menor Normalidad', r, i)),
  ];
  downloadCsv(
    [
      'Grupo',
      'Posición',
      'Ejecutivo',
      'Región',
      'Agencia',
      'Pagos Recibidos',
      'Pagos Esperados',
      '% Normalidad',
    ],
    rows,
    filename
  );
}

export function exportIndicadoresPDF(rows: IndicadorRow[], subtitle: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Indicadores McM — Detalle por Ejecutivo', 40, 36);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(subtitle, 40, 52);

  autoTable(doc, {
    startY: 64,
    styles: { fontSize: 7.5, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    head: [
      [
        'Ejecutivo',
        'Región',
        'Agencia',
        'Estatus',
        'Pagos Rec/Esp',
        'Normalidad',
        '$ Recibido',
        'Clientes',
        'Saldo',
        'Mora',
        'Nuevos',
        'Renov.',
      ],
    ],
    body: rows.map((r) => [
      r.ejecutivo,
      r.region,
      r.agencia,
      r.estatus,
      `${fmtNum(r.pagos_recibidos)} / ${fmtNum(r.pagos_esperados)}`,
      fmtPct(r.pct_normalidad),
      fmtMoney(r.monto_recibido),
      fmtNum(r.clientes_vigentes),
      fmtMoney(r.saldo_total),
      fmtMoney(r.mora_total),
      fmtNum(r.clientes_nuevos),
      fmtNum(r.renovaciones),
    ]),
  });
  doc.save('Indicadores_McM.pdf');
}

export function exportComisionesExcel(
  rows: ComisionEjecutivoRow[],
  filename = 'Comisiones_McM.xlsx'
) {
  const data = rows.map((r) => ({
    Ejecutivo: r.ejecutivo,
    Región: r.region,
    Agencia: r.agencia,
    Esquema: r.tipo_esquema,
    '% Normalidad': r.pct_normalidad != null ? Number((r.pct_normalidad * 100).toFixed(2)) : 0,
    'Cobranza Total Com.': comisionCobranzaTotalRow(r),
    'Colocación Incentivo': incentivoColocacionPagarRow(r),
    Descuentos: totalDescuentosRow(r),
    'Comisión Final': comisionPagarRow(r),
    'Retención Caja Ahorro': r.retencion_caja_ahorro,
    Retroactivos: r.retroactivos_otros_apoyos,
    'Total a Cobrar': r.total_a_cobrar,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comisiones');
  XLSX.writeFile(wb, filename);
}

export function exportComisionesCSV(
  rows: ComisionEjecutivoRow[],
  filename = 'Comisiones_McM.csv'
) {
  const headers = [
    'Ejecutivo',
    'Región',
    'Agencia',
    'Esquema',
    '% Normalidad',
    'Cobranza Total Com.',
    'Colocación Incentivo',
    'Descuentos',
    'Comisión Final',
    'Retención Caja Ahorro',
    'Retroactivos',
    'Total a Cobrar',
  ];
  const body = rows.map((r) => [
    r.ejecutivo,
    regionDisplayName(r.region),
    r.agencia,
    r.tipo_esquema,
    r.pct_normalidad != null ? Number((r.pct_normalidad * 100).toFixed(2)) : 0,
    comisionCobranzaTotalRow(r),
    incentivoColocacionPagarRow(r),
    totalDescuentosRow(r),
    comisionPagarRow(r),
    r.retencion_caja_ahorro,
    r.retroactivos_otros_apoyos,
    r.total_a_cobrar,
  ]);
  downloadCsv(headers, body, filename);
}

export function exportComisionesPDF(rows: ComisionEjecutivoRow[], subtitle: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Indicadores McM — Comisiones por Ejecutivo', 40, 36);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(subtitle, 40, 52);

  autoTable(doc, {
    startY: 64,
    styles: { fontSize: 7.5, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    head: [
      [
        'Ejecutivo',
        'Región',
        'Agencia',
        'Esquema',
        'Normalidad',
        'Com. Cobranza',
        'Com. Colocación',
        'Descuentos',
        'Comisión Final',
        'Total a Cobrar',
      ],
    ],
    body: rows.map((r) => [
      r.ejecutivo,
      r.region,
      r.agencia,
      r.tipo_esquema,
      fmtPct(r.pct_normalidad),
      fmtMoney(comisionCobranzaTotalRow(r)),
      fmtMoney(incentivoColocacionPagarRow(r)),
      fmtMoney(totalDescuentosRow(r)),
      fmtMoney(comisionPagarRow(r)),
      fmtMoney(r.total_a_cobrar),
    ]),
  });
  doc.save('Comisiones_McM.pdf');
}

export function exportDirectorioExcel(
  rows: DirectorioRow[],
  filename = 'Directorio_Comisiones_McM.xlsx'
) {
  const data = rows.map((r) => ({
    Colaborador: r.empleado,
    Rol: ROLE_LABELS[r.rol_persona] || r.rol_persona,
    Región: r.region,
    Agencia: r.agencia || 'Todas (Regional)',
    Estatus: r.estatus,
    '% Normalidad': r.pct_normalidad != null ? Number((r.pct_normalidad * 100).toFixed(2)) : 0,
    'Ej. Productivos': r.ejecutivos_productivos,
    'Total Ejecutivos': r.num_ejecutivos,
    'Com. Cobranza': r.comision_cobranza,
    'Com. Productividad': r.comision_productividad,
    'Apoyo Familiar': r.apoyo_familiar,
    'Incentivo Final': r.incentivo_final,
    'Total a Cobrar': r.total_a_cobrar,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Directorio');
  XLSX.writeFile(wb, filename);
}

export function exportDirectorioCSV(
  rows: DirectorioRow[],
  filename = 'Directorio_Comisiones_McM.csv'
) {
  const headers = [
    'Colaborador',
    'Rol',
    'Región',
    'Agencia',
    'Estatus',
    '% Normalidad',
    'Ej. Productivos',
    'Total Ejecutivos',
    'Com. Cobranza',
    'Com. Productividad',
    'Apoyo Familiar',
    'Incentivo Final',
    'Total a Cobrar',
  ];
  const body = rows.map((r) => [
    r.empleado,
    ROLE_LABELS[r.rol_persona] || r.rol_persona,
    regionDisplayName(r.region),
    r.agencia || 'Todas (Regional)',
    r.estatus,
    r.pct_normalidad != null ? Number((r.pct_normalidad * 100).toFixed(2)) : 0,
    r.ejecutivos_productivos,
    r.num_ejecutivos,
    r.comision_cobranza,
    r.comision_productividad,
    r.apoyo_familiar,
    r.incentivo_final,
    r.total_a_cobrar,
  ]);
  downloadCsv(headers, body, filename);
}

export function exportDirectorioPDF(rows: DirectorioRow[], subtitle: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Indicadores McM — Directorio Jerárquico de Comisiones', 40, 36);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(subtitle, 40, 52);

  autoTable(doc, {
    startY: 64,
    styles: { fontSize: 7.5, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    head: [
      [
        'Colaborador',
        'Rol',
        'Región',
        'Agencia',
        'Normalidad',
        'Prod. Equipo',
        'Com. Cobranza',
        'Incentivo Final',
        'Total a Cobrar',
      ],
    ],
    body: rows.map((r) => [
      r.empleado,
      ROLE_LABELS[r.rol_persona] || r.rol_persona,
      r.region,
      r.agencia || '—',
      fmtPct(r.pct_normalidad),
      `${fmtNum(r.ejecutivos_productivos)} / ${fmtNum(r.num_ejecutivos)}`,
      fmtMoney(r.comision_cobranza),
      fmtMoney(r.incentivo_final),
      fmtMoney(r.total_a_cobrar),
    ]),
  });
  doc.save('Directorio_Comisiones_McM.pdf');
}

export function exportPendingUsersExcel(pending: PendingUserCandidate[]) {
  const data = pending.map((p) => ({
    Nombre: p.nombre,
    Rol: ROLE_LABELS[p.role] || p.role,
    Semana: p.semana,
    Scopes: p.scopes.map((s) => (s.agencia ? `${s.region} / ${s.agencia}` : s.region)).join(' · '),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pendientes');
  XLSX.writeFile(wb, 'Usuarios_Pendientes_McM.xlsx');
}

export function exportPendingUsersPDF(pending: PendingUserCandidate[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(13);
  doc.text('Usuarios Pendientes de Autorización — McM', 40, 36);
  autoTable(doc, {
    startY: 52,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    head: [['Nombre', 'Rol', 'Semana', 'Scope Detectado']],
    body: pending.map((p) => [
      p.nombre,
      ROLE_LABELS[p.role] || p.role,
      String(p.semana),
      p.scopes.map((s) => (s.agencia ? `${s.region} / ${s.agencia}` : s.region)).join(' · '),
    ]),
  });
  doc.save('Usuarios_Pendientes_McM.pdf');
}

export function exportActiveUsersExcel(users: UserRecord[]) {
  const data = users.map((u) => ({
    Usuario: u.username,
    Nombre: u.nombre,
    Rol: ROLE_LABELS[u.role] || u.role,
    Estado: u.estado,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Usuarios');
  XLSX.writeFile(wb, 'Usuarios_Activos_McM.xlsx');
}

export function exportActiveUsersPDF(users: UserRecord[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(13);
  doc.text('Directorio de Usuarios — McM', 40, 36);
  autoTable(doc, {
    startY: 52,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    head: [['Usuario', 'Nombre', 'Rol', 'Estado']],
    body: users.map((u) => [u.username, u.nombre, ROLE_LABELS[u.role] || u.role, u.estado]),
  });
  doc.save('Usuarios_Activos_McM.pdf');
}

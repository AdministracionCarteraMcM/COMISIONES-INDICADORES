import React from 'react';

export interface KpiIconProps {
  className?: string;
  variant?: 'color' | 'light';
}

/**
 * Fajo de billetes (Colocación Total / Desembolsos)
 */
export const BanknotesBundleIcon: React.FC<KpiIconProps> = ({
  className = 'w-9 h-9',
  variant = 'color',
}) => {
  if (variant === 'light') {
    return (
      <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
        {/* Bottom stacked bills */}
        <rect x="6" y="21" width="28" height="12" rx="2.5" fill="white" fillOpacity="0.22" stroke="white" strokeWidth="1.5" />
        <rect x="6" y="16" width="28" height="12" rx="2.5" fill="white" fillOpacity="0.32" stroke="white" strokeWidth="1.5" />
        {/* Top banknote */}
        <rect x="6" y="10" width="28" height="13" rx="2.5" fill="white" fillOpacity="0.92" stroke="white" strokeWidth="1.5" />
        {/* Center currency strap / fajo */}
        <rect x="16.5" y="9.5" width="7" height="24" rx="1.2" fill="#1D4ED8" fillOpacity="0.88" stroke="white" strokeWidth="1.2" />
        {/* $ emblem on strap */}
        <path
          d="M20 13.5v6m1.6-4.7c0-.7-.7-1.1-1.6-1.1s-1.6.4-1.6 1.1.6 1 1.6 1.2 1.6.5 1.6 1.3-.7 1.1-1.6 1.1-1.6-.4-1.6-1.1"
          stroke="white"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        {/* Corner bill pips */}
        <circle cx="10.5" cy="16.5" r="1.3" fill="#1D4ED8" fillOpacity="0.6" />
        <circle cx="29.5" cy="16.5" r="1.3" fill="#1D4ED8" fillOpacity="0.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      {/* Bottom stacked bills */}
      <rect x="5" y="21" width="30" height="12" rx="2.5" fill="#A7F3D0" stroke="#059669" strokeWidth="1.5" />
      <rect x="5" y="16" width="30" height="12" rx="2.5" fill="#6EE7B7" stroke="#059669" strokeWidth="1.5" />
      {/* Top banknote */}
      <rect x="5" y="10" width="30" height="13" rx="2.5" fill="#D1FAE5" stroke="#047857" strokeWidth="1.6" />
      {/* Inner frame */}
      <rect x="7.8" y="12.5" width="24.4" height="8" rx="1" stroke="#10B981" strokeWidth="1" strokeDasharray="2 1.5" />
      {/* Center strap */}
      <rect x="16.5" y="9.5" width="7" height="24" rx="1.2" fill="#F59E0B" stroke="#B45309" strokeWidth="1.3" />
      {/* $ emblem */}
      <path
        d="M20 13.5v6m1.5-4.7c0-.65-.65-1.05-1.5-1.05s-1.5.4-1.5 1.05.55.95 1.5 1.15 1.5.5 1.5 1.2-.65 1.05-1.5 1.05-1.5-.4-1.5-1.05"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
};

/**
 * Cartera Vencida / Mora (Monedas + reloj/alerta de vencimiento)
 */
export const OverduePortfolioIcon: React.FC<KpiIconProps> = ({
  className = 'w-9 h-9',
  variant = 'color',
}) => {
  if (variant === 'light') {
    return (
      <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
        {/* Coin stack */}
        <ellipse cx="15" cy="28" rx="8.5" ry="3.2" fill="white" fillOpacity="0.28" stroke="white" strokeWidth="1.4" />
        <path d="M6.5 23v5c0 1.77 3.8 3.2 8.5 3.2s8.5-1.43 8.5-3.2v-5" stroke="white" strokeWidth="1.4" />
        <ellipse cx="15" cy="23" rx="8.5" ry="3.2" fill="white" fillOpacity="0.4" stroke="white" strokeWidth="1.4" />
        <path d="M6.5 18v5c0 1.77 3.8 3.2 8.5 3.2s8.5-1.43 8.5-3.2v-5" stroke="white" strokeWidth="1.4" />
        <ellipse cx="15" cy="18" rx="8.5" ry="3.2" fill="white" fillOpacity="0.9" stroke="white" strokeWidth="1.4" />
        {/* Warning badge */}
        <path
          d="M27.5 10.5l7.5 13a1.2 1.2 0 0 1-1.04 1.8H21.04A1.2 1.2 0 0 1 20 23.5l7.5-13a1.2 1.2 0 0 1 2.08 0Z"
          fill="#FEF3C7"
          stroke="white"
          strokeWidth="1.4"
        />
        <path d="M27.5 15.5v4.2" stroke="#B91C1C" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="27.5" cy="22.1" r="1" fill="#B91C1C" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <ellipse cx="15" cy="28" rx="8.5" ry="3.2" fill="#FECACA" stroke="#DC2626" strokeWidth="1.4" />
      <ellipse cx="15" cy="23" rx="8.5" ry="3.2" fill="#FCA5A5" stroke="#DC2626" strokeWidth="1.4" />
      <ellipse cx="15" cy="18" rx="8.5" ry="3.2" fill="#FEE2E2" stroke="#B91C1C" strokeWidth="1.4" />
      <path
        d="M27.5 10.5l7.5 13a1.2 1.2 0 0 1-1.04 1.8H21.04A1.2 1.2 0 0 1 20 23.5l7.5-13a1.2 1.2 0 0 1 2.08 0Z"
        fill="#FEF3C7"
        stroke="#D97706"
        strokeWidth="1.5"
      />
      <path d="M27.5 15.5v4.2" stroke="#B91C1C" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="27.5" cy="22.1" r="1" fill="#B91C1C" />
    </svg>
  );
};

/**
 * Número de Créditos (Expedientes / contratos de crédito apilados)
 */
export const CreditContractsIcon: React.FC<KpiIconProps> = ({
  className = 'w-9 h-9',
  variant = 'color',
}) => {
  if (variant === 'light') {
    return (
      <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
        {/* Back contract */}
        <rect x="13" y="6.5" width="18" height="23" rx="2.5" fill="white" fillOpacity="0.22" stroke="white" strokeWidth="1.4" />
        {/* Front contract */}
        <rect x="8.5" y="10.5" width="19" height="23" rx="2.5" fill="white" fillOpacity="0.94" stroke="white" strokeWidth="1.4" />
        <path d="M12.5 16h11M12.5 20.5h8" stroke="#1E293B" strokeWidth="1.6" strokeLinecap="round" />
        {/* Approved check circle */}
        <circle cx="26.5" cy="26.5" r="6.5" fill="#10B981" stroke="white" strokeWidth="1.5" />
        <path d="M23.8 26.5l1.8 1.9 3.6-3.7" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect x="13" y="6.5" width="18" height="23" rx="2.5" fill="#E2E8F0" stroke="#475569" strokeWidth="1.4" />
      <rect x="8.5" y="10.5" width="19" height="23" rx="2.5" fill="#FFFFFF" stroke="#334155" strokeWidth="1.5" />
      <path d="M12.5 16h11M12.5 20.5h8" stroke="#475569" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="26.5" cy="26.5" r="6.5" fill="#10B981" stroke="#FFFFFF" strokeWidth="1.5" />
      <path d="M23.8 26.5l1.8 1.9 3.6-3.7" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/**
 * Normalidad de Cartera (Escudo con check de cumplimiento)
 */
export const NormalityShieldIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <path
      d="M20 5.5L8.5 10.2v8.9c0 7.5 4.9 14 11.5 15.9 6.6-1.9 11.5-8.4 11.5-15.9v-8.9L20 5.5Z"
      fill="#D1FAE5"
      stroke="#059669"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path
      d="M15 20.2l3.4 3.4 7-7.2"
      stroke="#047857"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Pagaré Total (Documento de pagaré firmado con sello $)
 */
export const PromissoryNoteIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <rect x="7" y="6" width="22" height="28" rx="3" fill="#EEF2FF" stroke="#4338CA" strokeWidth="1.6" />
    <path d="M12 12.5h12M12 17h9" stroke="#4F46E5" strokeWidth="1.6" strokeLinecap="round" />
    {/* Signature squiggle */}
    <path
      d="M11.5 26.5c1.8-2.2 3-2.2 4.2 0s2.4 1.5 4.5-1"
      stroke="#312E81"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Gold seal badge */}
    <circle cx="28.5" cy="27.5" r="6.5" fill="#FDE68A" stroke="#D97706" strokeWidth="1.5" />
    <path
      d="M28.5 24.2v6.6m1.4-5.1c0-.6-.6-.95-1.4-.95s-1.4.35-1.4.95.5.85 1.4 1.05 1.4.45 1.4 1.1-.6.95-1.4.95-1.4-.35-1.4-.95"
      stroke="#B45309"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Cobranza $ Recibida (Monedas cayendo / bolsa de recaudación)
 */
export const CashCollectionIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    {/* Coin top */}
    <circle cx="25" cy="11.5" r="5.5" fill="#FDE68A" stroke="#D97706" strokeWidth="1.5" />
    <path d="M25 8.8v5.4" stroke="#B45309" strokeWidth="1.4" strokeLinecap="round" />
    {/* Money bag / wallet */}
    <path
      d="M9 17.5c0-1.66 1.34-3 3-3h14c1.66 0 3 1.34 3 3v12.5a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V17.5Z"
      fill="#DBEAFE"
      stroke="#2563EB"
      strokeWidth="1.6"
    />
    <path
      d="M23 22h7a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 30 27h-7a2.5 2.5 0 0 1 0-5Z"
      fill="#93C5FD"
      stroke="#1D4ED8"
      strokeWidth="1.4"
    />
    <circle cx="24" cy="24.5" r="1" fill="#1E3A8A" />
    {/* Downward receive arrow */}
    <path d="M15.5 8v8m0 0-2.5-2.5M15.5 16l2.5-2.5" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Clientes Vigentes (Grupo de clientes activos)
 */
export const ActiveClientsIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    {/* Side user */}
    <circle cx="27.5" cy="14" r="4" fill="#E0F2FE" stroke="#0284C7" strokeWidth="1.5" />
    <path d="M22.5 29c.5-4 2.7-6.5 6-6.5 3.1 0 5.1 2.3 5.5 6.5" stroke="#0284C7" strokeWidth="1.5" strokeLinecap="round" />
    {/* Main user */}
    <circle cx="15.5" cy="13.5" r="5" fill="#DBEAFE" stroke="#2563EB" strokeWidth="1.6" />
    <path
      d="M6.5 30.5c.6-5.2 4.1-8.5 9-8.5s8.4 3.3 9 8.5"
      fill="#EFF6FF"
      stroke="#2563EB"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    {/* Active dot */}
    <circle cx="29.5" cy="29.5" r="4.5" fill="#10B981" stroke="#FFFFFF" strokeWidth="1.4" />
    <path d="M27.7 29.5l1.2 1.3 2.4-2.4" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Promedio por Ejecutivo / Asesor (Ejecutivo con portafolio y meta)
 */
export const AdvisorTargetIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <circle cx="15.5" cy="12.5" r="4.8" fill="#FEF3C7" stroke="#D97706" strokeWidth="1.6" />
    <path
      d="M7 29.5c.7-4.9 3.8-8 8.5-8 4.7 0 7.8 3.1 8.5 8"
      fill="#FFFBEB"
      stroke="#D97706"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    {/* Briefcase / Target chart */}
    <rect x="21" y="21" width="13.5" height="11" rx="2" fill="#E0E7FF" stroke="#4338CA" strokeWidth="1.5" />
    <path d="M24.5 28.5l2.5-2.8 2 1.8 3-3.5" stroke="#4338CA" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Bonos / Otros Incentivos (Medalla / trofeo)
 */
export const BonusTrophyIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <path
      d="M13 9h14v9a7 7 0 0 1-14 0V9Z"
      fill="#FEF3C7"
      stroke="#D97706"
      strokeWidth="1.6"
    />
    <path d="M13 11.5H9.5a2.5 2.5 0 0 0 0 5H13M27 11.5h3.5a2.5 2.5 0 0 1 0 5H27" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M20 25v5M14.5 32h11" stroke="#B45309" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M20 12.5l1 2.2 2.4.3-1.8 1.6.5 2.3-2.1-1.1-2.1 1.1.5-2.3-1.8-1.6 2.4-.3 1-2.2Z" fill="#F59E0B" />
  </svg>
);

/**
 * Descuentos y Préstamos (Recibo con signo de deducción)
 */
export const DeductionsReceiptIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <path
      d="M10 7.5h20v25l-3.3-2.2L23.3 32.5 20 30.3l-3.3 2.2-3.4-2.2L10 32.5v-25Z"
      fill="#FEF2F2"
      stroke="#DC2626"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M14.5 14h11M14.5 18.5h7" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="24" cy="24" r="3.8" fill="#FEE2E2" stroke="#DC2626" strokeWidth="1.4" />
    <path d="M22.2 24h3.6" stroke="#B91C1C" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

/**
 * Total a Cobrar / Nómina (Sobre / cartera con dinero neto)
 */
export const PaycheckWalletIcon: React.FC<KpiIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <rect x="6" y="12" width="28" height="20" rx="3" fill="#D1FAE5" stroke="#059669" strokeWidth="1.6" />
    <path d="M9 12l7-5h8l7 5" fill="#A7F3D0" stroke="#059669" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="20" cy="22" r="5" fill="#FFFFFF" stroke="#047857" strokeWidth="1.5" />
    <path
      d="M20 19v6m1.3-4.6c0-.55-.55-.9-1.3-.9s-1.3.35-1.3.9.45.8 1.3 1 1.3.4 1.3 1-.55.9-1.3.9-1.3-.35-1.3-.9"
      stroke="#047857"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Semáforo de Sucursales / Agencias
 */
export const BranchStatusIcon: React.FC<{ tone: 'green' | 'amber' | 'red'; className?: string }> = ({
  tone,
  className = 'w-6 h-6',
}) => {
  const palette =
    tone === 'green'
      ? { bg: '#D1FAE5', stroke: '#059669', roof: '#A7F3D0', dot: '#10B981' }
      : tone === 'amber'
      ? { bg: '#FEF3C7', stroke: '#D97706', roof: '#FDE68A', dot: '#F59E0B' }
      : { bg: '#FEE2E2', stroke: '#DC2626', roof: '#FECACA', dot: '#EF4444' };

  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <path d="M6 16L20 7l14 9H6Z" fill={palette.roof} stroke={palette.stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="8.5" y="16" width="23" height="16" rx="1.5" fill={palette.bg} stroke={palette.stroke} strokeWidth="1.6" />
      <rect x="16.5" y="22" width="7" height="10" rx="1" fill="#FFFFFF" stroke={palette.stroke} strokeWidth="1.3" />
      <circle cx="31.5" cy="11" r="4.5" fill={palette.dot} stroke="#FFFFFF" strokeWidth="1.4" />
    </svg>
  );
};

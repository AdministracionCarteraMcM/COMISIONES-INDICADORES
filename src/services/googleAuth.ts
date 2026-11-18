import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

function createProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  return provider;
}

// In-memory only token cache — never persisted in localStorage/sessionStorage.
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearCachedAccessToken(): void {
  cachedAccessToken = null;
}

export function formatGoogleAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const rawMsg = err instanceof Error ? err.message : String(err || '');

  if (code === 'auth/popup-blocked') {
    return 'El navegador bloqueó la ventana emergente de Google. Permite las ventanas emergentes para este sitio, abre la vista previa en una pestaña independiente o usa "Conexión directa con Google". [auth/popup-blocked]';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return `Se cerró o canceló la ventana de acceso antes de completar la autorización. Si estás dentro de una vista embebida, intenta con "Conexión directa con Google" o abre la app en pestaña independiente. [${code}]`;
  }
  if (code === 'auth/unauthorized-domain') {
    return `El dominio actual (${window.location.hostname}) no está autorizado en Firebase Auth. Abre la app en una pestaña con el dominio oficial o usa "Conexión directa con Google". [${code}]`;
  }
  if (code === 'auth/operation-not-allowed') {
    return 'El proveedor de Google no está habilitado en Firebase Auth. [auth/operation-not-allowed]';
  }
  if (code === 'auth/network-request-failed') {
    return 'Error de red al contactar con Google Auth. Verifica tu conexión e intenta nuevamente. [auth/network-request-failed]';
  }
  if (code) {
    return `${rawMsg || 'Error autenticando con Google.'} [${code}]`;
  }
  return rawMsg || 'No se pudo completar el inicio de sesión con Google.';
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string;
}> {
  if (isSigningIn) {
    throw new Error('Ya hay una solicitud de acceso en curso. Completa o cierra la ventana abierta.');
  }
  isSigningIn = true;
  try {
    const provider = createProvider();
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken;
    if (!token) {
      throw new Error(
        'No se recibió el token de acceso de Google. Verifica haber marcado las casillas de permisos de Google Sheets y Drive.'
      );
    }
    cachedAccessToken = token;
    return { user: result.user, accessToken: token };
  } finally {
    isSigningIn = false;
  }
}

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleAccountsWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (resp: GisTokenResponse) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
      };
    };
  };
}

function loadGisScript(): Promise<void> {
  const win = window as GoogleAccountsWindow;
  if (win.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity Services.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services.'));
    document.head.appendChild(script);
  });
}

export async function signInWithGoogleGIS(): Promise<{
  accessToken: string;
  email?: string;
}> {
  const clientId = firebaseConfig.oAuthClientId;
  if (!clientId) {
    throw new Error('Falta oAuthClientId en firebase-applet-config.json.');
  }
  await loadGisScript();
  const win = window as GoogleAccountsWindow;
  const oauth2 = win.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google Identity Services no se inicializó correctamente.');
  }

  const token = await new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: WORKSPACE_SCOPES.join(' '),
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        if (!resp.access_token) {
          reject(new Error('Google no devolvió un token de acceso válido.'));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'La ventana de autorización fue bloqueada o cerrada.'));
      },
    });
    client.requestAccessToken({ prompt: 'consent' });
  });

  cachedAccessToken = token;
  return { accessToken: token };
}

export async function signOutGoogleWorkspace(): Promise<void> {
  cachedAccessToken = null;
  await signOut(auth);
}

export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user && !isSigningIn) {
      cachedAccessToken = null;
    }
    callback(user);
  });
}

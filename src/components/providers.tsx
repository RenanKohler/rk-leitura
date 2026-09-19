"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CheckIcon } from "@/components/icons";
import type { FontFamily, ReadingMode } from "@/lib/reading";

/* -------------------------------------------------------------------------- */
/* Tema                                                                        */
/* -------------------------------------------------------------------------- */

export type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "rk-leitura:theme";

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Script inline executado antes da primeira pintura. Sem ele a pagina aparece
 * clara por um quadro antes do tema escuro ser aplicado.
 */
export const themeBootstrapScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)})||"system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

/**
 * A preferencia vive no localStorage, fora do React. useSyncExternalStore e a
 * forma correta de ler esse tipo de fonte: evita o setState dentro de efeito
 * que causaria uma renderizacao extra a cada montagem.
 */
const themeStore = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    themeStore.listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      // Outra aba mudou o tema.
      if (event.key === THEME_STORAGE_KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      themeStore.listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): ThemePreference {
    try {
      return (localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null) ?? "system";
    } catch {
      return "system";
    }
  },
  // No servidor nao ha localStorage; "system" e o mesmo valor que o script
  // inline assume antes de ler o armazenamento.
  getServerSnapshot(): ThemePreference {
    return "system";
  },
  set(preference: ThemePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Modo privativo: segue apenas em memoria ate a proxima carga.
    }
    for (const listener of themeStore.listeners) listener();
  },
};

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return preference === "dark" || (preference === "system" && prefersDark) ? "dark" : "light";
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot
  );

  // O DOM e um sistema externo: aplicar o atributo aqui e o uso pretendido
  // de useEffect, sem nenhum setState envolvido.
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(preference);

    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.dataset.theme = resolveTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, setPreference: themeStore.set }),
    [preference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme precisa estar dentro de Providers");
  return context;
}

/* -------------------------------------------------------------------------- */
/* Avisos                                                                      */
/* -------------------------------------------------------------------------- */

interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
}

const ToastContext = createContext<((message: string, tone?: Toast["tone"]) => void) | null>(null);

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        aria-live="polite"
        className="pb-safe pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 in-data-[sheet=aberta]:bottom-auto in-data-[sheet=aberta]:top-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-rise flex max-w-sm items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-float ${
              toast.tone === "error"
                ? "bg-danger text-white"
                : toast.tone === "success"
                  ? "bg-positive text-white"
                  : "bg-ink text-bg"
            }`}
          >
            {toast.tone === "success" ? <CheckIcon className="size-4 shrink-0" /> : null}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast precisa estar dentro de Providers");
  return context;
}

/* -------------------------------------------------------------------------- */
/* Autenticacao                                                                */
/* -------------------------------------------------------------------------- */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  /** Reflete na interface o usuario devolvido por uma alteracao de conta. */
  setUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser: AuthUser | null;
}) {
  // O servidor ja resolveu a sessao ao renderizar a pagina. Buscar /api/auth/me
  // na montagem custava uma ida e volta em toda navegacao, so para reconfirmar
  // o que o HTML ja trazia.
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const loading = false;

  const submit = useCallback(
    async (path: string, payload: Record<string, string>): Promise<{ error?: string }> => {
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { error: data.error ?? "Nao foi possivel concluir." };
        setUser(data.user);
        return {};
      } catch {
        return { error: "Sem conexao com o servidor." };
      }
    },
    []
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: (email, password) => submit("/api/auth/login", { email, password }),
      register: (name, email, password) => submit("/api/auth/register", { name, email, password }),
      logout: async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } finally {
          setUser(null);
          // Recarrega pela raiz para o middleware reavaliar a sessao.
          window.location.href = "/login";
        }
      },
      setUser,
    }),
    [user, loading, submit]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de Providers");
  return context;
}

/* -------------------------------------------------------------------------- */
/* Preferencias de leitura                                                     */
/* -------------------------------------------------------------------------- */

export interface ReadingSettings {
  baseWpm: number;
  wordsPerChunk: number;
  highlightOpacity: number;
  fontScale: number;
  fontFamily: FontFamily;
  lineHeightStep: number;
  warmup: boolean;
  readingMode: ReadingMode;
  theme: ThemePreference;
}

export const FALLBACK_SETTINGS: ReadingSettings = {
  baseWpm: 300,
  wordsPerChunk: 1,
  highlightOpacity: 0.35,
  fontScale: 3,
  fontFamily: "sans",
  lineHeightStep: 2,
  warmup: true,
  readingMode: "rsvp",
  theme: "system",
};

interface SettingsContextValue {
  settings: ReadingSettings;
  loading: boolean;
  save: (patch: Partial<ReadingSettings>) => Promise<boolean>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function SettingsProvider({
  children,
  initialSettings,
}: {
  children: ReactNode;
  initialSettings: ReadingSettings;
}) {
  // Tambem vem pronto do servidor: era a segunda ida e volta antes de a tela
  // saber em que ritmo e em que modo renderizar.
  const [settings, setSettings] = useState<ReadingSettings>(initialSettings);
  const loading = false;

  const save = useCallback(
    async (patch: Partial<ReadingSettings>) => {
      const next = { ...settings, ...patch };
      // Atualiza a tela na hora; o servidor confirma em seguida.
      setSettings(next);
      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!response.ok) return false;
        const data = await response.json();
        if (data.settings) setSettings({ ...FALLBACK_SETTINGS, ...data.settings });
        return true;
      } catch {
        return false;
      }
    },
    [settings]
  );

  const value = useMemo(() => ({ settings, loading, save }), [settings, loading, save]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings precisa estar dentro de Providers");
  return context;
}

/* -------------------------------------------------------------------------- */

export function Providers({
  children,
  initialUser,
  initialSettings,
}: {
  children: ReactNode;
  initialUser: AuthUser | null;
  initialSettings: ReadingSettings;
}) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider initialUser={initialUser}>
          <SettingsProvider initialSettings={initialSettings}>{children}</SettingsProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

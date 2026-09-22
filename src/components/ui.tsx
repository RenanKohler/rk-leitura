"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import Link from "next/link";
import { BackIcon, CloseIcon, ForwardIcon } from "@/components/icons";

/* -------------------------------------------------------------------------- */
/* Botao                                                                       */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-card",
  secondary: "bg-surface text-ink border border-border hover:border-border-strong",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger-soft text-danger hover:brightness-95",
};

// Alturas minimas de 44px: abaixo disso o alvo de toque falha no celular.
const SIZES: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm gap-1.5",
  md: "min-h-11 px-4 text-sm gap-2",
  lg: "min-h-13 px-5 text-base gap-2",
};

const BASE =
  "inline-flex items-center justify-center rounded-full font-medium transition-colors duration-150 disabled:opacity-45 disabled:pointer-events-none select-none";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, full, className = "", children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  full,
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Superficies                                                                 */
/* -------------------------------------------------------------------------- */

export function Card({
  className = "",
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Tag className={`rounded-card border border-border bg-surface shadow-card ${className}`}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Campos                                                                      */
/* -------------------------------------------------------------------------- */

const FIELD_BASE =
  "w-full rounded-2xl border border-border bg-surface px-4 text-base text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none disabled:opacity-60";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, id, className = "", ...props },
  ref
) {
  // Sem um id estavel o `htmlFor` do rotulo fica indefinido e a associacao
  // com o campo se perde para leitores de tela.
  const generated = useId();
  const inputId = id ?? props.name ?? generated;
  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-muted">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={`${FIELD_BASE} min-h-13 ${error ? "border-danger" : ""} ${className}`}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : hint ? (
        <p className="text-sm text-faint">{hint}</p>
      ) : null}
    </div>
  );
});

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, id, className = "", ...props },
  ref
) {
  const generated = useId();
  const inputId = id ?? props.name ?? generated;
  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-muted">
          {label}
        </label>
      ) : null}
      <textarea ref={ref} id={inputId} className={`${FIELD_BASE} py-3 ${className}`} {...props} />
      {hint ? <p className="text-sm text-faint">{hint}</p> : null}
    </div>
  );
});

export function Alert({ tone = "danger", children }: { tone?: "danger" | "positive"; children: ReactNode }) {
  const styles =
    tone === "danger" ? "bg-danger-soft text-danger" : "bg-positive-soft text-positive";
  return (
    <p role="alert" className={`rounded-2xl px-4 py-3 text-sm ${styles}`}>
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Controle segmentado                                                         */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-surface-2 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
              active ? "bg-surface text-ink shadow-card" : "text-muted"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Slider                                                                      */
/* -------------------------------------------------------------------------- */

export function Slider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium text-ink">{label}</label>
        <span className="tabular text-sm font-semibold text-accent">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        // h-8 amplia a area de toque sem engordar a trilha visual.
        className="h-8 w-full cursor-pointer accent-accent"
      />
      {hint ? <p className="text-sm text-faint">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Estados                                                                     */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-faint">
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-xs text-sm text-muted">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

/* -------------------------------------------------------------------------- */
/* Sheet: folha inferior no celular, dialogo centralizado a partir de sm       */
/* -------------------------------------------------------------------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Foco (US-75): entra na folha ao abrir, fica preso nela enquanto aberta e
  // volta ao controle que a abriu ao fechar. Sem isso, quem navega por
  // teclado ou leitor de tela continuava andando pela tela de tras.
  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog ? focusableIn(dialog)[0] : undefined;
    (first ?? dialog)?.focus();

    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) trapTab(event, dialogRef.current);
    };

    // Trava o scroll do fundo enquanto a folha esta aberta.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Marca para o aviso flutuante sair de baixo: ali ele cairia em cima do
    // conteudo da folha, que ocupa justamente o rodape da tela.
    document.body.dataset.sheet = "aberta";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      delete document.body.dataset.sheet;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm animate-fade"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-rise relative focus:outline-none flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-border bg-surface shadow-float sm:max-w-lg sm:rounded-3xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <CloseIcon className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="pb-safe border-t border-border px-5 py-4">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0
  );
}

/** Tab e Shift+Tab dao a volta dentro da folha em vez de sair dela. */
function trapTab(event: KeyboardEvent, root: HTMLElement) {
  const items = focusableIn(root);
  if (items.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }

  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/* -------------------------------------------------------------------------- */
/* Paginacao                                                                   */
/* -------------------------------------------------------------------------- */

export function Pagination({
  page,
  pageCount,
  onChange,
  busy,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Paginacao" className="flex items-center justify-between gap-2 pt-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <BackIcon className="size-4" />
        Anterior
      </Button>

      <p aria-live="polite" className="tabular text-sm text-muted">
        {`${page} de ${pageCount}`}
      </p>

      <Button
        variant="secondary"
        size="sm"
        disabled={busy || page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Proxima
        <ForwardIcon className="size-4" />
      </Button>
    </nav>
  );
}

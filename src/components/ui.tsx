"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
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

/** Classes de botao para elementos que nao sao `<button>`, como um link de download. */
export function buttonClasses(variant: Variant = "primary", size: Size = "md"): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

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

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
}

/** Lista de escolha com o mesmo rotulo e acabamento dos outros campos. */
export function SelectField({ label, hint, options, id, className = "", ...props }: SelectFieldProps) {
  const generated = useId();
  const inputId = id ?? props.name ?? generated;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-muted">
        {label}
      </label>
      <select id={inputId} className={`${FIELD_BASE} min-h-13 ${className}`} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="text-sm text-faint">{hint}</p> : null}
    </div>
  );
}

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

/**
 * Escolha unica entre poucas opcoes (A11Y-8).
 *
 * E um grupo de radios, e nao de botoes de alternar: so uma opcao vale por
 * vez, e e isso que o leitor de tela precisa anunciar. O teclado segue o
 * padrao de radiogroup - Tab entra e sai do grupo numa parada so, as setas
 * trocam a opcao (tabindex rotativo).
 *
 * O rotulo aparece como texto acima do grupo; `hideLabel` o deixa so para o
 * leitor de tela, quando a secao ja tem um titulo que diz a mesma coisa.
 * A opcao escolhida tem contorno de 2px no acento: a diferenca so de fundo
 * entre a pilula e o trilho ficava abaixo de 3:1 no tema escuro.
 * As opcoes quebram linha quando nao cabem (reflow em 320px, A11Y-17).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  hideLabel = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
  /** Rotulo so para leitor de tela, quando ja ha titulo visivel. */
  hideLabel?: boolean;
}) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((option) => option.value === value);
  // Sem opcao escolhida, a primeira recebe a parada de Tab.
  const tabStop = selected === -1 ? 0 : selected;

  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    const last = options.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div className="space-y-1.5">
      <p id={labelId} className={hideLabel ? "sr-only" : "text-sm font-medium text-muted"}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1 rounded-3xl bg-surface-2 p-1"
      >
        {options.map((option, index) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`flex min-h-10 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors ${
                active
                  ? "bg-surface text-ink shadow-card ring-2 ring-accent ring-inset"
                  : "text-muted hover:text-ink"
              }`}
            >
              {option.icon ? (
                // Abaixo de 360px os icones saem para as opcoes caberem.
                <span className="hidden min-[360px]:inline-flex" aria-hidden="true">
                  {option.icon}
                </span>
              ) : null}
              {option.label}
            </button>
          );
        })}
      </div>
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
  children,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  /** Conteudo extra abaixo da dica, como a faixa de velocidade. */
  children?: ReactNode;
  onChange: (value: number) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span className="tabular text-sm font-semibold text-accent" aria-hidden="true">
          {display}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        // Sem isto o leitor de tela anuncia "3" onde a tela diz "3 de 5" ou
        // "Folgado" - o numero cru nao diz nada (A11Y-16).
        aria-valuetext={display}
        aria-describedby={hint ? hintId : undefined}
        // h-11: area de toque de 44px sem engordar a trilha visual (UX-12).
        className="h-11 w-full cursor-pointer accent-accent"
      />
      {hint ? (
        <p id={hintId} className="text-sm text-faint">
          {hint}
        </p>
      ) : null}
      {children}
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
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Elemento que recebe o foco ao abrir (A11Y-13). Sem ele o foco vai para o
   * primeiro controle, que costuma ser o Fechar - bom para uma confirmacao,
   * ruim para uma folha de busca, onde a pessoa abre para digitar.
   */
  initialFocus?: RefObject<HTMLElement | null>;
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
    const chosen = initialFocus?.current;
    const first = dialog ? focusableIn(dialog)[0] : undefined;
    (chosen ?? first ?? dialog)?.focus();

    return () => {
      if (opener?.isConnected) opener.focus();
    };
    // A ref e lida na abertura; trocar de ref com a folha aberta nao move o foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            // 44px de alvo de toque (UX-12); o icone continua do mesmo tamanho.
            className="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
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
    <nav aria-label="Paginação" className="flex items-center justify-between gap-2 pt-1">
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
        Próxima
        <ForwardIcon className="size-4" />
      </Button>
    </nav>
  );
}

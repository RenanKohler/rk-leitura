"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
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

/*
 * Botoes comuns do M3. Os nomes das variantes sao os que as telas ja usam:
 *   primary    filled    acao principal da tela
 *   secondary  outlined  acao alternativa
 *   ghost      text      acao de baixa enfase
 *   danger     filled no papel de erro
 * Desabilitado: conteudo a 38% e recipiente a 12% de on-surface.
 */
const FILLED_DISABLED = "disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none";
const VARIANTS: Record<Variant, string> = {
  primary: `bg-primary text-on-primary hover:shadow-elevation-1 ${FILLED_DISABLED}`,
  secondary:
    "border border-outline text-primary disabled:border-on-surface/12 disabled:text-on-surface/38",
  ghost: "text-primary disabled:text-on-surface/38",
  danger: `bg-error text-on-error hover:shadow-elevation-1 ${FILLED_DISABLED}`,
};

// O botao do M3 tem 40px; aqui o medio fica com 44px, o alvo de toque minimo
// do app no celular (UX-12).
const SIZES: Record<Size, string> = {
  sm: "min-h-9 px-4 text-sm gap-2",
  md: "min-h-11 px-6 text-sm gap-2",
  lg: "min-h-13 px-6 text-base gap-2",
};

const BASE =
  "state-layer inline-flex items-center justify-center rounded-full font-medium tracking-[0.1px] transition-shadow duration-150 ease-standard disabled:pointer-events-none select-none";

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
  id,
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article" | "li";
  /** Ancora para atalhos dentro da pagina. */
  id?: string;
}) {
  return (
    <Tag
      id={id}
      // Cartao do M3 (medium, 12px): recipiente tonal com contorno, sem sombra.
      className={`rounded-card border border-border bg-surface ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-title-medium">{children}</h2>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Campos                                                                      */
/* -------------------------------------------------------------------------- */

// Campo "outlined" do M3: canto de 4px, contorno em `outline` e, no foco,
// 2px no primario (borda mais um traco interno, sem mudar o tamanho).
const FIELD_BASE =
  "w-full rounded-xs border border-outline bg-transparent px-4 text-base tracking-[0.5px] text-on-surface placeholder:text-on-surface-variant transition-[border-color,box-shadow] duration-150 hover:border-on-surface focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--md-sys-color-primary)] focus:outline-none disabled:opacity-38";

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
        className={`${FIELD_BASE} min-h-14 ${error ? "border-error hover:border-error focus:border-error focus:shadow-[inset_0_0_0_1px_var(--md-sys-color-error)]" : ""} ${className}`}
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
      <select id={inputId} className={`${FIELD_BASE} min-h-14 ${className}`} {...props}>
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
    tone === "danger"
      ? "bg-error-container text-on-error-container"
      : "bg-positive-soft text-positive";
  return (
    <p role="alert" className={`rounded-xl px-4 py-3 text-sm ${styles}`}>
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
 * Ate tres opcoes formam o "segmented button" do M3: uma pilula so, com
 * divisores, e a escolhida em secondary-container. Com mais opcoes elas viram
 * chips, que quebram linha quando nao cabem (reflow em 320px, A11Y-17).
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
  const joined = options.length <= 3;

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
        className={
          joined
            ? "flex min-h-10 overflow-hidden rounded-full border border-outline"
            : "flex flex-wrap gap-2"
        }
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
              className={`state-layer flex min-h-10 items-center justify-center gap-2 text-sm font-medium tracking-[0.1px] transition-colors ${
                joined
                  ? // O contorno de foco fica por dentro: a pilula corta o que sai dela.
                    `min-w-0 flex-1 border-l border-outline px-3 text-center first:border-l-0 focus-visible:-outline-offset-3 ${
                      active
                        ? "bg-secondary-container text-on-secondary-container"
                        : "text-on-surface"
                    }`
                  : `flex-auto whitespace-nowrap rounded-lg border px-4 ${
                      active
                        ? "border-transparent bg-secondary-container text-on-secondary-container"
                        : "border-outline-variant text-on-surface-variant"
                    }`
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
  const filled = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span className="tabular text-sm font-medium text-primary" aria-hidden="true">
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
        className="m3-slider"
        style={{ "--v": `${Math.min(100, Math.max(0, filled))}%` } as CSSProperties}
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
      <h3 className="mt-4 text-title-large">{title}</h3>
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
        // Scrim do M3: 32%, sem desfoque.
        className="absolute inset-0 bg-scrim/32 animate-fade"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // No celular e a "bottom sheet" do M3 (surface-container-low, canto de
        // 28px em cima, alca); em tela larga, o "dialog" (surface-container-high).
        className="animate-rise relative focus:outline-none flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface-container-low text-on-surface shadow-float sm:max-w-lg sm:rounded-3xl sm:bg-surface-container-high"
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-3 h-1 w-8 shrink-0 rounded-full bg-on-surface-variant/40 sm:hidden"
        />
        <header className="flex items-center justify-between gap-3 px-6 pb-2 pt-3 sm:pt-5">
          <h2 id={titleId} className="text-title-large">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            // 44px de alvo de toque (UX-12); o icone continua do mesmo tamanho.
            className="state-layer -mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-full text-on-surface-variant"
          >
            <CloseIcon className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer ? (
          <footer className="pb-safe border-t border-outline-variant px-6 py-4">{footer}</footer>
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

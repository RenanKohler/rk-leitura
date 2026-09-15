import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold tracking-widest text-accent">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Pagina nao encontrada</h1>
      <p className="max-w-sm text-muted">O endereco acessado nao existe ou foi removido.</p>
      <Link
        href="/dashboard"
        className="mt-2 inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-medium text-accent-ink"
      >
        Voltar ao inicio
      </Link>
    </main>
  );
}

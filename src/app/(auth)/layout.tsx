import type { ReactNode } from "react";
import { LogoMark } from "@/components/icons";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh flex flex-col px-5 pt-safe">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <header className="mb-8 flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-12 text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Leitura</h1>
            <p className="mt-1 text-sm text-muted">Leia mais rapido, sem perder o fio.</p>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

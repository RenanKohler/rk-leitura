"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers";
import { Alert, Button, Field } from "@/components/ui";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await login(email, password);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // Volta para onde o middleware interrompeu, se houver. A barra dupla e
    // recusada junto: "//outro-site" comeca com "/" e ainda assim sai daqui.
    const next = searchParams.get("next");
    const safe = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    router.replace(safe);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error ? <Alert>{error}</Alert> : null}

        <Field
          label="E-mail"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          placeholder="voce@exemplo.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Sua senha"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <Button type="submit" size="lg" full loading={loading}>
          {loading ? "Entrando" : "Entrar"}
        </Button>
      </form>

      {process.env.NEXT_PUBLIC_DEMO_HINT === "true" ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-center text-sm text-muted">
          Conta de demonstracao: <strong>leitor@exemplo.com</strong> / <strong>demo1234</strong>
        </p>
      ) : null}

      <p className="text-center text-sm text-muted">
        Ainda nao tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-accent">
          Criar conta
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams exige Suspense para nao forcar a pagina inteira a ser dinamica.
  return (
    <Suspense fallback={<div className="h-64" />}>
      <LoginForm />
    </Suspense>
  );
}

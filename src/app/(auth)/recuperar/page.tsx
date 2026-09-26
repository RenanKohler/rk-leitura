"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers";
import { Alert, Button, Field } from "@/components/ui";
import { apiSend } from "@/lib/client";

/**
 * Redefinir a senha com um codigo de recuperacao (US-96).
 *
 * Os codigos sao gerados em Ajustes, com a conta aberta. Sem eles nao ha
 * como recuperar: a recuperacao por e-mail (US-05) ainda depende de um
 * provedor.
 */
export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const router = useRouter();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { user } = await apiSend<{ user: { id: string; email: string; name: string } }>(
        "/api/auth/recuperar",
        "POST",
        { email, code, newPassword: password }
      );
      setUser(user);
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui redefinir a senha.");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-muted">
          Use um dos codigos de recuperacao que voce gerou em Ajustes. Cada codigo vale uma vez.
        </p>
        {error ? <Alert>{error}</Alert> : null}

        <Field
          label="E-mail"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Field
          label="Codigo de recuperacao"
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          placeholder="XXXXX-XXXXX"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
        <Field
          label="Senha nova"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="Ao menos 8 caracteres. Os outros aparelhos saem da conta."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <Button type="submit" size="lg" full loading={loading}>
          Redefinir senha
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent">
          Voltar ao login
        </Link>
      </p>
    </div>
  );
}

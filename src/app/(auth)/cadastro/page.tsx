"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers";
import { Alert, Button, Field } from "@/components/ui";

const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const router = useRouter();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setError("");
    setLoading(true);

    const result = await register(name, email, password);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error ? <Alert>{error}</Alert> : null}

        <Field
          label="Nome"
          name="name"
          autoComplete="name"
          placeholder="Como quer ser chamado"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />

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
          autoComplete="new-password"
          placeholder={`Ao menos ${MIN_PASSWORD_LENGTH} caracteres`}
          hint="Use algo que so voce saiba."
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <Button type="submit" size="lg" full loading={loading}>
          {loading ? "Criando conta" : "Criar conta"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        Ja tem conta?{" "}
        <Link href="/login" className="font-medium text-accent">
          Entrar
        </Link>
      </p>
    </div>
  );
}

/**
 * Leitura centralizada das variaveis de ambiente.
 *
 * As funcoes sao preguicosas de proposito: o `next build` importa os modulos de
 * rota para coletar metadados, e falhar ali obrigaria a ter banco e segredo
 * disponiveis na maquina de build. A validacao acontece no primeiro uso real.
 */

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Variavel de ambiente ${name} nao definida. ${hint}`);
  }
  return value;
}

export function databaseUrl(): string {
  return required(
    "DATABASE_URL",
    "Copie .env.example para .env.local e preencha a connection string do Postgres."
  );
}

export function jwtSecret(): Uint8Array {
  const secret = required(
    "JWT_SECRET",
    "Gere uma chave com `npm run secret` e adicione ao .env.local (e as variaveis do deploy)."
  );

  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET precisa ter no minimo 32 caracteres. Gere uma nova com `npm run secret`."
    );
  }

  return new TextEncoder().encode(secret);
}

export const isProduction = () => process.env.NODE_ENV === "production";

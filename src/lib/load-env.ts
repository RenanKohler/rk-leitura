/**
 * Carrega .env.local e depois .env para scripts fora do Next (drizzle-kit,
 * migrate, seed). O Next ja faz isso sozinho em dev/build; scripts avulsos nao.
 * dotenv nao sobrescreve o que ja existe, entao .env.local tem precedencia.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });


import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local" });
config();

const prismaCliDatabaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (process.env.VERCEL && !process.env.DIRECT_URL) {
  throw new Error(
    "DIRECT_URL is required on Vercel for Prisma migrations. Use the non-pooled Neon connection URL.",
  );
}

const baseConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
} as const;

// Only override the datasource when a URL is actually available. Declaring it
// unconditionally makes every Prisma command fail on a fresh checkout, including
// `prisma generate`, which needs no database at all. Without a URL we fall back to
// the schema's own `env("DATABASE_URL")`.
export default prismaCliDatabaseUrl
  ? defineConfig({
      ...baseConfig,
      engine: "classic",
      datasource: {
        // Avoid running migrations through pooled URLs; advisory locks require a direct connection.
        url: prismaCliDatabaseUrl,
      },
    })
  : defineConfig(baseConfig);

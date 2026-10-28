import { DataSource, DataSourceOptions } from "typeorm";
import {
  DB_CONNECT_TIMEOUT_MS,
  DB_STATEMENT_TIMEOUT_MS,
  sslOption,
} from "../config/runtime.config";
import { entities } from "./entities";
import { HardenForTheFuture1761700000000 } from "./migrations/1761700000000-HardenForTheFuture";
import { InitializeSchema1761600000000 } from "./migrations/1761600000000-InitializeSchema";
import { logEvent } from "../common/observability/observability";

const MIGRATION_LOCK = 8614301;

export function dataSourceOptions(): DataSourceOptions {
  return {
    type: "postgres",
    url:
      process.env.DATABASE_URL ??
      "postgresql://scheduler:scheduler@localhost:5432/scheduler",
    entities,
    migrations: [
      InitializeSchema1761600000000,
      HardenForTheFuture1761700000000,
    ],
    migrationsRun: false,
    synchronize: false,
    ssl: sslOption(),
    extra: {
      max: 10,
      connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
      statement_timeout: DB_STATEMENT_TIMEOUT_MS,
      query_timeout: DB_STATEMENT_TIMEOUT_MS,
      application_name: "scheduler",
    },
  };
}

/** Serialize migration runners so two replicas cannot apply the same migration. */
export async function runMigrationsOnce(db: DataSource): Promise<string[]> {
  await db.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
  try {
    const applied = await db.runMigrations();
    const names = applied.map((migration) => migration.name ?? "unknown");
    logEvent("info", "migrations_finished", { applied: names });
    return names;
  } finally {
    await db.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
  }
}

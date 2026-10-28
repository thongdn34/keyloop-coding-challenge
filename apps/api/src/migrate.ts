import "reflect-metadata";
import { DataSource } from "typeorm";
import { validateRuntimeConfig } from "./config/runtime.config";
import { dataSourceOptions, runMigrationsOnce } from "./database/data-source";
import { seed } from "./seed/seed";

async function main() {
  validateRuntimeConfig();
  const db = new DataSource(dataSourceOptions());
  await db.initialize();
  try {
    await runMigrationsOnce(db);
    await seed(db, {
      catalog: process.env.SEED === "true",
      users: process.env.SEED === "true" || process.env.DEMO_AUTH === "true",
    });
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

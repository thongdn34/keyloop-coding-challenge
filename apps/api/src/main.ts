import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";
import { AppModule } from "./app.module";
import { validateRuntimeConfig } from "./config/runtime.config";
import { runMigrationsOnce } from "./database/data-source";
import { LoggingFilter } from "./common/observability/observability";
import { seed } from "./seed/seed";

async function main() {
  validateRuntimeConfig();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalFilters(new LoggingFilter());
  const db = app.get(DataSource);
  if (process.env.RUN_MIGRATIONS !== "false") {
    await runMigrationsOnce(db);
  }
  await seed(db, {
    catalog: process.env.SEED === "true",
    users: process.env.SEED === "true" || process.env.DEMO_AUTH === "true",
  });
  await app.listen(Number(process.env.PORT) || 3000, "0.0.0.0");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

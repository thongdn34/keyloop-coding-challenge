import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { TypeOrmModule } from "@nestjs/typeorm";
import { join } from "path";
import { entities } from "./entities";
import { InitializeSchema1761600000000 } from "./migrations/1761600000000-InitializeSchema";
import { MetricsService, ObservabilityMiddleware } from "./observability";
import { SchedulerController } from "./scheduler.controller";
import { SchedulerService } from "./scheduler.service";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      url:
        process.env.DATABASE_URL ??
        "postgresql://scheduler:scheduler@localhost:5432/scheduler",
      entities,
      migrations: [InitializeSchema1761600000000],
      migrationsRun: true,
      synchronize: false,
      ssl:
        process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "public"),
      exclude: ["/api*"],
    }),
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService, MetricsService, ObservabilityMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ObservabilityMiddleware).forRoutes(SchedulerController);
  }
}

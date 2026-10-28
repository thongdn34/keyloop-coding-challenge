import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { TypeOrmModule } from "@nestjs/typeorm";
import { join } from "path";
import { AuthController } from "./auth/auth.controller";
import { AuthModule } from "./auth/auth.module";
import { ObservabilityMiddleware } from "./common/observability/observability";
import { ObservabilityModule } from "./common/observability/observability.module";
import { dataSourceOptions } from "./database/data-source";
import { HealthController } from "./health/health.controller";
import { HealthModule } from "./health/health.module";
import { SchedulerController } from "./scheduler/scheduler.controller";
import { SchedulerModule } from "./scheduler/scheduler.module";

@Module({
  imports: [
    TypeOrmModule.forRoot(dataSourceOptions()),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "public"),
      exclude: ["/api*"],
    }),
    ObservabilityModule,
    AuthModule,
    HealthModule,
    SchedulerModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ObservabilityMiddleware)
      .forRoutes(HealthController, AuthController, SchedulerController);
  }
}

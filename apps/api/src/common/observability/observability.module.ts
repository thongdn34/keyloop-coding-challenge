import { Global, Module } from "@nestjs/common";
import { MetricsService, ObservabilityMiddleware } from "./observability";

@Global()
@Module({
  providers: [MetricsService, ObservabilityMiddleware],
  exports: [MetricsService, ObservabilityMiddleware],
})
export class ObservabilityModule {}

import {
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  MetricsService,
  metricsAuthorized,
} from "../common/observability/observability";
import { runtimeIdentity } from "../config/runtime.config";

@Controller("api")
export class HealthController {
  constructor(
    private readonly db: DataSource,
    private readonly metrics: MetricsService,
  ) {}

  @Get("live")
  live() {
    return { status: "ok", ...runtimeIdentity() };
  }

  @Get("health")
  async health() {
    try {
      await this.db.query("SELECT 1");
      return { status: "ok", database: "ok", ...runtimeIdentity() };
    } catch {
      throw new ServiceUnavailableException("Database is unavailable");
    }
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metricsReport(@Headers("authorization") authorization?: string): string {
    if (!metricsAuthorized(authorization)) {
      if (process.env.NODE_ENV === "production" && !process.env.METRICS_TOKEN) {
        throw new NotFoundException();
      }
      throw new UnauthorizedException("Metrics credentials were not accepted");
    }
    return this.metrics.render();
  }
}

import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";

type Metric = {
  count: number;
  errors: number;
  durationSeconds: number;
  buckets: number[];
};

const durationBuckets = [0.1, 0.3, 0.5, 1, 2.5];
const safeRequestId = /^[A-Za-z0-9._-]{1,128}$/;
const traceParent = /^00-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;

function metricLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

@Injectable()
export class MetricsService {
  private readonly http = new Map<string, Metric>();

  record(
    method: string,
    route: string,
    status: number,
    durationMilliseconds: number,
  ): void {
    const key = JSON.stringify([method, route, status]);
    const metric = this.http.get(key) ?? {
      count: 0,
      errors: 0,
      durationSeconds: 0,
      buckets: durationBuckets.map(() => 0),
    };

    const durationSeconds = durationMilliseconds / 1_000;
    metric.count += 1;
    metric.errors += status >= 500 ? 1 : 0;
    metric.durationSeconds += durationSeconds;
    durationBuckets.forEach((bucket, index) => {
      if (durationSeconds <= bucket) {
        metric.buckets[index] += 1;
      }
    });
    this.http.set(key, metric);
  }

  render(): string {
    const lines = [
      "# HELP scheduler_http_requests_total HTTP responses.",
      "# TYPE scheduler_http_requests_total counter",
      "# HELP scheduler_http_errors_total HTTP 5xx responses.",
      "# TYPE scheduler_http_errors_total counter",
      "# HELP scheduler_http_request_duration_seconds Request duration.",
      "# TYPE scheduler_http_request_duration_seconds histogram",
    ];

    for (const [key, metric] of this.http) {
      const [method, route, status] = JSON.parse(key) as [
        string,
        string,
        number,
      ];
      const labels = `method="${metricLabel(method)}",route="${metricLabel(route)}",status="${status}"`;

      lines.push(
        `scheduler_http_requests_total{${labels}} ${metric.count}`,
        `scheduler_http_errors_total{${labels}} ${metric.errors}`,
        ...durationBuckets.map(
          (bucket, index) =>
            `scheduler_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${metric.buckets[index]}`,
        ),
        `scheduler_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`,
        `scheduler_http_request_duration_seconds_count{${labels}} ${metric.count}`,
        `scheduler_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds}`,
      );
    }

    return `${lines.join("\n")}\n`;
  }
}

@Injectable()
export class ObservabilityMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const receivedRequestId = request.header("x-correlation-id");
    const requestId =
      receivedRequestId && safeRequestId.test(receivedRequestId)
        ? receivedRequestId
        : randomUUID();
    const receivedTraceParent = request.header("traceparent");
    const traceMatch = receivedTraceParent?.match(traceParent);
    const validTrace =
      traceMatch && !/^0+$/.test(traceMatch[1]) && !/^0+$/.test(traceMatch[2]);
    const traceId = validTrace
      ? traceMatch[1].toLowerCase()
      : randomBytes(16).toString("hex");
    const traceFlags = validTrace ? traceMatch[3].toLowerCase() : "01";
    const spanId = randomBytes(8).toString("hex");
    const startedAt = process.hrtime.bigint();

    response.setHeader("x-correlation-id", requestId);
    response.setHeader("traceparent", `00-${traceId}-${spanId}-${traceFlags}`);

    response.on("finish", () => {
      const durationMilliseconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const route = request.originalUrl
        .split("?")[0]
        .replace(/\/\d+(?=\/|$)/g, "/:id");

      this.metrics.record(
        request.method,
        route,
        response.statusCode,
        durationMilliseconds,
      );
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: response.statusCode >= 500 ? "error" : "info",
          event: "http_request",
          requestId,
          traceId,
          spanId,
          method: request.method,
          route,
          status: response.statusCode,
          durationMs: Number(durationMilliseconds.toFixed(2)),
        }),
      );
    });

    next();
  }
}

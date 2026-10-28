import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestMiddleware,
} from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { runtimeIdentity } from "../../config/runtime.config";

type Metric = {
  count: number;
  errors: number;
  durationSeconds: number;
  buckets: number[];
};

type RequestContext = {
  requestId: string;
  traceId: string;
  spanId: string;
};

const durationBuckets = [0.1, 0.3, 0.5, 1, 2.5];
const lockBuckets = [0.01, 0.05, 0.1, 0.3, 0.5, 1];
const safeRequestId = /^[A-Za-z0-9._-]{1,128}$/;
const traceParent = /^00-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;
const bookingResults = ["confirmed", "conflict", "replay"] as const;
type BookingResult = (typeof bookingResults)[number];

export const requestContext = new AsyncLocalStorage<RequestContext>();

function metricLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const context = requestContext.getStore();
  const identity = runtimeIdentity();
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: identity.service,
      environment: process.env.NODE_ENV ?? "development",
      version: identity.version,
      commit: identity.commit,
      requestId: context?.requestId,
      traceId: context?.traceId,
      spanId: context?.spanId,
      event,
      ...fields,
    }),
  );
}

function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

export function exportSpan(span: {
  name: string;
  spanId: string;
  parentSpanId?: string;
  traceId?: string;
  status: string;
  startUnixNano: bigint;
  durationMs: number;
}): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const traceId = span.traceId;
  if (!endpoint || !traceId) return;
  const endUnixNano =
    span.startUnixNano + BigInt(Math.round(span.durationMs * 1_000_000));
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: runtimeIdentity().service },
            },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: hexToBase64(traceId),
                spanId: hexToBase64(span.spanId),
                parentSpanId: span.parentSpanId
                  ? hexToBase64(span.parentSpanId)
                  : undefined,
                name: span.name,
                startTimeUnixNano: span.startUnixNano.toString(),
                endTimeUnixNano: endUnixNano.toString(),
                attributes: [
                  {
                    key: "otel.status_code",
                    value: { stringValue: span.status },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  void fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1_000),
  }).catch(() => {
    logEvent("warn", "trace_export_failed", { spanName: span.name });
  });
}

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = requestContext.getStore();
  const spanId = randomBytes(8).toString("hex");
  const started = process.hrtime.bigint();
  const startUnixNano = BigInt(Date.now()) * 1_000_000n;
  try {
    const value = await fn();
    finish("ok");
    return value;
  } catch (error) {
    finish("error");
    throw error;
  }

  function finish(status: string) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    logEvent(status === "error" ? "error" : "info", "span", {
      spanName: name,
      spanId,
      parentSpanId: parent?.spanId,
      status,
      durationMs: Number(durationMs.toFixed(2)),
    });
    exportSpan({
      name,
      spanId,
      parentSpanId: parent?.spanId,
      traceId: parent?.traceId,
      status,
      startUnixNano,
      durationMs,
    });
  }
}

@Injectable()
export class MetricsService {
  private readonly http = new Map<string, Metric>();
  private readonly bookings = new Map<BookingResult, number>();
  private readonly lockWaits = lockBuckets.map(() => 0);
  private lockWaitCount = 0;
  private lockWaitSum = 0;

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
      if (durationSeconds <= bucket) metric.buckets[index] += 1;
    });
    this.http.set(key, metric);
  }

  recordBooking(result: BookingResult): void {
    this.bookings.set(result, (this.bookings.get(result) ?? 0) + 1);
  }

  recordLockWait(seconds: number): void {
    this.lockWaitCount += 1;
    this.lockWaitSum += seconds;
    lockBuckets.forEach((bucket, index) => {
      if (seconds <= bucket) this.lockWaits[index] += 1;
    });
  }

  render(): string {
    const identity = runtimeIdentity();
    const lines = [
      "# HELP scheduler_http_requests_total HTTP responses.",
      "# TYPE scheduler_http_requests_total counter",
      "# HELP scheduler_http_errors_total HTTP 5xx responses.",
      "# TYPE scheduler_http_errors_total counter",
      "# HELP scheduler_http_request_duration_seconds Request duration.",
      "# TYPE scheduler_http_request_duration_seconds histogram",
      "# HELP scheduler_bookings_total Booking outcomes. Process-local until scraped.",
      "# TYPE scheduler_bookings_total counter",
      "# HELP scheduler_lock_wait_seconds Advisory lock wait.",
      "# TYPE scheduler_lock_wait_seconds histogram",
      `scheduler_build_info{version="${metricLabel(identity.version)}",commit="${metricLabel(identity.commit)}"} 1`,
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

    for (const result of bookingResults) {
      lines.push(
        `scheduler_bookings_total{result="${result}"} ${this.bookings.get(result) ?? 0}`,
      );
    }
    lines.push(
      ...lockBuckets.map(
        (bucket, index) =>
          `scheduler_lock_wait_seconds_bucket{le="${bucket}"} ${this.lockWaits[index]}`,
      ),
      `scheduler_lock_wait_seconds_bucket{le="+Inf"} ${this.lockWaitCount}`,
      `scheduler_lock_wait_seconds_count ${this.lockWaitCount}`,
      `scheduler_lock_wait_seconds_sum ${this.lockWaitSum}`,
    );
    return `${lines.join("\n")}\n`;
  }
}

export function metricsAuthorized(authorization?: string): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  const presented = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const actual = createHash("sha256").update(presented).digest();
  const expected = createHash("sha256").update(token).digest();
  return timingSafeEqual(actual, expected);
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

    const finish = (event: "http_request" | "request_aborted") => {
      const durationMilliseconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const route = request.originalUrl
        .split("?")[0]
        .replace(/\/\d+(?=\/|$)/g, "/:id");
      if (event === "http_request") {
        this.metrics.record(
          request.method,
          route,
          response.statusCode,
          durationMilliseconds,
        );
      }
      logEvent(response.statusCode >= 500 ? "error" : "info", event, {
        method: request.method,
        route,
        status: response.statusCode,
        durationMs: Number(durationMilliseconds.toFixed(2)),
      });
    };

    response.on("finish", () => finish("http_request"));
    response.on("close", () => {
      if (!response.writableEnded) finish("request_aborted");
    });

    requestContext.run({ requestId, traceId, spanId }, () => next());
  }
}

@Catch()
export class LoggingFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    logEvent(status >= 500 ? "error" : "info", "request_failed", {
      error: exception instanceof Error ? exception.name : "Error",
      status,
    });
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === "string"
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }
    response.status(500).json({
      statusCode: 500,
      message: "Internal server error",
    });
  }
}

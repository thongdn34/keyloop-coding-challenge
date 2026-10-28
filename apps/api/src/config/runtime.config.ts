const DEMO_SECRET = "demo-only-scheduler-auth-secret-change-me";

export const DB_STATEMENT_TIMEOUT_MS = 8_000;
export const DB_CONNECT_TIMEOUT_MS = 5_000;
export const CLIENT_REQUEST_TIMEOUT_MS = 10_000;

export function runtimeIdentity() {
  return {
    service: "scheduler",
    version: process.env.SERVICE_VERSION || "1.0.0",
    commit:
      process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "unknown",
  };
}

export function authSecret(): string {
  const configured = process.env.AUTH_SECRET;
  if (configured) {
    if (configured.length < 32) {
      throw new Error("AUTH_SECRET must be at least 32 characters");
    }
    return configured;
  }
  if (process.env.DEMO_AUTH === "false") {
    throw new Error("AUTH_SECRET is required when DEMO_AUTH=false");
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "demo_auth_secret",
        message:
          "Using the built-in demo signing secret. Set AUTH_SECRET before storing real customer data.",
      }),
    );
  }
  return DEMO_SECRET;
}

export function validateRuntimeConfig(): void {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }
  authSecret();
  if (
    process.env.DB_SSL === "true" &&
    process.env.DB_SSL_REJECT_UNAUTHORIZED === "false"
  ) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "insecure_database_tls",
        message:
          "DB_SSL_REJECT_UNAUTHORIZED=false disables PostgreSQL certificate verification",
      }),
    );
  }
}

export function sslOption():
  | false
  | { rejectUnauthorized: boolean; ca?: string } {
  if (process.env.DB_SSL !== "true") return false;
  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    ca: process.env.DB_CA_CERT,
  };
}

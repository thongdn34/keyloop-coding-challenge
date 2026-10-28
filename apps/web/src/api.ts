import type { Session } from "../../../contracts/types.ts";
import { REQUEST_TIMEOUT_MS } from "./time.ts";

const storageKey = "scheduler.session";

export class SessionExpired extends Error {
  constructor() {
    super("Sign in required");
    this.name = "SessionExpired";
  }
}

function storage(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function readSession(): Session | null {
  const raw = storage()?.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session | null) {
  const store = storage();
  if (!session) store?.removeItem(storageKey);
  else store?.setItem(storageKey, JSON.stringify(session));
}

function hex(bytes: Uint8Array) {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function newTraceparent() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `00-${hex(bytes.slice(0, 16))}-${hex(bytes.slice(16))}-01`;
}

export function describeCall(
  path: string,
  options?: {
    body?: unknown;
    idempotencyKey?: string;
    token?: string | null;
    correlationId?: string;
    traceparent?: string;
  },
) {
  const headers: Record<string, string> = {
    "x-correlation-id": options?.correlationId ?? crypto.randomUUID(),
    traceparent: options?.traceparent ?? newTraceparent(),
  };
  if (options?.token) headers.authorization = `Bearer ${options.token}`;
  if (options?.body !== undefined) headers["content-type"] = "application/json";
  if (options?.idempotencyKey)
    headers["idempotency-key"] = options.idempotencyKey;
  return {
    url: `/api/${path}`,
    method: options?.body !== undefined ? "POST" : "GET",
    headers,
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  };
}

export async function request<T>(
  path: string,
  options?: { body?: unknown; idempotencyKey?: string },
): Promise<T> {
  const call = describeCall(path, {
    ...options,
    token: readSession()?.token,
  });
  let response: Response;
  try {
    response = await fetch(call.url, {
      method: call.method,
      headers: call.headers,
      body: call.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error("The request timed out. Try again.");
    }
    throw error;
  }
  if (response.status === 401 && !path.startsWith("session")) {
    setSession(null);
    throw new SessionExpired();
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
    };
    const message = Array.isArray(payload.message)
      ? payload.message.join(", ")
      : payload.message || "Request failed";
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function signIn(username: string, password: string) {
  const session = await request<Session>("session", {
    body: { username, password },
  });
  setSession(session);
  return session;
}

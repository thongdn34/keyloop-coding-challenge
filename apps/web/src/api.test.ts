import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeCall } from "./api.ts";

describe("API client", () => {
  it("sends a bearer token, correlation id, and idempotency key", () => {
    const call = describeCall("appointments", {
      body: { dealershipId: 1 },
      token: "signed-token",
      idempotencyKey: "retry-key-1",
      correlationId: "corr-1",
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    });
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, "Bearer signed-token");
    assert.equal(call.headers["idempotency-key"], "retry-key-1");
    assert.equal(call.headers["x-correlation-id"], "corr-1");
    assert.equal(call.body, JSON.stringify({ dealershipId: 1 }));
  });

  it("leaves catalog reads unauthenticated until a session exists", () => {
    const call = describeCall("catalog");
    assert.equal(call.method, "GET");
    assert.equal(call.headers.authorization, undefined);
    assert.match(call.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

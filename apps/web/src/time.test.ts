import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDuration, timeIssue, withOffset } from "./time.ts";

describe("local offset conversion", () => {
  it("keeps the local clock time and adds a numeric offset", () => {
    const value = withOffset("2099-11-01T17:00");
    assert.match(value, /^2099-11-01T17:00:00[+-]\d{2}:\d{2}$/);
    assert.equal(
      new Date(value).toISOString(),
      new Date("2099-11-01T17:00").toISOString(),
    );
  });

  it("formats durations in hours and minutes", () => {
    assert.equal(formatDuration(90), "1 hr 30 min");
    assert.equal(formatDuration(60), "1 hour");
  });

  it("rejects a past appointment time", () => {
    assert.equal(timeIssue("2000-01-01T00:00"), "Choose a time in the future.");
  });
});

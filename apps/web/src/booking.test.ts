import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openCount, sortSchedule, visitState } from "./booking.ts";

const now = Date.parse("2026-11-01T12:00:00Z");

describe("workshop diary ordering", () => {
  it("places open visits ahead of completed ones", () => {
    const items = sortSchedule(
      [
        {
          id: 1,
          startAt: "2026-11-01T08:00:00Z",
          endAt: "2026-11-01T09:00:00Z",
        },
        {
          id: 2,
          startAt: "2026-11-01T13:00:00Z",
          endAt: "2026-11-01T14:00:00Z",
        },
      ],
      now,
    );
    assert.deepEqual(
      items.map((item) => item.id),
      [2, 1],
    );
    assert.equal(openCount(items, now), 1);
    assert.equal(visitState(items[0], now), "Upcoming");
    assert.equal(visitState(items[1], now), "Completed");
  });
});

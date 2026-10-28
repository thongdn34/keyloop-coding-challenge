import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { openApiDocument } from "./openapi";

describe("API contract", () => {
  it("matches the published OpenAPI document", () => {
    const published = JSON.parse(
      readFileSync(
        join(__dirname, "../../../../contracts/openapi.json"),
        "utf8",
      ),
    );
    expect(published).toEqual(openApiDocument);
  });
});

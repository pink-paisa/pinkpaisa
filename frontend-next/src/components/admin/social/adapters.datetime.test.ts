import { describe, expect, it } from "vitest";
import { fromDateTimeLocal, toDateTimeLocal } from "./adapters";

describe("Asia/Kolkata datetime-local conversion", () => {
  it("formats an absolute timestamp as India time instead of browser-local time", () => {
    expect(toDateTimeLocal("2026-09-01T12:30:00.000Z")).toBe("2026-09-01T18:00");
  });

  it("parses a datetime-local value as India time and preserves absolute timestamps", () => {
    expect(fromDateTimeLocal("2026-09-01T18:00")).toBe("2026-09-01T12:30:00.000Z");
    expect(fromDateTimeLocal("2026-09-01T12:30:00.000Z")).toBe("2026-09-01T12:30:00.000Z");
    expect(toDateTimeLocal("2026-09-01T18:00")).toBe("2026-09-01T18:00");
  });

  it("rejects impossible local calendar values", () => {
    expect(fromDateTimeLocal("2026-02-30T18:00")).toBe("");
  });
});

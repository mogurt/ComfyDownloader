import { describe, expect, it } from "vitest";
import { formatEta, formatSize, formatTransferred, parseTimestamp } from "./download-format";

describe("parseTimestamp", () => {
  it("treats SQLite CURRENT_TIMESTAMP values as UTC", () => {
    expect(parseTimestamp("2026-09-28 10:04:57").toISOString()).toBe("2026-09-28T10:04:57.000Z");
  });

  it("leaves ISO timestamps with a zone untouched", () => {
    expect(parseTimestamp("2026-09-28T10:04:57.000Z").toISOString()).toBe("2026-09-28T10:04:57.000Z");
    expect(parseTimestamp("2026-09-28T18:04:57+08:00").toISOString()).toBe("2026-09-28T10:04:57.000Z");
  });
});

describe("formatting", () => {
  it("formats sizes and unknown values", () => {
    expect(formatSize(0)).toBe("-");
    expect(formatSize(520212)).toBe("508 KB");
    expect(formatSize(334643276)).toBe("319.1 MB");
  });

  it("shows '-' for an unknown ETA instead of 0s", () => {
    expect(formatEta(null)).toBe("-");
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatEta(59)).toBe("59s");
    expect(formatEta(348)).toBe("5m 48s");
  });

  it("formats transferred bytes with and without a total", () => {
    expect(formatTransferred(0, 0)).toBe("-");
    expect(formatTransferred(49070080, 334643276)).toBe("46.8 MB / 319.1 MB");
    expect(formatTransferred(1024 * 1024, null)).toBe("1.0 MB");
  });
});

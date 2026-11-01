import { describe, expect, it } from "vitest";
import { ago } from "./SyncLine";

describe("ago", () => {
  const now = Date.parse("2026-10-30T20:00:00Z");
  it("describes how long ago the last sync was", () => {
    expect(ago(now - 20_000, now)).toBe("just now");
    expect(ago(now - 3 * 60_000, now)).toBe("3 min ago");
    expect(ago(now - 2 * 3600_000, now)).toBe("2 h ago");
    expect(ago(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });
});

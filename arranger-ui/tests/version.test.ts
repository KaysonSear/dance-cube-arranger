import { describe, expect, it } from "vitest";

import { APP_VERSION, compareVersions } from "../src/lib/version";

describe("version and update utilities", () => {
  it("defines APP_VERSION as 260915", () => {
    expect(APP_VERSION).toBe("260915");
  });

  it("correctly compares numeric date-based versions", () => {
    expect(compareVersions("260915", "260920")).toBeGreaterThan(0);
    expect(compareVersions("260920", "260915")).toBeLessThan(0);
    expect(compareVersions("260915", "260915")).toBe(0);
  });

  it("handles 'v' prefixes gracefully", () => {
    expect(compareVersions("v260915", "v260920")).toBeGreaterThan(0);
    expect(compareVersions("260915", "v260920")).toBeGreaterThan(0);
    expect(compareVersions("v260920", "260915")).toBeLessThan(0);
    expect(compareVersions("v260915", "260915")).toBe(0);
  });

  it("compares semantic versions if used in future", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.1.9")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

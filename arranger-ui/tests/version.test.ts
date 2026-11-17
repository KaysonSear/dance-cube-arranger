import { describe, expect, it } from "vitest";

import { APP_VERSION, compareVersions } from "../src/lib/version";

describe("version and update utilities", () => {
  it("defines a valid release version", () => {
    expect(APP_VERSION).toMatch(/^\d{6}(?:\.\d+)?$/);
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

  it("orders a same-day hotfix after the base portable release", () => {
    expect(compareVersions("261115", "v261115.1")).toBeGreaterThan(0);
    expect(compareVersions("261115.1", "v261115")).toBeLessThan(0);
    expect(compareVersions("261115.1", "v261117")).toBeGreaterThan(0);
  });

  it("compares semantic versions if used in future", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.1.9")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

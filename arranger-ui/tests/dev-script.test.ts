import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

describe("development server", () => {
  it("uses the Webpack fallback instead of Turbopack", () => {
    expect(packageJson.scripts.dev.split(/\s+/)).toContain("--webpack");
  });
});

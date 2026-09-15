import { describe, expect, it } from "vitest";

import { GET } from "../src/app/api/update/check/route";
import { APP_VERSION } from "../src/lib/version";

describe("/api/update/check", () => {
  it("returns mock update info with hasUpdate=true when mockVersion is higher", async () => {
    const req = new Request("http://localhost:3000/api/update/check?mockVersion=999999");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.update.hasUpdate).toBe(true);
    expect(json.update.currentVersion).toBe(APP_VERSION);
    expect(json.update.latestVersion).toBe("999999");
  });

  it("returns mock update info with hasUpdate=false when mockVersion is same or lower", async () => {
    const req = new Request(`http://localhost:3000/api/update/check?mockVersion=${APP_VERSION}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.update.hasUpdate).toBe(false);
  });
});

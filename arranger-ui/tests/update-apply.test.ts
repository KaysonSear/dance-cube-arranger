import { describe, expect, it } from "vitest";

import { GET, POST } from "../src/app/api/update/apply/route";

describe("/api/update/apply", () => {
  it("returns initial idle status on GET", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBeDefined();
  });

  it("rejects POST with missing downloadUrl", async () => {
    const req = new Request("http://localhost:3000/api/update/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("handles mock=true update trigger", async () => {
    const req = new Request("http://localhost:3000/api/update/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mock: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.mock).toBe(true);
  });
});

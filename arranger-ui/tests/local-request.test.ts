import { describe, expect, it } from "vitest";

import { isLocalRequest, isSafeLocalHost } from "../src/lib/server/local-request";

describe("local-request security checks", () => {
  describe("isSafeLocalHost", () => {
    it("recognizes loopback and local hostnames", () => {
      expect(isSafeLocalHost("localhost")).toBe(true);
      expect(isSafeLocalHost("127.0.0.1")).toBe(true);
      expect(isSafeLocalHost("127.0.0.2")).toBe(true);
      expect(isSafeLocalHost("0.0.0.0")).toBe(true);
      expect(isSafeLocalHost("::1")).toBe(true);
      expect(isSafeLocalHost("[::1]")).toBe(true);
      expect(isSafeLocalHost("localhost:3000")).toBe(true);
      expect(isSafeLocalHost("127.0.0.1:3210")).toBe(true);
      expect(isSafeLocalHost("DESKTOP-ABC1234")).toBe(true);
      expect(isSafeLocalHost("my-computer:3210")).toBe(true);
    });

    it("recognizes IPv4-mapped IPv6 loopback addresses", () => {
      expect(isSafeLocalHost("::ffff:127.0.0.1")).toBe(true);
      expect(isSafeLocalHost("[::ffff:127.0.0.1]:3000")).toBe(true);
    });

    it("recognizes private LAN subnets", () => {
      expect(isSafeLocalHost("192.168.1.100")).toBe(true);
      expect(isSafeLocalHost("192.168.0.1:3210")).toBe(true);
      expect(isSafeLocalHost("10.0.0.5")).toBe(true);
      expect(isSafeLocalHost("172.20.0.1")).toBe(true);
    });

    it("rejects public internet hostnames and IPs", () => {
      expect(isSafeLocalHost("example.com")).toBe(false);
      expect(isSafeLocalHost("malicious-site.org")).toBe(false);
      expect(isSafeLocalHost("8.8.8.8")).toBe(false);
      expect(isSafeLocalHost("1.1.1.1:8080")).toBe(false);
      expect(isSafeLocalHost(null)).toBe(false);
      expect(isSafeLocalHost("")).toBe(false);
    });
  });

  describe("isLocalRequest", () => {
    it("permits standard localhost requests", () => {
      const req = new Request("http://localhost:3000/api/system-dialog", {
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
      });
      expect(isLocalRequest(req)).toBe(true);
    });

    it("permits 127.0.0.1 requests", () => {
      const req = new Request("http://127.0.0.1:3210/api/system-dialog", {
        headers: {
          host: "127.0.0.1:3210",
          origin: "http://127.0.0.1:3210",
        },
      });
      expect(isLocalRequest(req)).toBe(true);
    });

    it("permits IPv4-mapped IPv6 requests (dual-stack Windows/Node)", () => {
      const req = new Request("http://localhost:3210/api/system-dialog", {
        headers: {
          host: "[::ffff:127.0.0.1]:3210",
          origin: "http://localhost:3210",
        },
      });
      expect(isLocalRequest(req)).toBe(true);
    });

    it("permits same-origin browser interactions protected by Sec-Fetch-Site", () => {
      const req = new Request("http://localhost:3210/api/system-dialog", {
        headers: {
          "sec-fetch-site": "same-origin",
        },
      });
      expect(isLocalRequest(req)).toBe(true);
    });

    it("permits LAN IP access for local users", () => {
      const req = new Request("http://192.168.1.50:3210/api/system-dialog", {
        headers: {
          host: "192.168.1.50:3210",
          origin: "http://192.168.1.50:3210",
        },
      });
      expect(isLocalRequest(req)).toBe(true);
    });

    it("rejects cross-site requests originating from untrusted public web origins", () => {
      const req = new Request("http://localhost:3000/api/system-dialog", {
        headers: {
          host: "localhost:3000",
          origin: "https://attacker.evil.com",
          "sec-fetch-site": "cross-site",
        },
      });
      expect(isLocalRequest(req)).toBe(false);
    });

    it("rejects requests targeted at public internet hosts", () => {
      const req = new Request("http://8.8.8.8/api/system-dialog", {
        headers: {
          host: "8.8.8.8",
        },
      });
      expect(isLocalRequest(req)).toBe(false);
    });
  });
});

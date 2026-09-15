import { describe, expect, it } from "vitest";

function shouldAutoOpenOnStartup(storedValue: string | null): boolean {
  return storedValue !== "1";
}

function handleCheckboxToggle(checked: boolean): {
  checkboxChecked: boolean;
  savedStorageValue: string;
} {
  return {
    checkboxChecked: checked,
    savedStorageValue: checked ? "1" : "0",
  };
}

describe("Help Dialog Startup & Manual Checkbox Toggle Rules", () => {
  it("auto-opens on startup by default when unconfigured or set to 0", () => {
    expect(shouldAutoOpenOnStartup(null)).toBe(true);
    expect(shouldAutoOpenOnStartup("0")).toBe(true);
  });

  it("suppresses auto-open on startup when set to 1", () => {
    expect(shouldAutoOpenOnStartup("1")).toBe(false);
  });

  it("sets storage to 1 when user checks the box inside HelpDialog", () => {
    const res = handleCheckboxToggle(true);
    expect(res.checkboxChecked).toBe(true);
    expect(res.savedStorageValue).toBe("1");
    // Next startup will be suppressed
    expect(shouldAutoOpenOnStartup(res.savedStorageValue)).toBe(false);
  });

  it("resets storage to 0 when user unchecks the box inside HelpDialog to restore startup popup", () => {
    // User unchecks the box inside HelpDialog (置 0)
    const res = handleCheckboxToggle(false);
    expect(res.checkboxChecked).toBe(false);
    expect(res.savedStorageValue).toBe("0");
    // Next startup will auto-open again
    expect(shouldAutoOpenOnStartup(res.savedStorageValue)).toBe(true);
  });
});

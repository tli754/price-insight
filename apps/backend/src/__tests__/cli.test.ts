import { describe, it, expect } from "vitest";

import { resolveScript } from "../cli.js";

const available = ["sync-products", "load-recent-orders", "drain-dataforseo-backlog"];

describe("resolveScript()", () => {
  it("lists when no name is given", () => {
    expect(resolveScript(undefined, available)).toEqual({ action: "list" });
  });

  it("lists on --list", () => {
    expect(resolveScript("--list", available)).toEqual({ action: "list" });
  });

  it("lists on -l", () => {
    expect(resolveScript("-l", available)).toEqual({ action: "list" });
  });

  it("runs a known script", () => {
    expect(resolveScript("sync-products", available)).toEqual({ action: "run", name: "sync-products" });
  });

  it("errors on an unknown script name", () => {
    const result = resolveScript("does-not-exist", available);
    expect(result.action).toBe("error");
  });

  it("errors on path-traversal-style input", () => {
    const result = resolveScript("../../etc/passwd", available);
    expect(result.action).toBe("error");
  });

  it("errors on a partial/prefix match", () => {
    const result = resolveScript("sync", available);
    expect(result.action).toBe("error");
  });
});

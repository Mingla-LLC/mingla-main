/*
 * #2829 W9f (A18 item 1) — a publish that outlives brand-site-control's 15 s
 * wait came back as 503 SERVICE_TEMPORARILY_UNAVAILABLE although it went
 * live. The workspace must track the same operation to its result and say
 * "Still publishing…", never "That didn't go through".
 */
import { publicationReceiptLine, startTrackedPublication } from "../publicationFlow";

class CodedError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function deps(runError: unknown | null) {
  const calls: string[] = [];
  return {
    calls,
    run: async () => {
      calls.push("run");
      if (runError) throw runError;
    },
    track: async () => {
      calls.push("track");
    },
    refuse: () => {
      calls.push("refuse");
    },
  };
}

describe("#2829 W9f publish is tracked to its result", () => {
  it("a 503 timeout tracks the same operation instead of reporting failure", async () => {
    const d = deps(new CodedError("SERVICE_TEMPORARILY_UNAVAILABLE"));
    await expect(startTrackedPublication({ id: "op" }, d)).resolves.toBe("tracking");
    expect(d.calls).toEqual(["run", "track"]);
  });

  it("an uncoded failure (network) is also unknown, so it is tracked", async () => {
    const d = deps(new TypeError("Failed to fetch"));
    await expect(startTrackedPublication({ id: "op" }, d)).resolves.toBe("tracking");
    expect(d.calls).toEqual(["run", "track"]);
  });

  it("a named refusal is shown at once and nothing is tracked", async () => {
    for (const code of ["FORBIDDEN", "REVISION_CONFLICT", "VALIDATION_FAILED", "PATH_COLLISION"]) {
      const d = deps(new CodedError(code));
      await expect(startTrackedPublication({ id: "op" }, d)).resolves.toBe("refused");
      expect(d.calls).toEqual(["run", "refuse"]);
    }
  });

  it("an accepted publish is tracked", async () => {
    const d = deps(null);
    await expect(startTrackedPublication({ id: "op" }, d)).resolves.toBe("tracking");
    expect(d.calls).toEqual(["run", "track"]);
  });

  it("an ambiguous receipt reads 'Still publishing…' until the server answers", () => {
    expect(publicationReceiptLine({ status: "ambiguous" }, false)).toMatch(/^Still publishing…/);
    expect(publicationReceiptLine({ status: "executing" }, false)).toMatch(/^Still publishing…/);
    expect(publicationReceiptLine(null, false)).toMatch(/^Still publishing…/);
    expect(publicationReceiptLine({ status: "failed" }, false)).toMatch(/verified failure/);
    expect(publicationReceiptLine({ status: "ambiguous" }, true)).toMatch(/check it again/);
  });

  it("the Website route and view use the tracked flow and the receipt line", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    // #2829 W9r — the Website section's controller and Publish & history.
    const route = fs.readFileSync(path.resolve(process.cwd(), "src/components/sites/website/useWebsiteController.ts"), "utf8");
    const view = fs.readFileSync(path.resolve(process.cwd(), "src/components/sites/website/sections/PublishSection.tsx"), "utf8");
    expect(route).toContain("startTrackedPublication(operation,");
    expect(route).toContain("PUBLICATION_TRACK_WINDOW_MS");
    expect(view).toContain("publicationReceiptLine(receipt, true)");
    expect(view).not.toContain("Mingla cannot yet prove the final state");
  });
});

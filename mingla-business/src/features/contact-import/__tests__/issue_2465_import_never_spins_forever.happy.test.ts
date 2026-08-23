import fs from "node:fs";
import path from "node:path";

// #2465 — a contact import that fails to start used to spin forever.
//
// The live failure (We Go Again Exhibition, 2026-08-23): batch left at
// `previewed` with `attested_at IS NULL` and 0 of 212 rows executed, while the
// browser sat on "Importing…" indefinitely. The server was healthy — a replay
// of all three steps against production completed in under a second — so the
// defect was entirely in this component's recovery path.
//
// These assertions pin the three properties that were missing. Reverting any
// one of them fails this test.

const root = path.resolve(__dirname, "../../../../..");
const flow = fs.readFileSync(
  path.join(root, "mingla-business/src/features/contact-import/ContactImportFlow.tsx"),
  "utf8",
);

describe("#2465 the import flow always reaches a terminal state", () => {
  it("arms the status poll only after an execute attempt resolves, never off step alone", () => {
    // The old guard was `step !== "importing" || !preview || !online`, which
    // armed the poll the instant execute() set the step — firing a status
    // request that raced the execute itself (two preflights 1 ms apart in the
    // production edge logs).
    expect(flow).toContain(
      'if (step !== "importing" || !pollArmed || !preview || !online) return;',
    );
    // execute() must explicitly disarm before issuing the request.
    expect(flow).toMatch(/setStep\("importing"\);[\s\S]{0,400}?setPollArmed\(false\)/);
  });

  it("treats a batch still at `previewed` as a terminal failure, not as in-progress", () => {
    // `previewed` means the server never began the import, so waiting can
    // never change it. Both the poll and the execute catch must end there.
    const previewedBranches = flow.match(/recovered\.state === "previewed"/g) ?? [];
    expect(previewedBranches.length).toBeGreaterThanOrEqual(2);
    expect(flow).toContain(
      "We couldn't start that import. Nothing was changed — confirm again to retry.",
    );
  });

  it("bounds the poll so it can never run indefinitely", () => {
    expect(flow).toContain("const POLL_MAX_ATTEMPTS");
    expect(flow).toContain("const POLL_INTERVAL_MS");
    expect(flow).toMatch(/attempts >= POLL_MAX_ATTEMPTS/);
    // Every exit path routes through giveUp, which leaves the spinner.
    expect(flow).toMatch(/const giveUp = \([\s\S]{0,200}?setStep\("permission"\)/);
  });

  it("never leaves the importing screen silent while something is wrong", () => {
    // The importing screen previously rendered only a disabled spinner, so a
    // poll reporting trouble had nowhere to surface.
    const importingScreen = flow.slice(flow.indexOf('if (step === "importing")'));
    expect(importingScreen.slice(0, 900)).toMatch(/\{error \?/);
  });

  it("fetches every result page before reporting completion", () => {
    // A 212-row execute returns only the first 200 rows plus resultPage.total;
    // the rest must be pulled in before onCompleted fires.
    expect(flow).toContain("const hydrateCompletionRows");
    expect(flow).toMatch(/Math\.ceil\(total \/ pageSize\) - 1/);
  });
});

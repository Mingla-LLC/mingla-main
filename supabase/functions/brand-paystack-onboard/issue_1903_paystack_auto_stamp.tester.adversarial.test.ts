/**
 * #1903 independent tester regression.
 *
 * A successful stamp RPC can commit its append-only ledger row and then lose
 * the HTTP response. The caller must reconcile the same batch id before it
 * records a failure; otherwise one immutable attempt permanently claims both
 * `flipped` (or `skipped_already_stamped`) and `stamp_failed`. This guard also
 * keeps reconciliation ahead of failure recording and ensures transport
 * messages containing bank/provider details never enter logs or audit data.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { attemptPaystackOnboardStamp } from "./index.ts";

type CommittedOutcome = "flipped" | "skipped_already_stamped";
type Outcome = "dark_skip" | CommittedOutcome | "stamp_failed";

type LedgerRow = {
  batchId: string;
  result: CommittedOutcome | "stamp_failed";
};

function lostResponseFixture(committed: CommittedOutcome | null) {
  const calls: string[] = [];
  const ledger: LedgerRow[] = [];
  const audits: Array<{ outcome: Outcome; attemptId: string | null }> = [];
  const logs: Array<{
    outcome: Outcome;
    attemptId: string | null;
    errorClass?: string;
    errorCode?: string;
  }> = [];
  const attemptId = "19030000-0000-4000-8000-000000000001";

  const deps = {
    resolveEnabled: (): boolean => true,
    randomUuid: (): string => {
      calls.push("uuid");
      return attemptId;
    },
    stamp: async (batchId: string): Promise<CommittedOutcome> => {
      calls.push("stamp");
      if (committed) ledger.push({ batchId, result: committed });
      throw {
        name: "TransportError",
        code: "ECONNRESET",
        message:
          "lost response with forbidden bank/provider detail 0123456789 RCP_secret",
      };
    },
    // This dependency is deliberately part of the tester contract. A correct
    // implementation must call it after an ambiguous RPC error and before any
    // append-only failure write.
    reconcileAttempt: async (batchId: string): Promise<CommittedOutcome | null> => {
      calls.push("reconcile");
      return ledger.find((row) =>
        row.batchId === batchId && row.result !== "stamp_failed"
      )?.result as CommittedOutcome | undefined ?? null;
    },
    recordFailure: async (batchId: string): Promise<void> => {
      calls.push("record_failure");
      ledger.push({ batchId, result: "stamp_failed" });
    },
    recordApplicationOutcome: async (
      outcome: Outcome,
      batchId: string | null,
    ): Promise<void> => {
      calls.push(`audit:${outcome}`);
      audits.push({ outcome, attemptId: batchId });
    },
    log: (
      outcome: Outcome,
      batchId: string | null,
      errorClass?: string,
      errorCode?: string,
    ): void => {
      calls.push(`log:${outcome}`);
      logs.push({ outcome, attemptId: batchId, errorClass, errorCode });
    },
  };

  return { attemptId, calls, ledger, audits, logs, deps };
}

for (const committed of ["flipped", "skipped_already_stamped"] as const) {
  Deno.test(
    `#1903 A-lost-response: committed ${committed} wins over transport failure`,
    async () => {
      const f = lostResponseFixture(committed);
      const outcome = await attemptPaystackOnboardStamp(f.deps);

      assertEquals(outcome, committed);
      assertEquals(f.calls, [
        "uuid",
        "stamp",
        "reconcile",
        `audit:${committed}`,
        `log:${committed}`,
      ]);
      assertEquals(f.ledger, [{ batchId: f.attemptId, result: committed }]);
      assertEquals(f.audits, [{ outcome: committed, attemptId: f.attemptId }]);
      assertEquals(f.logs, [{
        outcome: committed,
        attemptId: f.attemptId,
        errorClass: undefined,
        errorCode: undefined,
      }]);
    },
  );
}

Deno.test(
  "#1903 A-genuine-failure: reconcile precedes one bounded stamp_failed append",
  async () => {
    const f = lostResponseFixture(null);
    const outcome = await attemptPaystackOnboardStamp(f.deps);

    assertEquals(outcome, "stamp_failed");
    assertEquals(f.calls, [
      "uuid",
      "stamp",
      "reconcile",
      "record_failure",
      "audit:stamp_failed",
      "log:stamp_failed",
    ]);
    assertEquals(f.ledger, [{ batchId: f.attemptId, result: "stamp_failed" }]);
    assertEquals(f.audits, [{ outcome: "stamp_failed", attemptId: f.attemptId }]);
    assertEquals(f.logs, [{
      outcome: "stamp_failed",
      attemptId: f.attemptId,
      errorClass: "TransportError",
      errorCode: "ECONNRESET",
    }]);
    const emitted = JSON.stringify({ audits: f.audits, logs: f.logs });
    assert(!emitted.includes("0123456789"));
    assert(!emitted.includes("RCP_secret"));
    assert(!emitted.includes("lost response"));
  },
);

Deno.test(
  "#1903 A-fresh-attempts: concurrent calls never share a batch id",
  async () => {
    let sequence = 0;
    const attempts: string[] = [];
    const deps = {
      resolveEnabled: (): boolean => true,
      randomUuid: (): string => {
        sequence += 1;
        return `19030000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      },
      stamp: async (attemptId: string): Promise<CommittedOutcome> => {
        attempts.push(attemptId);
        return attempts.length === 1 ? "flipped" : "skipped_already_stamped";
      },
      reconcileAttempt: async (): Promise<CommittedOutcome | null> => null,
      recordFailure: async (): Promise<void> => {
        throw new Error("failure recording is unreachable on RPC success");
      },
      recordApplicationOutcome: async (): Promise<void> => {},
      log: (): void => {},
    };

    assertEquals(
      await Promise.all([
        attemptPaystackOnboardStamp(deps),
        attemptPaystackOnboardStamp(deps),
      ]),
      ["flipped", "skipped_already_stamped"],
    );
    assertEquals(new Set(attempts).size, 2);
  },
);

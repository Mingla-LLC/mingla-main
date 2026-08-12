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
type Outcome =
  | "dark_skip"
  | CommittedOutcome
  | "stamp_failed"
  | "stamp_outcome_unknown";

type FixtureOptions = {
  stampResponse?: "resolved_database_error";
  reconciliation?: "scheduled_empty";
};

type LedgerRow = {
  batchId: string;
  result: CommittedOutcome | "stamp_failed";
};

function lostResponseFixture(
  committed: CommittedOutcome | null,
  options: FixtureOptions = {},
) {
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
  let elapsedOffset = 0;

  const deps = {
    resolveEnabled: (): boolean => true,
    randomUuid: (): string => {
      calls.push("uuid");
      return attemptId;
    },
    stamp: async (batchId: string): Promise<CommittedOutcome> => {
      calls.push("stamp");
      if (options.stampResponse === "resolved_database_error") {
        return {
          data: null,
          error: {
            name: "PostgrestError",
            code: "P0001",
            message:
              "resolved database error with forbidden detail 0123456789 RCP_secret",
          },
        } as unknown as CommittedOutcome;
      }
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
    reconcileAttempt: async (
      batchId: string,
    ): Promise<CommittedOutcome | null> => {
      calls.push(
        options.reconciliation === "scheduled_empty"
          ? `reconcile:${elapsedOffset}`
          : "reconcile",
      );
      return ledger.find((row) =>
        row.batchId === batchId && row.result !== "stamp_failed"
      )?.result as CommittedOutcome | undefined ?? null;
    },
    delayUntil: async (offsetMs: number): Promise<void> => {
      elapsedOffset = offsetMs;
      calls.push(`delay:${offsetMs}`);
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
  "#1903 A-ambiguous-empty: transport loss exhausts visibility schedule without fabricating failure",
  async () => {
    const f = lostResponseFixture(null, { reconciliation: "scheduled_empty" });
    const outcome = await attemptPaystackOnboardStamp(f.deps);

    assertEquals(outcome, "stamp_outcome_unknown");
    assertEquals(f.calls, [
      "uuid",
      "stamp",
      "reconcile:0",
      "delay:100",
      "reconcile:100",
      "delay:250",
      "reconcile:250",
      "delay:500",
      "reconcile:500",
      "delay:1000",
      "reconcile:1000",
      "delay:2000",
      "reconcile:2000",
      "audit:stamp_outcome_unknown",
      "log:stamp_outcome_unknown",
    ]);
    assertEquals(f.calls.filter((call) => call === "stamp").length, 1);
    assertEquals(f.calls.filter((call) => call === "record_failure").length, 0);
    assertEquals(f.ledger, []);
    assertEquals(f.audits, [{
      outcome: "stamp_outcome_unknown",
      attemptId: f.attemptId,
    }]);
    assertEquals(f.logs, [{
      outcome: "stamp_outcome_unknown",
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
  "#1903 A-definite-no-commit: resolved database error permits one reconciled failure append",
  async () => {
    const f = lostResponseFixture(null, {
      stampResponse: "resolved_database_error",
    });
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
    assertEquals(f.calls.filter((call) => call === "stamp").length, 1);
    assertEquals(f.calls.filter((call) => call.startsWith("delay:")).length, 0);
    assertEquals(f.calls.filter((call) => call === "record_failure").length, 1);
    assertEquals(f.ledger, [{ batchId: f.attemptId, result: "stamp_failed" }]);
    assertEquals(f.audits, [{
      outcome: "stamp_failed",
      attemptId: f.attemptId,
    }]);
    assertEquals(f.logs, [{
      outcome: "stamp_failed",
      attemptId: f.attemptId,
      errorClass: "PostgrestError",
      errorCode: "P0001",
    }]);
    const emitted = JSON.stringify({ audits: f.audits, logs: f.logs });
    assert(!emitted.includes("0123456789"));
    assert(!emitted.includes("RCP_secret"));
    assert(!emitted.includes("resolved database error"));
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

Deno.test(
  "#1903 A-missing-reconciler: ambiguous transport failure cannot fabricate stamp_failed",
  async () => {
    const calls: string[] = [];
    const attemptId = "19030000-0000-4000-8000-000000000099";
    const outcome = await attemptPaystackOnboardStamp({
      resolveEnabled: (): boolean => true,
      randomUuid: (): string => {
        calls.push("uuid");
        return attemptId;
      },
      stamp: async (): Promise<never> => {
        calls.push("stamp");
        throw {
          name: "TransportError",
          code: "ECONNRESET",
          message:
            "missing reconciler with forbidden bank/provider detail 0123456789 RCP_secret",
        };
      },
      recordFailure: async (): Promise<void> => {
        calls.push("record_failure");
      },
      recordApplicationOutcome: async (decided): Promise<void> => {
        calls.push(`audit:${decided}`);
      },
      log: (decided, _batchId, errorClass, errorCode): void => {
        calls.push(`log:${decided}:${errorClass}:${errorCode}`);
      },
    });

    assertEquals(outcome, "stamp_outcome_unknown");
    assertEquals(calls, [
      "uuid",
      "stamp",
      "audit:stamp_outcome_unknown",
      "log:stamp_outcome_unknown:TransportError:ECONNRESET",
    ]);
    assertEquals(calls.filter((call) => call === "record_failure").length, 0);
    const emitted = JSON.stringify({ outcome, calls, attemptId });
    assert(!emitted.includes("0123456789"));
    assert(!emitted.includes("RCP_secret"));
    assert(!emitted.includes("missing reconciler"));
  },
);

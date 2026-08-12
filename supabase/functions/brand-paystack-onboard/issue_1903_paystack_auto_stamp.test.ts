/**
 * #1903 implementor regression: Paystack auto-stamping is bundle-dark and may
 * run only after the rail-defining brand write. Sharing Stripe authority,
 * accepting a direct Paystack authority, stamping earlier, or activating this
 * compatibility rollout can convert a real merchant prematurely.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { attemptPaystackOnboardStamp } from "./index.ts";

type Outcome =
  | "dark_skip"
  | "flipped"
  | "skipped_already_stamped"
  | "stamp_failed";

function fixture(options: {
  enabled: boolean;
  rpcOutcome?: "flipped" | "skipped_already_stamped";
  rpcReject?: unknown;
  ledgerReject?: unknown;
}) {
  // [TEST-MOD-APPROVED #1903] Orchestrator review 5260928043 requires every
  // failure append to follow a real clean reconciliation. The original helper
  // modeled a resolved database rejection as a thrown ambiguous response and
  // treated a lost failure-insert response as proven failure without a read.
  const calls: string[] = [];
  const attempts: string[] = [];
  const audits: Outcome[] = [];
  const logs: Outcome[] = [];
  let failureVisible = false;
  const deps = {
    resolveEnabled: (): boolean => options.enabled,
    randomUuid: (): string => {
      calls.push("uuid");
      return `00000000-0000-4000-8000-${
        String(attempts.length + 1).padStart(12, "0")
      }`;
    },
    stamp: async (attemptId: string) => {
      calls.push("stamp");
      attempts.push(attemptId);
      if (options.rpcReject) return { data: null, error: options.rpcReject };
      return options.rpcOutcome ?? "flipped";
    },
    reconcileAttempt: async () =>
      failureVisible ? { kind: "failure" as const } : null,
    recordFailure: async () => {
      calls.push("record_failure");
      if (options.ledgerReject) {
        failureVisible = true;
        throw options.ledgerReject;
      }
    },
    recordApplicationOutcome: async (outcome: Outcome) => {
      calls.push(`audit:${outcome}`);
      audits.push(outcome);
    },
    log: (outcome: Outcome) => {
      calls.push(`log:${outcome}`);
      logs.push(outcome);
    },
  };
  return { calls, attempts, audits, logs, deps };
}

Deno.test(
  "#1903 A2: missing reconciler leaves ambiguous transport outcome unknown",
  async () => {
    const calls: string[] = [];
    const outcome = await attemptPaystackOnboardStamp({
      resolveEnabled: () => true,
      randomUuid: () => "19030000-0000-4000-8000-000000000020",
      stamp: async () => {
        throw { name: "TransportError", code: "ECONNRESET", message: "secret" };
      },
      recordFailure: async () => {
        calls.push("record_failure");
      },
      recordApplicationOutcome: async (decided, _attemptId, reason) => {
        calls.push(`audit:${decided}:${reason}`);
      },
      log: (decided, _attemptId, errorClass, errorCode, reason) => {
        calls.push(`log:${decided}:${errorClass}:${errorCode}:${reason}`);
      },
    });

    assertEquals(outcome, "stamp_outcome_unknown");
    assertEquals(calls, [
      "audit:stamp_outcome_unknown:RECONCILIATION_ERROR",
      "log:stamp_outcome_unknown:TransportError:ECONNRESET:RECONCILIATION_ERROR",
    ]);
  },
);

Deno.test(
  "#1903 A2: missing reconciler cannot authorize definite-error failure append",
  async () => {
    const calls: string[] = [];
    const outcome = await attemptPaystackOnboardStamp({
      resolveEnabled: () => true,
      randomUuid: () => "19030000-0000-4000-8000-000000000021",
      stamp: async () => ({
        data: null,
        error: { name: "PostgrestError", code: "P0001", message: "secret" },
      }),
      recordFailure: async () => {
        calls.push("record_failure");
      },
      recordApplicationOutcome: async (decided, _attemptId, reason) => {
        calls.push(`audit:${decided}:${reason}`);
      },
      log: (decided, _attemptId, errorClass, errorCode, reason) => {
        calls.push(`log:${decided}:${errorClass}:${errorCode}:${reason}`);
      },
    });

    assertEquals(outcome, "stamp_outcome_unknown");
    assertEquals(calls, [
      "audit:stamp_outcome_unknown:RECONCILIATION_ERROR",
      "log:stamp_outcome_unknown:PostgrestError:P0001:RECONCILIATION_ERROR",
    ]);
  },
);

Deno.test("#1903 H-3: dark success makes zero stamp or cutover-row calls", async () => {
  const f = fixture({ enabled: false });
  const outcome = await attemptPaystackOnboardStamp(
    f.deps,
  );
  assertEquals(outcome, "dark_skip");
  assertEquals(f.calls, ["log:dark_skip"]);
  assertEquals(f.attempts, []);
  assertEquals(f.audits, []);
});

Deno.test("#1903 H-4/H-5: true calls once and preserves RPC concurrency truth", async () => {
  for (const rpcOutcome of ["flipped", "skipped_already_stamped"] as const) {
    const f = fixture({ enabled: true, rpcOutcome });
    const outcome = await attemptPaystackOnboardStamp(
      f.deps,
    );
    assertEquals(outcome, rpcOutcome);
    assertEquals(f.calls, [
      "uuid",
      "stamp",
      `audit:${rpcOutcome}`,
      `log:${rpcOutcome}`,
    ]);
    assertEquals(f.attempts.length, 1);
    assert(
      /^[0-9a-f-]{36}$/.test(f.attempts[0]),
      "stamp attempt must receive a fresh UUID-shaped id",
    );
  }
});

Deno.test("#1903 E-3/E-4: stamp failure is truthful and never escapes onboarding", async () => {
  const rpcFailure = fixture({
    enabled: true,
    rpcReject: { name: "PostgrestError", code: "P0001", secret: "redacted" },
  });
  assertEquals(
    await attemptPaystackOnboardStamp(
      rpcFailure.deps,
    ),
    "stamp_failed",
  );
  assertEquals(rpcFailure.calls, [
    "uuid",
    "stamp",
    "record_failure",
    "audit:stamp_failed",
    "log:stamp_failed",
  ]);

  const ledgerFailure = fixture({
    enabled: true,
    rpcReject: new Error("provider detail must not escape"),
    ledgerReject: { name: "LedgerWriteError", code: "LEDGER_WRITE_FAILED" },
  });
  assertEquals(
    await attemptPaystackOnboardStamp(
      ledgerFailure.deps,
    ),
    "stamp_failed",
  );
  assertEquals(ledgerFailure.calls, [
    "uuid",
    "stamp",
    "record_failure",
    "audit:stamp_failed",
    "log:stamp_failed",
  ]);
});

Deno.test(
  "#1903 A2: committed reconciliation wins before definite-failure append",
  async () => {
    const calls: string[] = [];
    const outcome = await attemptPaystackOnboardStamp({
      resolveEnabled: () => true,
      randomUuid: () => "19030000-0000-4000-8000-000000000010",
      stamp: async () => ({
        data: null,
        error: { name: "PostgrestError", code: "P0001", message: "secret" },
      }),
      reconcileAttempt: async () => {
        calls.push("reconcile");
        return "flipped";
      },
      recordFailure: async () => {
        calls.push("record_failure");
      },
      recordApplicationOutcome: async (decided) => {
        calls.push(`audit:${decided}`);
      },
      log: (decided) => calls.push(`log:${decided}`),
    });

    assertEquals(outcome, "flipped");
    assertEquals(calls, ["reconcile", "audit:flipped", "log:flipped"]);
  },
);

Deno.test(
  "#1903 A2: an unconfirmed failure append reconciles once and never retries the insert",
  async () => {
    const calls: string[] = [];
    let reads = 0;
    const outcome = await attemptPaystackOnboardStamp({
      resolveEnabled: () => true,
      randomUuid: () => "19030000-0000-4000-8000-000000000011",
      stamp: async () => ({
        data: null,
        error: { name: "PostgrestError", code: "P0001", message: "secret" },
      }),
      reconcileAttempt: async () => {
        reads += 1;
        calls.push(`reconcile:${reads}`);
        return reads === 1 ? null : { kind: "failure" };
      },
      recordFailure: async () => {
        calls.push("record_failure");
        throw {
          name: "LedgerWriteError",
          code: "LEDGER_WRITE_FAILED",
          message: "secret",
        };
      },
      recordApplicationOutcome: async (decided) => {
        calls.push(`audit:${decided}`);
      },
      log: (decided) => calls.push(`log:${decided}`),
    });

    assertEquals(outcome, "stamp_failed");
    assertEquals(calls, [
      "reconcile:1",
      "record_failure",
      "reconcile:2",
      "audit:stamp_failed",
      "log:stamp_failed",
    ]);
    assertEquals(calls.filter((call) => call === "record_failure").length, 1);
  },
);

for (
  const [label, decision] of [
    [
      "identity mismatch",
      { kind: "unknown", reason: "BATCH_IDENTITY_MISMATCH" },
    ],
    [
      "result conflict",
      { kind: "unknown", reason: "BATCH_RESULT_CONFLICT" },
    ],
  ] as const
) {
  Deno.test(`#1903 A2: ${label} never fabricates a failure row`, async () => {
    const calls: string[] = [];
    const outcome = await attemptPaystackOnboardStamp({
      resolveEnabled: () => true,
      randomUuid: () => "19030000-0000-4000-8000-000000000012",
      stamp: async () => ({
        data: null,
        error: { name: "PostgrestError", code: "P0001", message: "secret" },
      }),
      reconcileAttempt: async () => {
        calls.push("reconcile");
        return decision;
      },
      recordFailure: async () => {
        calls.push("record_failure");
      },
      recordApplicationOutcome: async (decided) => {
        calls.push(`audit:${decided}`);
      },
      log: (decided) => calls.push(`log:${decided}`),
    });

    assertEquals(outcome, "stamp_outcome_unknown");
    assertEquals(calls, [
      "reconcile",
      "audit:stamp_outcome_unknown",
      "log:stamp_outcome_unknown",
    ]);
  });
}

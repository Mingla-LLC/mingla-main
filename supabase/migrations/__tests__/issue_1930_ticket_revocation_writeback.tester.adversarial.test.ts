import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270404001930_issue_1930_ticket_revocation_writeback.sql",
    import.meta.url,
  ),
);
const allowlist = await Deno.readTextFile(
  new URL(
    "../../security/anon_executable_definer_allowlist.txt",
    import.meta.url,
  ),
);
const workflow = await Deno.readTextFile(
  new URL(
    "../../../.github/workflows/issue-1930-checkout-current-truth.yml",
    import.meta.url,
  ),
);

const TEST_PATH =
  "supabase/migrations/__tests__/issue_1930_ticket_revocation_writeback.tester.adversarial.test.ts";

function executable(source: string): string {
  return source.replace(/--[^\n]*/g, "");
}

function assertAtomicWriteback(source: string): void {
  const sql = executable(source);
  const functionStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1930_record_revocation_result(",
  );
  const functionEnd = sql.indexOf("END $$;", functionStart);
  assert(
    functionStart >= 0 && functionEnd > functionStart,
    "result owner missing",
  );
  const body = sql.slice(functionStart, functionEnd);

  const eventLock = body.indexOf(
    "PERFORM 1 FROM public.events WHERE id=v_event_id FOR UPDATE",
  );
  const sessionLock = body.indexOf(
    "SELECT * INTO v_session\n    FROM public.ticket_checkout_sessions",
  );
  const attemptLock = body.indexOf(
    "SELECT * INTO v_attempt\n      FROM public.ticket_checkout_provider_attempts",
  );
  const outboxCas = body.indexOf(
    "UPDATE public.checkout_sale_revocation_outbox SET",
  );
  const sessionWrite = body.indexOf(
    "UPDATE public.ticket_checkout_sessions SET",
  );
  const attemptWrite = body.indexOf(
    "UPDATE public.ticket_checkout_provider_attempts SET",
  );
  assert(
    eventLock >= 0 && eventLock < sessionLock && sessionLock < attemptLock &&
      attemptLock < outboxCas && outboxCas < sessionWrite &&
      sessionWrite < attemptWrite,
    "ticket result must lock event -> session -> attempt, win the outbox CAS, then write exact subject truth",
  );

  const casEnd = body.indexOf("RETURNING * INTO v_outbox;", outboxCas);
  assert(casEnd > outboxCas, "leased outbox CAS must return its winning row");
  const cas = body.slice(outboxCas, casEnd);
  for (
    const predicate of [
      "AND lease_owner=p_worker_id",
      "AND state='leased'",
      "AND subject_type=v_snapshot.subject_type",
      "AND subject_id=v_snapshot.subject_id",
      "AND event_id=v_snapshot.event_id",
      "AND provider_attempt_id IS NOT DISTINCT FROM v_snapshot.provider_attempt_id",
    ]
  ) {
    assert(cas.includes(predicate), `outbox CAS lost predicate: ${predicate}`);
  }

  for (
    const valueMint of [
      "INSERT INTO public.orders",
      "INSERT INTO public.tickets",
      "INSERT INTO public.notifications",
      "INSERT INTO public.partner_splits",
      "INSERT INTO public.brand_payout_releases",
    ]
  ) {
    assert(
      !body.includes(valueMint),
      `writeback must not mint value: ${valueMint}`,
    );
  }

  assert(
    body.includes(
      "IF FOUND AND v_outbox.subject_type='rsvp_contribution' THEN",
    ) &&
      body.includes("UPDATE public.event_rsvp_contributions SET"),
    "the ticket repair must preserve the existing RSVP result owner",
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.issue_1930_record_revocation_result(uuid,text,text,text)\n  FROM PUBLIC,anon,authenticated;",
    ) &&
      sql.includes(
        "GRANT EXECUTE ON FUNCTION public.issue_1930_record_revocation_result(uuid,text,text,text)\n  TO service_role;",
      ),
    "result owner must remain service-role-only",
  );
}

Deno.test("#1930 tester: exact ticket writeback is one CAS-gated no-value transaction", () => {
  assertAtomicWriteback(migration);
});

Deno.test("#1930 tester: hostile lock, CAS, value-mint, RSVP, and privilege regressions fail closed", () => {
  const mutations: Array<[string, string]> = [
    [
      "event lock deletion",
      migration.replace(
        "PERFORM 1 FROM public.events WHERE id=v_event_id FOR UPDATE;",
        "PERFORM 1 FROM public.events WHERE id=v_event_id;",
      ),
    ],
    [
      "lease-state CAS deletion",
      migration.replace("      AND state='leased'\n", ""),
    ],
    [
      "attempt-identity CAS deletion",
      migration.replace(
        "      AND provider_attempt_id IS NOT DISTINCT FROM v_snapshot.provider_attempt_id\n",
        "",
      ),
    ],
    [
      "buyer-value mint insertion",
      migration.replace(
        "    RETURN;\n  END IF;",
        "    INSERT INTO public.orders DEFAULT VALUES;\n    RETURN;\n  END IF;",
      ),
    ],
    [
      "RSVP writeback deletion",
      migration.replace(
        "UPDATE public.event_rsvp_contributions SET",
        "UPDATE public.event_rsvps SET",
      ),
    ],
    [
      "anon privilege widening",
      migration.replace("  TO service_role;", "  TO service_role,anon;"),
    ],
  ];

  for (const [label, hostile] of mutations) {
    assert(hostile !== migration, `${label} fixture did not mutate source`);
    let rejected = false;
    try {
      assertAtomicWriteback(hostile);
    } catch {
      rejected = true;
    }
    assert(rejected, `${label} survived the independent contract`);
  }
});

Deno.test("#1930 tester: service-only result owner is absent from the anon-definer allowlist", () => {
  assert(
    !allowlist.includes("issue_1930_record_revocation_result"),
    "ticket/RSVP result owner must never become anon executable",
  );
});

Deno.test("#1930 tester: this independent guard is executable in every #1930 PR run", () => {
  assertEquals(workflow.match(new RegExp(TEST_PATH, "g"))?.length, 2);
});

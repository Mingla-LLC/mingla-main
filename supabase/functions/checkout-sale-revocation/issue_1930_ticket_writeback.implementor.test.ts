import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const worker = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const writeback = await Deno.readTextFile(
  new URL(
    "../../migrations/20270404001930_issue_1930_ticket_revocation_writeback.sql",
    import.meta.url,
  ),
);

Deno.test("#1930 worker sends every terminal ticket flow through one result owner", () => {
  assertStringIncludes(worker, 'row.subject_type === "rsvp_contribution"');
  assertStringIncludes(worker, "if (!attempt)");
  assertStringIncludes(worker, 'attempt.provider === "paystack"');
  assertStringIncludes(worker, 'attempt.flow === "stripe_checkout"');
  assertStringIncludes(worker, 'attempt.flow === "stripe_native"');
  assertStringIncludes(worker, 'state = "neutralized"');
  const calls = worker.match(/issue_1930_record_revocation_result/g) ?? [];
  assert(calls.length === 1, "ticket and RSVP must share one result RPC owner");
});

Deno.test("#1930 worker result atomically reaches exact ticket subject truth", () => {
  assertStringIncludes(
    writeback,
    "IF v_snapshot.subject_type='ticket_checkout_session' THEN",
  );
  assertStringIncludes(
    writeback,
    "v_session.provider_attempt_id IS DISTINCT FROM",
  );
  assertStringIncludes(
    writeback,
    "UPDATE public.ticket_checkout_sessions SET",
  );
  assertStringIncludes(
    writeback,
    "UPDATE public.ticket_checkout_provider_attempts SET",
  );
  assertStringIncludes(writeback, "neutralized_at=CASE");
});

Deno.test("#1930 worker write-back stays service-only and no-value", () => {
  assertStringIncludes(
    writeback,
    "FROM PUBLIC,anon,authenticated",
  );
  assertStringIncludes(writeback, "TO service_role");
  assert(!writeback.includes("INSERT INTO public.orders"));
  assert(!writeback.includes("INSERT INTO public.tickets"));
  assert(!worker.includes("client_secret"));
});

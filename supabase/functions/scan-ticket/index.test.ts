import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ORCH-0793 — assert the biz_ticket_scan migration carries the time-window
// contract (I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED). The introspection
// reads the migration file straight off disk — Deno doesn't need to be
// connected to a database for this gate to run.
Deno.test(
  "biz_ticket_scan migration enforces event_dates time-window (ORCH-0793)",
  async () => {
    const migrationUrl = new URL(
      "../../migrations/20260528000000_orch_0793_scan_time_window.sql",
      import.meta.url,
    );
    const sql = await Deno.readTextFile(migrationUrl);

    // Contract: reads event_dates, not events.start_at or theme JSON.
    assert(
      sql.includes("event_dates"),
      "RPC body must reference event_dates per I-PROPOSED-AY",
    );

    // Contract: compares against now().
    assert(sql.includes("now()"), "RPC body must compare against now()");

    // Contract: grace constants declared.
    assert(
      sql.includes("c_grace_before"),
      "RPC must declare c_grace_before constant",
    );
    assert(
      sql.includes("c_grace_after"),
      "RPC must declare c_grace_after constant",
    );

    // Contract: new result discriminators emitted.
    assert(
      sql.includes("'not_yet_open'"),
      "RPC must emit 'not_yet_open' discriminator",
    );
    assert(
      sql.includes("'event_ended'"),
      "RPC must emit 'event_ended' discriminator",
    );

    // Contract: nextStartAt / lastEndAt threaded into RETURN jsonb.
    assert(
      sql.includes("nextStartAt"),
      "RPC return shape must include nextStartAt",
    );
    assert(
      sql.includes("lastEndAt"),
      "RPC return shape must include lastEndAt",
    );

    // Contract: ticket status update only on success — the UPDATE
    // statement is gated by `IF v_scan_result = 'success'`.
    assert(
      sql.includes("IF v_scan_result = 'success' THEN") &&
        sql.includes("UPDATE public.tickets"),
      "tickets.status='used' update must be gated by v_scan_result='success'",
    );

    // Contract: migration-time verification probe present.
    assert(
      sql.includes("ORCH-0793 probe failed"),
      "migration must include verification probe with 'ORCH-0793 probe failed' messages",
    );
  },
);

Deno.test(
  "scan-ticket edge function passes RPC result through transparently (ORCH-0793)",
  async () => {
    const indexUrl = new URL("./index.ts", import.meta.url);
    const source = await Deno.readTextFile(indexUrl);

    // The edge function must NOT narrow the result enum. Anything that
    // would re-typecast or filter would block the new discriminators.
    assert(
      source.includes("supabase.rpc(\"biz_ticket_scan\""),
      "edge function must call biz_ticket_scan RPC",
    );
    assert(
      source.includes("return jsonResponse(data)"),
      "edge function must pass RPC data through to client without narrowing",
    );
  },
);

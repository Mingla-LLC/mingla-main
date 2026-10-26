// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 5 — tester adversarial suite for a collab inside a 1:1 chat.
// No database is available to this suite, so the SQL half is a static review of
// 20271230044114_issue_4114_dm_collab.sql (the pg17 replay is the runtime half):
//   * start_dm_collab refuses a blocked pair, a non-friend (including a
//     soft-deleted friendship) and a chat that is not exactly the two of you,
//     all BEFORE the first write, under a row lock on the chat;
//   * ending a 1:1 collab can never delete the chat, its messages or its
//     members: the only deletes are of the session (and the group-roster
//     delete, which now returns early for a linked session), and the link is
//     ON DELETE SET NULL;
//   * only start_dm_collab can link a session to a chat;
//   * the internal helpers are not callable by signed-in users, anon gets nothing;
//   * the app maps each raised error to the right message.
//
// FAILS-ON-REVERT: move the blocked or friends check below the session INSERT,
// add a DELETE on conversations or messages, change the link to ON DELETE
// CASCADE, or grant the internal poster to authenticated, and this suite fails.

import { parseDmCollabStartError } from "../dmCollabModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const readSql = async () =>
  (await Deno.readTextFile(
    new URL("../../../../../supabase/migrations/20271230044114_issue_4114_dm_collab.sql", import.meta.url),
  )).replace(/--.*$/gm, "");

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert(start >= 0, `${name} is defined`);
  const open = sql.indexOf("$function$", start);
  const close = sql.indexOf("$function$", open + 10);
  return sql.slice(start, close);
}

Deno.test("#4114 W5 adversarial: start_dm_collab refuses blocked pairs and non-friends before any write", async () => {
  const body = fnBody(await readSql(), "start_dm_collab");
  const firstInsert = body.indexOf("INSERT INTO");
  assert(firstInsert > 0, "there is a write");
  const lock = body.indexOf("FOR UPDATE");
  assert(lock > 0 && lock < firstInsert, "the chat row is locked before anything is written");
  for (const guard of ["'conversation_unavailable'", "'blocked'", "'not_friends'", "'collab_already_live'", "check_session_creation_allowed"]) {
    const at = body.indexOf(guard);
    assert(at > 0 && at < firstInsert, `${guard} is decided before the first write`);
  }
  assert(/v_member_count <> 2/.test(body), "a chat with more or fewer than two members is refused");
  assert(/blocker_id = v_uid AND b\.blocked_id = v_friend\)\s+OR \(b\.blocker_id = v_friend AND b\.blocked_id = v_uid/.test(body), "a block either way refuses");
  assert(/f\.status = 'accepted' AND f\.deleted_at IS NULL/.test(body), "a soft-deleted friendship is not a friendship");
  assert(/auth\.uid\(\)/.test(body) && /SECURITY DEFINER/.test(body) && /SET search_path = public, pg_temp/.test(body), "definer, caller-bound, pinned path");
});

Deno.test("#4114 W5 adversarial: ending a 1:1 collab never deletes the chat, its messages or its members", async () => {
  const sql = await readSql();
  assert(!/DELETE FROM public\.(conversations|messages)\b/.test(sql), "no delete of a chat or its messages anywhere in the migration");
  assert(!/DROP (TABLE|POLICY)/.test(sql), "no table or policy is dropped");
  assert(/REFERENCES public\.conversations\(id\) ON DELETE SET NULL/.test(sql), "the link never cascades into the chat");
  assert(!/ON DELETE CASCADE/.test(sql), "nothing in this migration cascades");
  const end = fnBody(sql, "end_dm_collab");
  assertEquals((end.match(/DELETE FROM/g) ?? []).length, 1, "end_dm_collab deletes exactly one thing");
  assert(/DELETE FROM public\.collaboration_sessions WHERE id = p_session_id/.test(end), "and it is the session");
  assert(/cs\.conversation_id IS NOT NULL/.test(end), "only a 1:1 collab can be ended this way (a group collab is untouched)");
  assert(/cs\.created_by = v_uid OR EXISTS/.test(end), "only its two people may end it");
  const remove = fnBody(sql, "remove_session_member_from_conversation");
  const early = remove.indexOf("conversation_id IS NOT NULL");
  const del = remove.indexOf("DELETE FROM public.conversation_participants");
  assert(early > 0 && early < del, "the roster delete returns early for a linked session, so nobody leaves the 1:1 chat");
  const decline = fnBody(sql, "tg_end_dm_collab_on_decline");
  assert(/WHERE id = NEW\.session_id AND conversation_id IS NOT NULL/.test(decline), "a decline only ends a 1:1 collab");
});

Deno.test("#4114 W5 adversarial: only start_dm_collab can link a session to a chat", async () => {
  const sql = await readSql();
  const guard = fnBody(sql, "tg_guard_session_conversation_link");
  assert(/current_setting\('issue_4114\.dm_collab_start', true\) IS DISTINCT FROM 'on'/.test(guard), "the link needs the start flag");
  assert(/BEFORE INSERT OR UPDATE OF conversation_id ON public\.collaboration_sessions/.test(sql), "guards insert and re-pointing");
  const start = fnBody(sql, "start_dm_collab");
  const on = start.indexOf("set_config('issue_4114.dm_collab_start', 'on', true)");
  const off = start.indexOf("set_config('issue_4114.dm_collab_start', 'off', true)");
  const insert = start.indexOf("INSERT INTO public.collaboration_sessions");
  assert(on > 0 && on < insert && insert < off, "the flag is on only around the one session insert, transaction-local");
});

Deno.test("#4114 W5 adversarial: grants are narrow", async () => {
  const sql = await readSql();
  for (const internal of ["resolve_session_conversation", "issue_4114_post_dm_collab_event", "issue_4114_first_name"]) {
    assert(new RegExp(`REVOKE ALL ON FUNCTION public\\.${internal}\\([^)]*\\) FROM PUBLIC, anon, authenticated`).test(sql), `${internal} is not callable by users`);
    assert(!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${internal}\\([^)]*\\) TO [^;]*authenticated`).test(sql), `${internal} is never granted to authenticated`);
  }
  for (const rpc of ["start_dm_collab", "end_dm_collab", "list_connection_conversation_access"]) {
    assert(!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\([^)]*\\) TO [^;]*\\banon\\b`).test(sql), `${rpc}: never anon`);
    assert(new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\([^)]*\\) FROM PUBLIC,\\s*anon`).test(sql), `${rpc}: PUBLIC and anon revoked`);
  }
  const definers = sql.match(/SECURITY DEFINER\s*\n\s*SET search_path[^\n]*/g) ?? [];
  const allDefiners = sql.match(/SECURITY DEFINER/g) ?? [];
  assertEquals(definers.length, allDefiners.length, "every SECURITY DEFINER function pins its search_path");
});

Deno.test("#4114 W5 adversarial: each raised start error maps to its own message", () => {
  const cases: Array<[string | null, string]> = [
    ['{"code":"42501","message":"blocked"}', "blocked"],
    ["not_friends", "not_friends"],
    ["session_limit_reached: You have reached your free limit of 1 active session(s).", "limit"],
    ["collab_already_live", "already_live"],
    ["conversation_unavailable", "unavailable"],
    ["dm_collab_link_forbidden", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
  ];
  for (const [message, expected] of cases) {
    assertEquals(parseDmCollabStartError(message), expected, `message ${JSON.stringify(message)}`);
  }
});

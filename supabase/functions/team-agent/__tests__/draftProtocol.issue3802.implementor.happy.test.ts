// Issue #3802 — Connector part 3, Drafts to send.
//
// The real HTTP handler and real gateway against the replayed database:
// save/replay/list/update/withdraw plus the person's mark/Undo lifecycle.
// Run only against a disposable database with the full migration chain.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startSuite, type Suite } from "./_harness.issue3802.ts";

let s: Suite;
const draftIds: string[] = [];

before(async () => { s = await startSuite("d", "f900"); });
after(async () => { await s?.close(); });

const call = async (key: string, name: string, args: unknown = {}) =>
  await s.rpc(key, "tools/call", { name, arguments: args });
const out = (response: Awaited<ReturnType<typeof call>>) =>
  response.json.result.structuredContent;

test("#3802 C-HP1: an agent saves, safely replays, lists and updates only its person's drafts", async () => {
  const args = {
    request_key: "issue3802-drafts-happy-01",
    drafts: [
      { record_id: s.ids.alpha, channel: "email", recipient: "host@example.test", subject: "Hello", body: "First current body", reason: "Follow up", flags: ["date_or_time"] },
      { record_id: s.ids.alpha, channel: "instagram_dm", recipient: "@host", body: "Second current body" },
    ],
  };
  const saved = out(await call(s.keys["growth.claude"], "save_drafts", args));
  assert.equal(saved.replayed, false);
  assert.deepEqual(saved.results.map((row: any) => row.status), ["saved", "saved"]);
  draftIds.push(...saved.results.map((row: any) => row.draft.id));
  assert.equal(saved.results[0].draft.body, "First current body");
  assert.equal(saved.results[0].draft.original_body, "First current body");
  assert.equal("owner_email" in saved.results[0].draft, false);
  assert.equal("request_key" in saved.results[0].draft, false);

  const replayed = out(await call(s.keys["growth.claude"], "save_drafts", args));
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.results.map((row: any) => row.draft.id), draftIds);
  assert.deepEqual(await s.sql("select count(*)::text from public.team_drafts where owner_email=:'e'", { e: s.emails.growth }), ["2"]);

  const changedKey = await call(s.keys["growth.claude"], "save_drafts", {
    ...args,
    drafts: [{ ...args.drafts[0], body: "Changed under a reused key" }],
  });
  assert.equal(changedKey.json.result.isError, true);
  assert.equal(changedKey.json.result.structuredContent.error.token, "request_key_reused");
  assert.deepEqual(await s.sql("select count(*)::text from public.team_drafts where owner_email=:'e'", { e: s.emails.growth }), ["2"]);

  const listed = out(await call(s.keys["growth.codex"], "list_drafts", { state: "waiting" }));
  assert.equal(listed.total, 2);
  assert.deepEqual(new Set(listed.drafts.map((draft: any) => draft.id)), new Set(draftIds));
  const otherPerson = out(await call(s.keys["admin.claude"], "list_drafts", { state: "waiting" }));
  assert.equal(otherPerson.total, 0);
  assert.deepEqual(otherPerson.drafts, []);

  const counts = JSON.parse(await s.asPerson("growth", "select public.team_draft_counts()::text"));
  assert.equal(counts.waiting, 2);
  const day = out(await call(s.keys["growth.codex"], "my_day"));
  assert.equal(day.drafts_waiting, 2);

  const updated = out(await call(s.keys["growth.codex"], "update_draft", {
    id: draftIds[0], changes: { body: "Agent revised current body" },
  }));
  assert.equal(updated.changed, true);
  assert.equal(updated.draft.body, "Agent revised current body");
  assert.equal(updated.draft.original_body, "First current body");
});

test("#3802 C-HP2: a person's edit freezes agent edits; an agent may withdraw only an untouched waiting draft", async () => {
  const personEdit = JSON.parse(await s.asPerson(
    "growth",
    `select public.team_draft_update('${draftIds[0]}'::uuid,'{"body":"Person final body"}'::jsonb)::text`,
  ));
  assert.equal(personEdit.changed, true);
  assert.equal(personEdit.draft.original_body, "First current body");
  assert.equal(personEdit.draft.body, "Person final body");
  assert.ok(personEdit.draft.edited_by_person_at);

  const agentEdit = await call(s.keys["growth.claude"], "update_draft", {
    id: draftIds[0], changes: { body: "Agent must not replace this" },
  });
  assert.equal(agentEdit.json.result.isError, true);
  assert.equal(agentEdit.json.result.structuredContent.error.token, "draft_edited");

  const withdrawn = out(await call(s.keys["growth.claude"], "withdraw_drafts", { ids: [draftIds[1]] }));
  assert.equal(withdrawn.results[0].status, "discarded");
  assert.equal(withdrawn.results[0].draft.state, "discarded");
  const restored = JSON.parse(await s.asPerson(
    "growth",
    `select public.team_draft_restore('${draftIds[1]}'::uuid)::text`,
  ));
  assert.equal(restored.draft.state, "waiting");
});

test("#3802 C-HP3: the person records the exact copied body once, then Undo removes only that touch", async () => {
  const [firstStage] = await s.sql("select public.crm_pipeline_def('hosts')->'stages'->0->>'id'");
  const [secondStage] = await s.sql("select public.crm_pipeline_def('hosts')->'stages'->1->>'id'");
  assert.deepEqual(await s.sql("select stage from public.crm_records where id=:'record'::uuid", { record: s.ids.alpha }), [firstStage]);
  const marked = JSON.parse(await s.asPerson(
    "growth",
    `select public.team_draft_mark_sent('${draftIds[0]}'::uuid,'Person final body')::text`,
  ));
  assert.equal(marked.changed, true);
  assert.equal(marked.draft.state, "sent");
  assert.equal(marked.draft.body, "Person final body");
  assert.equal(marked.draft.send_attempt, 1);
  assert.ok(marked.draft.sent_activity_id);
  assert.deepEqual(await s.sql(
    "select count(*)::text from public.crm_activity where id=:'id'::uuid and record_id=:'record'::uuid and kind='touch' and direction='outbound' and body='Person final body' and via is null and actor_email=:'email'",
    { id: marked.draft.sent_activity_id, record: s.ids.alpha, email: s.emails.growth },
  ), ["1"]);
  assert.deepEqual(await s.sql("select stage from public.crm_records where id=:'record'::uuid", { record: s.ids.alpha }), [secondStage]);

  const repeated = JSON.parse(await s.asPerson(
    "growth",
    `select public.team_draft_mark_sent('${draftIds[0]}'::uuid,'Person final body')::text`,
  ));
  assert.equal(repeated.changed, false);
  assert.equal(repeated.draft.sent_activity_id, marked.draft.sent_activity_id);

  const undone = JSON.parse(await s.asPerson(
    "growth",
    `select public.team_draft_unsend('${draftIds[0]}'::uuid)::text`,
  ));
  assert.equal(undone.changed, true);
  assert.equal(undone.stage_undone, true);
  assert.equal(undone.draft.state, "waiting");
  assert.deepEqual(await s.sql("select count(*)::text from public.crm_activity where id=:'id'::uuid", { id: marked.draft.sent_activity_id }), ["0"]);
  assert.deepEqual(await s.sql("select count(*)::text from public.crm_activity where record_id=:'record'::uuid and direction='inbound'", { record: s.ids.alpha }), ["1"]);
  assert.deepEqual(await s.sql("select stage from public.crm_records where id=:'record'::uuid", { record: s.ids.alpha }), [firstStage]);

  const markedAgain = JSON.parse(await s.asPerson(
    "growth",
    `select public.team_draft_mark_sent('${draftIds[0]}'::uuid,'Person final body')::text`,
  ));
  assert.equal(markedAgain.draft.send_attempt, 2);
  assert.notEqual(markedAgain.draft.sent_activity_id, marked.draft.sent_activity_id);
  assert.deepEqual(await s.sql("select count(*)::text from public.crm_activity where id=:'id'::uuid and via is null", { id: markedAgain.draft.sent_activity_id }), ["1"]);
  const undoneAgain = JSON.parse(await s.asPerson(
    "growth",
    `select public.team_draft_unsend('${draftIds[0]}'::uuid)::text`,
  ));
  assert.equal(undoneAgain.draft.state, "waiting");
  assert.deepEqual(await s.sql("select count(*)::text from public.crm_activity where id=:'id'::uuid", { id: markedAgain.draft.sent_activity_id }), ["0"]);
});

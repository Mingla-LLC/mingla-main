// Issue #3802 — independent adversarial proof for private Drafts to send.
//
// This is deliberately not another happy-path walkthrough. It attacks the
// privacy boundary, the person/agent boundary, request-key binding, and a
// concurrent double click against the real HTTP handler and replayed database.
// Run only against a disposable database with the full migration chain.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startSuite, type Suite } from "./_harness.issue3802.ts";

let s: Suite;
let privateDraft = "";

before(async () => {
  s = await startSuite("da", "fa10");
});
after(async () => {
  await s?.close();
});

const call = async (key: string, name: string, args: unknown = {}) =>
  await s.rpc(key, "tools/call", { name, arguments: args });
const out = (response: Awaited<ReturnType<typeof call>>) =>
  response.json.result.structuredContent;

test("#3802 C-TA1: the table is closed and a different person cannot discover or act on draft text", async () => {
  assert.deepEqual(
    await s.sql(
      `select c.relrowsecurity::text || '/' || count(p.policyname)::text
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid=c.relnamespace
       left join pg_catalog.pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
      where n.nspname='public' and c.relname='team_drafts'
      group by c.relrowsecurity`,
    ),
    ["true/0"],
  );
  assert.deepEqual(
    await s.sql(
      `select count(*)::text from information_schema.table_privileges
      where table_schema='public' and table_name='team_drafts'
        and grantee in ('PUBLIC','anon','authenticated')`,
    ),
    ["0"],
  );

  const saved = out(
    await call(s.keys["growth.claude"], "save_drafts", {
      request_key: "issue3802-tester-private-01",
      drafts: [{
        record_id: s.ids.alpha,
        channel: "email",
        recipient: "private@example.test",
        subject: "Private subject",
        body: "Private growth draft text",
      }],
    }),
  );
  privateDraft = saved.results[0].draft.id;
  assert.equal(saved.results[0].status, "saved");

  const otherList = out(
    await call(s.keys["admin.claude"], "list_drafts", {
      state: "waiting",
    }),
  );
  assert.equal(
    otherList.drafts.some((draft: any) => draft.id === privateDraft),
    false,
  );
  assert.equal(
    JSON.stringify(otherList).includes("Private growth draft text"),
    false,
  );

  const otherEdit = await call(s.keys["admin.claude"], "update_draft", {
    id: privateDraft,
    changes: { body: "Admin must not replace private text" },
  });
  assert.equal(otherEdit.json.result.isError, true);
  assert.equal(
    otherEdit.json.result.structuredContent.error.token,
    "not_found",
  );

  const otherWithdraw = out(
    await call(
      s.keys["admin.claude"],
      "withdraw_drafts",
      { ids: [privateDraft] },
    ),
  );
  assert.equal(otherWithdraw.results[0].status, "error");
  assert.equal(otherWithdraw.results[0].error.token, "not_found");

  await assert.rejects(
    s.asPerson(
      "admin",
      `select public.team_draft_mark_sent('${privateDraft}'::uuid,'stolen')::text`,
    ),
    /not_found: That draft is not here\./,
  );
  assert.deepEqual(
    await s.sql(
      "select state || '/' || body from public.team_drafts where id=:'id'::uuid",
      { id: privateDraft },
    ),
    ["waiting/Private growth draft text"],
  );
});

test("#3802 C-TA2: one request key is bound to one tool and every argument before any effect", async () => {
  const key = "issue3802-tester-binding-01";
  const args = {
    request_key: key,
    drafts: [{
      record_id: s.ids.alpha,
      channel: "instagram_dm",
      recipient: "@private",
      body: "Bound original body",
      reason: "Original reason",
    }],
  };
  const saved = out(await call(s.keys["growth.codex"], "save_drafts", args));
  assert.equal(saved.results[0].status, "saved");

  const changedArgument = await call(s.keys["growth.codex"], "save_drafts", {
    ...args,
    drafts: [{ ...args.drafts[0], reason: "Changed reason" }],
  });
  assert.equal(changedArgument.json.result.isError, true);
  assert.equal(
    changedArgument.json.result.structuredContent.error.token,
    "request_key_reused",
  );

  const changedTool = await call(s.keys["growth.codex"], "log_activity", {
    request_key: key,
    entries: [{ id: s.ids.alpha, kind: "note", body: "Must not be logged" }],
  });
  assert.equal(changedTool.json.result.isError, true);
  assert.equal(
    changedTool.json.result.structuredContent.error.token,
    "request_key_reused",
  );
  assert.deepEqual(
    await s.sql(
      "select count(*)::text from public.crm_activity where record_id=:'id'::uuid and body='Must not be logged'",
      { id: s.ids.alpha },
    ),
    ["0"],
  );
  assert.deepEqual(
    await s.sql(
      "select original_body || '/' || body || '/' || reason from public.team_drafts where id=:'id'::uuid",
      { id: saved.results[0].draft.id },
    ),
    ["Bound original body/Bound original body/Original reason"],
  );
});

test("#3802 C-TA3: an agent cannot mark or Undo, and two person clicks create exactly one sent touch", async () => {
  const saved = out(
    await call(s.keys["growth.claude"], "save_drafts", {
      request_key: "issue3802-tester-race-01",
      drafts: [{
        record_id: s.ids.alpha,
        channel: "whatsapp",
        recipient: "+15555550123",
        body: "Copy this exact body",
      }],
    }),
  );
  const id = saved.results[0].draft.id;

  for (
    const forbidden of [
      "team_draft_mark_sent",
      "team_draft_unsend",
      "team_draft_restore",
    ]
  ) {
    const response = await call(s.keys["growth.claude"], forbidden, { id });
    assert.equal(response.json.error.code, -32602, forbidden);
    const direct = await s.gateway(s.keys["growth.claude"], forbidden, { id });
    assert.equal(direct.error.token, "unknown_tool", forbidden);
  }

  const [a, b] = await Promise.all([
    s.asPerson(
      "growth",
      `select public.team_draft_mark_sent('${id}'::uuid,'Copy this exact body')::text`,
    ),
    s.asPerson(
      "growth",
      `select public.team_draft_mark_sent('${id}'::uuid,'Copy this exact body')::text`,
    ),
  ]);
  const results = [JSON.parse(a), JSON.parse(b)];
  assert.deepEqual(results.map((r) => r.changed).sort(), [false, true]);
  const activityId = results.find((r) => r.changed)?.draft.sent_activity_id;
  assert.ok(activityId);
  assert.deepEqual(
    await s.sql(
      `select count(*)::text from public.crm_activity
      where id=:'activity'::uuid and record_id=:'record'::uuid
        and kind='touch' and direction='outbound'
        and body='Copy this exact body' and actor_email=:'email' and via is null`,
      { activity: activityId, record: s.ids.alpha, email: s.emails.growth },
    ),
    ["1"],
  );
  assert.deepEqual(
    await s.sql(
      "select state || '/' || send_attempt::text || '/' || body from public.team_drafts where id=:'id'::uuid",
      { id },
    ),
    ["sent/1/Copy this exact body"],
  );
});

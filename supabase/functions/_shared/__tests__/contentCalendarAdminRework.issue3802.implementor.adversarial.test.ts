import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contentErrorWords,
  createLatestOnlyGate,
  createSingleFlight,
} from "../../../../mingla-admin/src/lib/contentCalendarModel.js";

const read = (relative: string) =>
  Deno.readTextFileSync(new URL(`../../../../${relative}`, import.meta.url));
const PAGE = read("mingla-admin/src/pages/ContentCalendarPage.jsx");
const DRAWER = read(
  "mingla-admin/src/components/contentCalendar/ContentDrawer.jsx",
);
const SERVICE = read("mingla-admin/src/services/contentCalendarService.js");
const MIGRATION = read(
  "supabase/migrations/20271020003802_issue_3802_wave2_content_calendar.sql",
);

Deno.test("#3802 Wave 2 adversarial: rapid Enter/click cannot fan out", async () => {
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((done) => release = done);
  const flight = createSingleFlight(() => "one_request_key");
  const attempts = Array.from(
    { length: 8 },
    () =>
      flight.submit("Same", async (key: string) => {
        calls++;
        assertEquals(key, "one_request_key");
        await held;
      }),
  );
  assertEquals(calls, 0);
  await Promise.resolve();
  assertEquals(calls, 1);
  release();
  await Promise.all(attempts);
  assertEquals(calls, 1);
  assertMatch(PAGE, /createFlight\.current\.submit\(clean/);
  assertMatch(
    PAGE,
    /createFlight\.current\.submit\(clean,[\s\S]*checkContentDuplicate\(clean\)[\s\S]*createContent\(clean, key\)/,
  );
  assertMatch(PAGE, /disabled=\{busy\}/);
});

Deno.test("#3802 Wave 2 adversarial: Undo has durable expired, stale and offline failures", () => {
  assertMatch(contentErrorWords({ token: "undo_expired" }), /expired/i);
  assertMatch(
    contentErrorWords({ token: "stale_write" }),
    /Use latest|changed/i,
  );
  assertMatch(contentErrorWords({ token: "network" }), /offline/i);
  assertMatch(
    PAGE,
    /label: "Undo"[\s\S]*try \{[\s\S]*undoContent[\s\S]*catch \(error\)[\s\S]*variant: "error"/,
  );
  assertMatch(PAGE, /title: "Undo didn’t work"/);
});

Deno.test("#3802 Wave 2 adversarial: every late drawer path is closed over a ticket", () => {
  const gate = createLatestOnlyGate();
  const save = gate.activate("one");
  gate.close();
  assert(!gate.accepts(save));
  assertMatch(DRAWER, /const ticket = gate\.current\.ticket\(\)/);
  for (
    const operation of [
      "updateContent",
      "assignContent",
      "getContent",
      "addContentComment",
      "deleteContent",
    ]
  ) {
    assert(DRAWER.includes(`service.${operation}`), operation);
  }
  assertMatch(
    DRAWER,
    /finally \{ if \(gate\.current\.accepts\(ticket\)\) setBusy\(""\); \}/,
  );
  assertMatch(
    PAGE,
    /\.finally\(\(\) => \{[\s\S]*detailGate\.current\.accepts\(ticket\)/,
  );
});

Deno.test("#3802 Wave 2 adversarial: stale recovery keeps mine and offers both resolutions", () => {
  assertMatch(DRAWER, /setCaughtError\(cause, changes\)/);
  assertMatch(DRAWER, /setStaleChanges\(changes\)/);
  assertMatch(DRAWER, />Use latest<\/Button>/);
  assertMatch(DRAWER, />Save mine<\/Button>/);
  assertMatch(DRAWER, /latest\.item\.revision/);
  assertMatch(DRAWER, /Saving…/);
  assertMatch(DRAWER, /Saved ·/);
  assertMatch(DRAWER, /Save failed/);
});

Deno.test("#3802 Wave 2 adversarial: removed, offline, focus, touch and route state are durable", () => {
  assertMatch(
    DRAWER,
    /cause\?\.token === "not_found"[\s\S]*setRemoved\(true\)/,
  );
  assertMatch(DRAWER, /This card was removed/);
  assertMatch(PAGE, /You’re offline/);
  assertMatch(
    DRAWER,
    /document\.getElementById\(focusTarget\)[\s\S]*control\.focus\(\)/,
  );
  assertMatch(PAGE, /card: \/\^\[0-9a-f-\]\{36\}\$\/i/);
  assertMatch(PAGE, /view: \["calendar", "board", "list"\]/);
  assertMatch(PAGE, /month: \/\^\\d\{4\}/);
  assertMatch(PAGE, /matchMedia\("\(pointer: coarse\)"\)/);
  assertMatch(PAGE, /draggable=\{!coarse\}/);
  assertMatch(PAGE, /min-h-11/);
});

Deno.test("#3802 Wave 2 adversarial: duplicate and payload boundaries stay closed", () => {
  assertMatch(SERVICE, /content_calendar_duplicate_check/);
  assertMatch(PAGE, /That title already exists[\s\S]*Open existing/);
  assertMatch(PAGE, /This may be a duplicate[\s\S]*Add anyway/);
  assertMatch(
    MIGRATION,
    /CREATE UNIQUE INDEX content_calendar_items_title_key_unique/,
  );
  assertMatch(MIGRATION, /content_calendar_audit_metadata_check/);
  assertMatch(
    MIGRATION,
    /ARRAY\['title','copy','copy_text','notes','body','comment','drive_url','live_url','before','after'\]/,
  );
  const auditWrites = [
    ...MIGRATION.matchAll(/content_calendar_audit_write\([\s\S]*?\);/g),
  ].map((match) => match[0]);
  assert(auditWrites.length >= 7);
  for (const write of auditWrites) {
    assert(
      !/jsonb_build_object\('(title|copy|notes|body|drive_url|live_url|before|after)'/
        .test(write),
    );
  }
});

Deno.test("#3802 Wave 2 release guard preserves the environment's own admin function", () => {
  assertMatch(
    MIGRATION,
    /set_config\(\s*'issue3802\.wave2_admin_fn_md5',[\s\S]*md5\(p\.prosrc\)[\s\S]*true\s*\)/,
  );
  assertMatch(
    MIGRATION,
    /IS DISTINCT FROM current_setting\('issue3802\.wave2_admin_fn_md5', true\)/,
  );
  assert(
    !MIGRATION.includes("dc5465a20a4246c6921be0469e261a8b"),
    "the production migration must not pin a replay-only function fingerprint",
  );
});

Deno.test("#3802 Wave 2 adversarial: database owns approvals and backward resets", () => {
  for (
    const field of [
      "copy_approved_by",
      "copy_approved_at",
      "design_approved_by",
      "design_approved_at",
      "published_without_link",
    ]
  ) {
    assert(MIGRATION.includes(field), field);
  }
  assertMatch(MIGRATION, /CREATE TRIGGER content_calendar_item_guard_before/);
  assertMatch(
    MIGRATION,
    /OLD\.stage NOT IN \('idea','writing'\)[\s\S]*copy_locked/,
  );
  assertMatch(
    MIGRATION,
    /v_to_idx<=2[\s\S]*copy_approved_by:=NULL[\s\S]*design_approved_by:=NULL/,
  );
  assertMatch(MIGRATION, /v_to_idx<=4[\s\S]*design_approved_by:=NULL/);
  assertMatch(
    MIGRATION,
    /stage NOT IN \('scheduled','published'\)[\s\S]*cardinality\(channels\) > 0/,
  );
});

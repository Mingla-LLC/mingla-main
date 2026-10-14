// Issue #3802 — Connector part 3, Drafts to send.
//
// Happy path and fail-on-revert proof for the private draft lifecycle, the
// copy-before-record boundary, and the admin queue's cross-surface wiring.
// Hermetic: no network and no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyThenMark, draftValidation, remainingUndoMs } from "../lib/draftModel.js";
import { AREA, PAGE_AREA_OVERRIDES, canOpenPage } from "../lib/access.js";
import { NAV_GROUPS } from "../lib/constants.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const migration = fs.readFileSync(path.join(REPO, "supabase/migrations/20271016003802_issue_3802_wave4_drafts.sql"), "utf8");
const page = read("pages/DraftsPage.jsx");
const card = read("components/drafts/DraftCard.jsx");
const editor = read("components/drafts/DraftEditor.jsx");
const service = read("services/draftService.js");
const counts = read("hooks/useDraftCounts.js");
const queue = read("hooks/useDrafts.js");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

describe("#3802 C happy path: copy first, then record", () => {
  it("never marks sent when copying fails, and preserves the order when it succeeds", async () => {
    const calls = [];
    const failed = await copyThenMark({
      body: "Hello",
      copy: async () => { calls.push("copy"); return false; },
      mark: async () => { calls.push("mark"); },
    });
    assert.deepEqual(failed, { copied: false, marked: false });
    assert.deepEqual(calls, ["copy"]);

    calls.length = 0;
    const passed = await copyThenMark({
      body: "Hello",
      copy: async (body) => { calls.push(`copy:${body}`); return true; },
      mark: async (body) => { calls.push(`mark:${body}`); },
    });
    assert.deepEqual(passed, { copied: true, marked: true });
    assert.deepEqual(calls, ["copy:Hello", "mark:Hello"]);
  });

  it("says copied-but-not-recorded when the second step fails", async () => {
    const failure = new Error("record failed");
    const result = await copyThenMark({
      body: "Hello",
      copy: async () => true,
      mark: async () => { throw failure; },
    });
    assert.equal(result.copied, true);
    assert.equal(result.marked, false);
    assert.equal(result.error, failure);
  });

  it("normalises edits, enforces the limits, and bounds Undo to one minute", () => {
    assert.deepEqual(draftValidation("email", "  Subject  ", "  Hi e\u0301  "), {
      body: "",
      subject: "",
      cleanBody: "Hi é",
      cleanSubject: "Subject",
    });
    assert.match(draftValidation("email", "x".repeat(201), "hello").subject, /200/);
    assert.match(draftValidation("email", "ok", " ").body, /Write a message/);
    assert.equal(remainingUndoMs("2026-10-14T12:00:00Z", Date.parse("2026-10-14T12:00:59Z")), 1000);
    assert.equal(remainingUndoMs("2026-10-14T12:00:00Z", Date.parse("2026-10-14T12:01:01Z")), 0);
  });
});

describe("#3802 C database contract: private text, immutable original, no sender", () => {
  it("is one atomic migration with a closed table and the eight fixed RPCs", () => {
    assert.match(migration, /^BEGIN;/m);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(migration, /ALTER TABLE public\.team_drafts ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /REVOKE ALL ON public\.team_drafts FROM PUBLIC, anon, authenticated/);
    assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*team_drafts/i);
    for (const name of ["save", "update", "list", "discard", "restore", "mark_sent", "unsend", "counts"]) {
      assert.match(migration, new RegExp(`CREATE FUNCTION public\\.team_draft_${name}\\(`), name);
    }
  });

  it("derives ownership from the signed-in person and never accepts it as input", () => {
    const signatures = [...migration.matchAll(/CREATE FUNCTION public\.(team_draft_[a-z_]+)\(([^)]*)\)/g)];
    assert.equal(signatures.length, 8);
    for (const [, name, args] of signatures) {
      assert.doesNotMatch(args, /owner|email|via/i, `${name} accepted authority`);
    }
    assert.ok((migration.match(/owner_email\s*=\s*v\.actor_email/g) || []).length >= 7);
    assert.match(migration, /team_draft_counts[\s\S]*owner_email=v\.actor_email/);
  });

  it("keeps exactly original and current text, with no history or delivery rail", () => {
    assert.match(migration, /body\s+text NOT NULL,[\s\S]*original_body\s+text NOT NULL/);
    assert.doesNotMatch(migration, /SET\s+original_body\s*=/i);
    assert.doesNotMatch(migration, /draft_(?:history|versions)|team_draft_(?:history|versions)/i);
    const implementation = migration.slice(0, migration.indexOf("DO $draftcheck$"));
    assert.doesNotMatch(implementation, /net\.http|http_post|pg_net|sendgrid|twilio|resend|smtp/i);
  });

  it("binds an agent request key to its tool and complete arguments before effects", () => {
    assert.match(migration, /crm_request_claim\(v_rk \|\| '-claim', 'agent:' \|\| v_tool, v_args\)/);
    assert.match(migration, /WHEN 'save_drafts' THEN[\s\S]*team_draft_save/);
    assert.match(migration, /WHEN 'update_draft' THEN[\s\S]*team_draft_update/);
    assert.match(migration, /WHEN 'list_drafts' THEN[\s\S]*team_draft_list/);
    assert.match(migration, /WHEN 'withdraw_drafts' THEN[\s\S]*team_draft_discard/);
  });
});

describe("#3802 C admin queue: one caller, one count source, every role with CRM", () => {
  it("has one route after Creators and uses the existing CRM access grant", () => {
    assert.equal(PAGE_AREA_OVERRIDES.drafts, AREA.CRM);
    const pipeline = NAV_GROUPS.find((group) => group.label === "Pipeline").items;
    assert.equal(pipeline.findIndex((item) => item.id === "drafts"), pipeline.findIndex((item) => item.id === "creators") + 1);
    for (const role of ["owner", "admin", "growth", "partner"]) {
      assert.equal(canOpenPage({ role, status: "active", areas: ["crm"] }, "drafts"), true, role);
    }
    assert.equal(canOpenPage({ role: "growth", status: "active", areas: ["role_home"] }, "drafts"), false);
  });

  it("keeps every browser RPC in the dedicated service", () => {
    const callers = walk(SRC)
      .filter((file) => /\.(?:js|jsx)$/.test(file) && !file.includes(`${path.sep}__tests__${path.sep}`))
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        return [...source.matchAll(/\.rpc\(\s*["'](team_draft_[a-z_]+)["']/g)].map((match) => [file, match[1]]);
      });
    assert.deepEqual(new Set(callers.map(([file]) => path.relative(SRC, file))), new Set(["services/draftService.js"]));
    assert.deepEqual(callers.map(([, name]) => name).sort(), [
      "team_draft_counts", "team_draft_discard", "team_draft_list", "team_draft_mark_sent",
      "team_draft_restore", "team_draft_unsend", "team_draft_update",
    ]);
    assert.doesNotMatch(service, /team_draft_save/);
  });

  it("shares one shell count across navigation, My day and record cards", () => {
    assert.match(counts, /const DraftCountContext = createContext\(null\)/);
    assert.match(counts, /DRAFT_REFRESH_MS = 30_000/);
    assert.match(queue, /mingla:drafts-changed/);
    assert.match(read("components/layout/AppShell.jsx"), /DraftCountProvider/);
    assert.match(read("components/layout/Sidebar.jsx"), /item\.id === "drafts"/);
    assert.match(read("pages/RoleHomePage.jsx"), /label="Drafts waiting"/);
    assert.match(read("components/crm/RecordDrawer.jsx"), /#\/drafts\?record=/);
  });

  it("renders waiting, sent, discarded, deep-link and retry states at desktop and 375px", () => {
    for (const phrase of ["Nothing waiting.", "No sent drafts yet.", "No discarded drafts.", "That draft isn’t here.", "Couldn’t load your drafts", "You’re offline"]) {
      assert.ok(page.includes(phrase), phrase);
    }
    assert.match(page, /grid-cols-1 gap-4 xl:grid-cols-2/);
    assert.match(card, /max-sm:w-full/);
    assert.match(card, /useReducedMotion/);
    assert.match(card, /focus-visible:outline/);
    assert.match(card, /min-h-11/);
    assert.match(editor, /aria-invalid/);
    assert.match(editor, /aria-live="polite"/);
    assert.match(page + card + editor, /var\(--color-background-primary\)/);
    assert.doesNotMatch(page + card + editor, /bg-white|text-black/);
  });

  it("keeps the exact mobile edit hierarchy, offline placeholder and remote-edit recovery", () => {
    assert.match(card, /<SectionCard className="min-w-0" noPadding>/);
    assert.match(editor, /\{primaryAction\}[\s\S]*grid gap-2[\s\S]*Save changes[\s\S]*Cancel[\s\S]*grid grid-cols-2 gap-2[\s\S]*\{openAction\}\{discardAction\}/);
    assert.match(editor, /aria-describedby=\{!online \? offlineHelpId : undefined\}/);
    assert.match(page, /!online && queue\.error && queue\.drafts\.length === 0/);
    assert.match(queue, /while \(!found && cursor\)/);
    assert.match(queue, /acceptRemote/);
    assert.match(editor, /onUseLatest\?\.\(remote\)/);
    assert.match(queue, /Draft no longer waiting\./);
  });
});

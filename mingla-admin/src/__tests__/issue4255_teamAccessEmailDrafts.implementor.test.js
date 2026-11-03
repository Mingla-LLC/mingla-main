// Issue #4255 (Wave 1) — admin client access and shared email drafts.
//
//   A  Owner, admin and Founding partner are full-admin seats (D3); growth is not.
//   B  Every teammate sees the Email and Blog tabs on Support (D5, blog writers);
//      Community stays closed to a teammate with no Community role.
//   C  Drafts live on the server: the old browser draft moves once, a
//      recovery copy is kept only while unsaved, restoring never pre-selects an
//      Explorer audience, and the author or an admin edits.
//   D  The composer and the Email page use the shared drafts, not localStorage.
//
// Fails on revert: without lib/emailDrafts.js or the access changes the imports
// below do not resolve or the assertions fail.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AREA, BLOG_AREA, canOpenPage, isFullAdmin } from "../lib/access.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_PAGE_TABS, SUPPORT_PAGE_TABS } from "../lib/supportCommunityTabs.js";
import { EMAIL_DRAFT_KEY } from "../lib/emailDraftAudience.js";
import {
  EMAIL_DRAFT_MIGRATED_KEY,
  EMAIL_DRAFT_RECOVERY_KEY,
  canEditDraft,
  clearEmailDraftStorage,
  composerStateFromDraft,
  draftAuthorLabel,
  draftErrorMessage,
  draftFingerprint,
  draftPayload,
  hasDraftContent,
  isDraftConflict,
  legacyDraftPayload,
  legacyDraftToMigrate,
  markLegacyDraftMigrated,
  readRecoveryCopy,
  writeRecoveryCopy,
} from "../lib/emailDrafts.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(SRC, relative), "utf8");

const FULL = ["admin_console", "team_manage", "crm", "beta_leads", "email_drafts", "blog"];
const person = (role, areas, status = "active") => ({ email: `${role}@example.test`, role, status, areas });

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    has: (key) => data.has(key),
  };
}

const DEFAULTS = { userType: "host", country: "all" };

describe("A — full-admin seats", () => {
  it("owner, admin and Founding partner are full admins; growth and invited people are not", () => {
    for (const role of ["owner", "admin", "partner"]) assert.equal(isFullAdmin(person(role, FULL)), true, role);
    assert.equal(isFullAdmin(person("growth", ["role_home", "crm", "beta_leads", "email_drafts"])), false);
    assert.equal(isFullAdmin(person("partner", FULL, "invited")), false);
    // The server's areas decide: a partner label without admin_console is not a full admin.
    assert.equal(isFullAdmin(person("partner", ["crm"])), false);
    assert.equal(isFullAdmin(null), false);
  });

  it("a Founding partner opens every page an admin opens", () => {
    for (const page of ["overview", "mingla-money", "settings", "admin", "support", "community", "data-room"]) {
      assert.equal(canOpenPage(person("partner", [...FULL, "data_room", "community_support"]), page),
        canOpenPage(person("admin", [...FULL, "data_room", "community_support"]), page), page);
    }
    assert.equal(canOpenPage(person("partner", FULL), "admin"), true, "Team and roles");
  });
});

describe("B — Email and Blog for every teammate", () => {
  const growth = person("growth", ["role_home", "crm", "beta_leads", AREA.EMAIL_DRAFTS, BLOG_AREA]);
  const ids = (a, tabs) => communitySupportTabsForAccess(a, tabs).map((t) => t.id);

  it("a growth teammate opens Support with exactly Email and Blog", () => {
    assert.equal(canOpenPage(growth, "support"), true);
    assert.deepEqual(ids(growth, SUPPORT_PAGE_TABS), ["email", "blog"]);
  });

  it("Community stays closed to them", () => {
    assert.equal(canOpenPage(growth, "community"), false);
    assert.deepEqual(ids(growth, COMMUNITY_PAGE_TABS), []);
  });

  it("without the areas, neither tab shows", () => {
    const bare = person("growth", ["role_home", "crm", "beta_leads"]);
    assert.equal(canOpenPage(bare, "support"), false);
    assert.deepEqual(ids(bare, SUPPORT_PAGE_TABS), []);
  });

  it("an admin and a partner see every Support tab", () => {
    for (const role of ["admin", "partner"]) {
      assert.deepEqual(ids(person(role, FULL), SUPPORT_PAGE_TABS), SUPPORT_PAGE_TABS.map((t) => t.id), role);
    }
  });
});

describe("C — shared drafts", () => {
  const legacy = {
    version: 2,
    audienceMode: "segment",
    filters: { ...DEFAULTS, userType: "explorer" },
    subject: "Old local draft",
    document: [{ id: "b1", type: "rich_text", html: "<p>Saved before #4255</p>" }],
  };

  it("an old browser draft is moved once and then forgotten", () => {
    const storage = memoryStorage({ [EMAIL_DRAFT_KEY]: JSON.stringify(legacy) });
    const found = legacyDraftToMigrate(storage);
    assert.equal(found.subject, "Old local draft");
    const payload = legacyDraftPayload(found);
    assert.equal(payload.subject, "Old local draft");
    assert.equal(payload.status, "draft");
    markLegacyDraftMigrated(storage);
    assert.equal(storage.has(EMAIL_DRAFT_KEY), false);
    assert.equal(storage.getItem(EMAIL_DRAFT_MIGRATED_KEY), "1");
    // A later copy under the old key is never moved again.
    storage.setItem(EMAIL_DRAFT_KEY, JSON.stringify(legacy));
    assert.equal(legacyDraftToMigrate(storage), null);
  });

  it("an empty composer copy is not worth moving", () => {
    const blank = { ...legacy, subject: "", document: [{ id: "b1", type: "rich_text", html: "<p>Hi {first_name},</p><p>Write your update here.</p>" }] };
    assert.equal(hasDraftContent(blank), false);
    assert.equal(legacyDraftToMigrate(memoryStorage({ [EMAIL_DRAFT_KEY]: JSON.stringify(blank) })), null);
  });

  it("restoring a draft never pre-selects an Explorer audience", () => {
    const state = composerStateFromDraft({ subject: "s", document: legacy.document, audience: { audienceMode: "segment", filters: { userType: "explorer" } } }, DEFAULTS);
    assert.equal(state.audienceMode, "segment");
    assert.equal(state.filters.userType, "host");
    const everyone = composerStateFromDraft({ audience: { audienceMode: "everyone" } }, DEFAULTS);
    assert.equal(everyone.filters.userType, "host");
    assert.equal(everyone.document, null);
  });

  it("the payload keeps only what restore can read back, and the fingerprint ignores status", () => {
    const base = { subject: "s", documentValue: legacy.document, audienceMode: "person", filters: DEFAULTS, selectedRecipient: { profile_id: "p1" } };
    const a = draftPayload({ ...base, status: "draft" });
    const b = draftPayload({ ...base, status: "ready_for_review" });
    assert.deepEqual(a.audience.selectedRecipient, { profile_id: "p1" });
    assert.equal(draftPayload({ ...base, audienceMode: "segment" }).audience.selectedRecipient, null);
    assert.equal(draftPayload({ ...base, status: "sent" }).status, "draft");
    assert.equal(draftFingerprint(a), draftFingerprint(b));
  });

  it("the recovery copy survives a reload, and sign-out removes it but keeps an unmoved old draft", () => {
    const storage = memoryStorage({ [EMAIL_DRAFT_KEY]: JSON.stringify(legacy) });
    writeRecoveryCopy(storage, { draftId: "d1", revision: 3, subject: "Unsaved", documentValue: legacy.document, audienceMode: "segment", filters: DEFAULTS, selectedRecipient: null });
    const copy = readRecoveryCopy(storage);
    assert.equal(copy.draftId, "d1");
    assert.equal(copy.revision, 3);
    clearEmailDraftStorage(storage);
    assert.equal(storage.has(EMAIL_DRAFT_RECOVERY_KEY), false);
    assert.equal(storage.has(EMAIL_DRAFT_KEY), true, "an old draft not yet moved is never lost on sign-out");
  });

  it("storage that throws is survived", () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    assert.equal(legacyDraftToMigrate(broken), null);
    assert.equal(readRecoveryCopy(broken), null);
    assert.equal(writeRecoveryCopy(broken, { subject: "x", documentValue: [] }), false);
    clearEmailDraftStorage(broken);
  });

  it("the author or a full admin edits; anyone else saves a copy", () => {
    const draft = { author_id: "u1", author_email: "ada.lovelace@example.test" };
    assert.equal(canEditDraft(draft, { userId: "u1", isAdmin: false }), true);
    assert.equal(canEditDraft(draft, { userId: "u2", isAdmin: true }), true);
    assert.equal(canEditDraft(draft, { userId: "u2", isAdmin: false }), false);
    assert.equal(canEditDraft(null, { userId: null, isAdmin: false }), true, "a new email is yours");
    assert.equal(draftAuthorLabel(draft, "ADA.LOVELACE@example.test"), "You");
    assert.equal(draftAuthorLabel(draft, "someone@example.test"), "Ada Lovelace");
  });

  it("a stale save is explained in plain words", () => {
    const conflict = { code: "PT409", message: "draft_changed" };
    assert.equal(isDraftConflict(conflict), true);
    assert.match(draftErrorMessage(conflict), /Someone saved this draft after you opened it/);
    assert.match(draftErrorMessage({ code: "42501", message: "forbidden" }), /save yours as a copy/i);
    assert.equal(isDraftConflict({ code: "42501" }), false);
  });
});

describe("D — the screens use the shared drafts", () => {
  it("the composer reads and writes drafts through the service, never localStorage directly", () => {
    const composer = read("components/email/EmailComposer.jsx");
    assert.doesNotMatch(composer, /localStorage\./);
    assert.match(composer, /from "\.\.\/\.\.\/services\/emailDraftsService"/);
    assert.match(composer, /saveEmailDraft\(/);
    assert.match(composer, /listEmailDrafts\(/);
    assert.match(composer, /deleteEmailDraft\(/);
    assert.match(composer, /legacyDraftToMigrate\(storage\)/);
    assert.match(composer, /draftAuthorLabel\(row, myEmail\)/, "each draft in the list names its author");
  });

  it("the service writes only through the two RPCs", () => {
    const service = read("services/emailDraftsService.js");
    assert.match(service, /rpc\("admin_email_draft_save"/);
    assert.match(service, /rpc\("admin_email_draft_delete"/);
    assert.doesNotMatch(service, /\.(insert|update|upsert|delete)\(/);
  });

  it("send history and unsubscribes stay admin-only on the Email page", () => {
    const page = read("pages/EmailPage.jsx");
    assert.match(page, /const ADMIN_ONLY_SUB_TABS = new Set\(\["history", "unsubscribes"\]\);/);
    assert.match(page, /<Tabs tabs=\{subTabs\}/);
  });

  it("sign-out clears the recovery copy", () => {
    assert.match(read("context/AuthContext.jsx"), /clearEmailDraftStorage\(globalThis\.localStorage\)/);
  });

  it("Team and roles: names stay the owner's; the refusal copy names who may change access", () => {
    const page = read("pages/AdminPage.jsx");
    assert.match(page, /const canEditNames = canTeam && access\?\.role === "owner";/);
    assert.match(page, /Only the owner, admins and Founding partners can change team access\./);
    assert.match(page, /const locked = isOwner \|\| row\.is_self;/, "the owner row and your own row have no controls");
  });
});

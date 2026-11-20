/* eslint-disable import/first */
/**
 * #4453 — the seams between the workspace's six parts, as built:
 *
 *  1. Team requests: the workspace names a page without a leading slash ("",
 *     "about"); the database stores and accepts only the visitor address
 *     ("/", "/about"). The port converts both ways, and its shapes are the
 *     real hooks' shapes.
 *  2. A request Ari proposed is confirmed with the WHOLE request (the server
 *     replaces the stored arguments with `edited_args` and re-checks every
 *     required field), not only the edited words.
 *  3. "Looks good" states no revision, so it is sent for a page whose
 *     sections were never opened in this session.
 *  4. Messages the preview frame would drop are not sent (or counted as shown).
 *
 * FAILS-ON-REVERT: send `where.page_path` unconverted (1), send `{ what }`
 * alone (2), require a revision for a `reviewed` job (3).
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/sites/__tests__/issue_4453_integration_seams.implementor.test.ts
 */
import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

jest.mock("../../services/supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { buildCreateWebsiteRequestArgs, toWebsiteRequest, type WebsiteRequest } from "../teamRequests";
import { requestPagePath, ticketNumberLabel, toCreateInput, toTeamRequest, workspacePagePath } from "../teamRequestsPort";
import { ALREADY_STARTED_LINE, TEAM_REQUEST_MAX, teamRequestBlocked, teamRequestEditedArgs, teamRequestFromSection } from "../ariWorkspace";
import { createDraftWriter, needsRevision, type DraftJob } from "../draftWriter";
import { buildMarks, PREVIEW_TEXT_MAX, PREVIEW_UNREAD_MAX, parsePreviewMessage, previewTextSendable, swapReducer, EMPTY_SWAP } from "../previewBridge";

const REPO = path.resolve(__dirname, "../../../..");
const read = (file: string): string => fs.readFileSync(path.join(REPO, file), "utf8");
const MIGRATION = read("supabase/migrations/20281119004453_issue_4453_website_team_requests.sql");
/** issue_4453_create_website_request: `v_page !~ '^/[^[:space:][:cntrl:]]*$'` is refused. */
const SQL_PAGE_PATH = /^\/[^\s\x00-\x1f]*$/;

describe("#4453 team requests: one page, two ways to write its address", () => {
  test("the database's rule is the one this test checks against", () => {
    expect(MIGRATION).toContain("v_page !~ '^/[^[:space:][:cntrl:]]*$'");
    expect(MIGRATION).toContain("IF v_section_id IS NOT NULL AND v_page IS NULL THEN");
  });

  test.each([["", "/"], ["about", "/about"], ["resources/faqs", "/resources/faqs"], ["/about/", "/about"], [null, "/"]])(
    "the workspace's %p is stored as %p",
    (workspacePath, stored) => {
      expect(requestPagePath(workspacePath)).toBe(stored);
      expect(SQL_PAGE_PATH.test(requestPagePath(workspacePath))).toBe(true);
      expect(workspacePagePath(stored)).toBe((workspacePath ?? "").replace(/^\/+|\/+$/g, ""));
    },
  );

  test("a request about a section of the HOME page reaches the database with its page (never section_needs_page)", () => {
    const draft = teamRequestFromSection({ typed: "Add a countdown", pageTitle: "Home", pagePath: "", sectionId: "64f1c0ffee64f1c0ffee64f1", sectionLabel: "Top of the page" });
    const args = buildCreateWebsiteRequestArgs(toCreateInput({
      brandId: "b", siteId: "s", what: draft.what, where: draft.where, why: draft.why, missingCapability: draft.missingCapability, draftDigest: "d".repeat(64),
    }), "id-1");
    expect(args.p_where).toEqual({ page_path: "/", section_id: "64f1c0ffee64f1c0ffee64f1", section_label: "Top of the page" });
    expect(args.p_draft_digest).toBe("d".repeat(64));
  });

  test("an inner page keeps its address, and a draft the workspace could not read sends no digest", () => {
    const args = buildCreateWebsiteRequestArgs(toCreateInput({
      brandId: "b", siteId: "s", what: "A gift card page", where: { page_path: "gift-cards", section_id: null, section_label: null }, why: "", missingCapability: "", draftDigest: "",
    }), "id-2");
    expect(args.p_where).toEqual({ page_path: "/gift-cards" });
    expect(args.p_draft_digest).toBeNull();
  });

  test("a row from the database becomes the workspace's request: its page in the workspace's form, its section id, its number", () => {
    const row = toWebsiteRequest({
      ticket_id: "t-1", what: "Add a countdown", section_id: "64f1c0ffee64f1c0ffee64f1", section_label: "Top of the page", page_path: "/",
      due_at: "2026-11-20T10:00:00Z", ready_at: "2026-11-19T18:00:00Z", created_at: "2026-11-19T10:00:00Z", ticket: { ticket_number: 2041, status: "pending" },
    });
    expect(toTeamRequest(row)).toEqual({
      ticketId: "t-1", ticketNumber: "Request 2041", what: "Add a countdown", sectionId: "64f1c0ffee64f1c0ffee64f1", sectionLabel: "Top of the page",
      pagePath: "", status: "ready", createdAt: "2026-11-19T10:00:00Z", dueAt: "2026-11-20T10:00:00Z", readyAt: "2026-11-19T18:00:00Z",
    });
    const whole: WebsiteRequest = { ...row, pagePath: null, sectionId: null, ticketNumber: null, status: "closed" };
    expect(toTeamRequest(whole)).toMatchObject({ pagePath: null, sectionId: null, ticketNumber: "", status: "closed" });
    expect(toTeamRequest({ ...row, pagePath: "/about" }).pagePath).toBe("about");
    expect(ticketNumberLabel(0)).toBe("");
  });

  test("the list asks the database for the section id it needs to land on", () => {
    expect(read("mingla-business/src/sites/teamRequests.ts")).toContain('"ticket_id, what, section_id, section_label, page_path, due_at, ready_at, created_at, ticket:support_tickets!inner(ticket_number, status)"');
    expect(MIGRATION).toMatch(/CREATE TABLE[^;]*support_website_requests[^;]*\bsection_id text/);
  });

  test("the stand-in is gone: the port reads the real hooks", () => {
    const port = read("mingla-business/src/sites/teamRequestsPort.ts");
    expect(port).toContain('from "./teamRequests"');
    expect(port).not.toContain("teamRequests.stub");
    expect(fs.existsSync(path.join(REPO, "mingla-business/src/sites/teamRequests.stub.ts"))).toBe(false);
  });
});

describe("#4453 a request Ari proposed is confirmed whole", () => {
  const proposal = {
    brand_id: "b", site_id: "s", what: "Sell gift cards", where: { page_path: "", section_id: "sec1" }, why: "Guests ask", missing_capability: "No gift cards yet",
    __proposal_context: { card: "x" },
  };

  test("the edited words replace `what`; every field the tool requires still travels", () => {
    const sent = teamRequestEditedArgs(proposal, "Sell gift cards at the till")!;
    expect(sent).toEqual({ brand_id: "b", site_id: "s", what: "Sell gift cards at the till", where: { page_path: "", section_id: "sec1" }, why: "Guests ask", missing_capability: "No gift cards yet" });
    // The tool's own required list, read from the server's source.
    const tools = read("supabase/functions/_shared/agentSiteWorkspaceTools.ts");
    const required = tools.match(/TEAM_REQUEST_PROPERTIES,\s*\[([^\]]+)\]/);
    expect(required).not.toBeNull();
    const names = [...required![1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
    expect(names.sort()).toEqual(["brand_id", "missing_capability", "site_id", "what", "where", "why"]);
    for (const name of names) expect(sent).toHaveProperty(name);
    // Server-owned card data is never sent back as an argument.
    expect(sent).not.toHaveProperty("__proposal_context");
    expect(teamRequestEditedArgs(null, "x")).toBeUndefined();
  });

  test("the server takes edited arguments as the complete request (why `{ what }` alone was refused)", () => {
    const confirm = read("supabase/functions/agent-confirm-action/index.ts");
    expect(confirm).toMatch(/\? \{ \.\.\.\(body\.edited_args as Record<string, unknown>\) \}\s*: storedArgs;/);
  });

  test("the box never lets through more than the request tool accepts", () => {
    const tools = read("supabase/functions/_shared/agentSiteWorkspaceTools.ts");
    const toolMax = Number(tools.match(/const SITE_TEAM_TEXT_MAX = (\d+);/)![1]);
    expect(TEAM_REQUEST_MAX).toBeLessThanOrEqual(toolMax);
    expect(teamRequestBlocked("x".repeat(TEAM_REQUEST_MAX), false)).toBeNull();
    expect(teamRequestBlocked("x".repeat(TEAM_REQUEST_MAX + 1), false)).toContain(String(TEAM_REQUEST_MAX));
    expect(ALREADY_STARTED_LINE).toContain("Undo this");
  });
});

describe("#4453 Looks good needs no revision", () => {
  const reviewed: DraftJob = { kind: "reviewed", pageId: "about", sectionIds: ["s1"], label: "Looks good" };
  const edit: DraftJob = { kind: "edit", pageId: "about", sectionId: "s1", edits: [{ key: "heading", value: "Hi" }], label: "Edit" };

  test("it is sent for a page that was never opened; every other change still waits for the page's revision", async () => {
    expect(needsRevision(reviewed)).toBe(false);
    expect(needsRevision(edit)).toBe(true);
    const sent: { job: DraftJob; revision: string | null }[] = [];
    const errors: unknown[] = [];
    const writer = createDraftWriter({
      send: async (job, revision) => { sent.push({ job, revision }); return null; },
      getRevision: () => null,
      setRevision: () => undefined,
      onState: () => undefined,
      onSaved: () => undefined,
      onError: (error) => errors.push(error),
    });
    await expect(writer.enqueue(reviewed)).resolves.toBe(true);
    expect(sent).toEqual([{ job: reviewed, revision: null }]);
    expect(errors).toEqual([]);
    await expect(writer.enqueue(edit)).resolves.toBe(false);
    expect(sent).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("PAGE_NOT_LOADED");
    writer.dispose();
  });

  test("Studio's mark_reviewed takes no revision from the caller", () => {
    const api = read("mingla-business/src/sites/contentApi.ts");
    expect(api).toMatch(/"mark_reviewed", \{ page_id: [A-Za-z]+, block_ids: [A-Za-z]+ \}/);
  });
});

describe("#4453 the preview bridge: Host sends only what the frame accepts", () => {
  test("limits are the frame's own", () => {
    // The frame's own pattern (the bridge protocol imports it from the shared contract).
    expect(read("packages/site-contracts/src/previewSections.ts")).toContain("PREVIEW_SECTION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/");
    const id64 = "a".repeat(64);
    const section = { id: id64, type: "hero", top: 0, height: 10 };
    expect(parsePreviewMessage({ type: "mingla:preview-ready", page_path: "", sections: [section], scroll_y: 0, doc_height: 10 })).not.toBeNull();
    expect(parsePreviewMessage({ type: "mingla:preview-ready", page_path: "", sections: [{ ...section, id: `${id64}a` }], scroll_y: 0, doc_height: 10 })).toBeNull();
    expect(previewTextSendable("a", "")).toBe(true);
    expect(previewTextSendable("", "a")).toBe(false);
    expect(previewTextSendable("a", "b".repeat(PREVIEW_TEXT_MAX))).toBe(true);
    expect(previewTextSendable("a", "b".repeat(PREVIEW_TEXT_MAX + 1))).toBe(false);
    expect(previewTextSendable("a".repeat(PREVIEW_TEXT_MAX + 1), "b")).toBe(false);
    const many = Array.from({ length: PREVIEW_UNREAD_MAX + 40 }, (_, index) => ({ id: `s${index}`, review: { state: "draft" as const, source: "ari" as const } }));
    expect(buildMarks({ sections: many, selected: null, ari: null }).unread).toHaveLength(PREVIEW_UNREAD_MAX);
  });

  test("the same page rebuilt keeps the owner's scroll; another page starts at its top", () => {
    let state = swapReducer(EMPTY_SWAP, { type: "url", url: "https://x/home-1", page: "home" });
    state = swapReducer(state, { type: "scroll", key: 1, scrollY: 640 });
    const rebuilt = swapReducer(swapReducer(state, { type: "url", url: "https://x/home-2", page: "home" }), { type: "ready", key: 2 });
    expect(rebuilt.shown).toEqual({ key: 2, url: "https://x/home-2", page: "home" });
    expect(rebuilt.scrollY).toBe(640);
    const other = swapReducer(swapReducer(state, { type: "url", url: "https://x/about-1", page: "about" }), { type: "timeout", key: 2 });
    expect(other.shown?.page).toBe("about");
    expect(other.scrollY).toBe(0);
  });

  test("a preview out of sight stays laid out (never display: none), on web, native and behind a \"more\" screen", () => {
    const shell = read("mingla-business/src/components/sites/website/workspace/WorkspaceShell.tsx");
    const hidden = shell.match(/\n  hidden: \{([^}]*)\}/);
    expect(hidden).not.toBeNull();
    expect(hidden![1]).toContain('visibility: "hidden"');
    expect(hidden![1]).not.toContain("display");
    const web = read("mingla-business/src/components/sites/website/workspace/LivePreview.web.tsx");
    // The frame still loading sits UNDER the one shown (never see-through: a see-through page
    // holds its entrance motion back and would play it in front of the owner on the swap).
    expect(web).toContain('zIndex: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none"');
    expect(web).not.toContain("opacity: visible ? 1 : 0");
    expect(web).not.toMatch(/display:\s*["']none["']/);
    const native = read("mingla-business/src/components/sites/website/workspace/LivePreview.tsx");
    expect(native).toContain("hidden: { opacity: 0 }");
    expect(native).not.toMatch(/display:\s*["']none["']/);
  });
});

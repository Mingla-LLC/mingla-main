// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 Phase 0 characterization (KEEP). Frozen for the whole #4435 build:
// session rules the build must not change. Assertions are written against
// behaviour markers, not file positions, so moving code into a shared service
// keeps them green while removing the behaviour turns them red.
import { groupJoinAction } from "../friendShareLink.ts";
import { isDmCollabActive } from "../../components/chat/dmCollabModel.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function sourceFiles(dir: URL): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) out.push(...sourceFiles(child));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(Deno.readTextFileSync(child));
  }
  return out;
}
const appSources = [...sourceFiles(new URL("src/", root)), ...sourceFiles(new URL("app/", root))];

Deno.test("R4-dm unfriend/block cleanup still deletes the shared session and its invites", () => {
  const cleanup = read("src/utils/sharedSessionCleanup.ts");
  assert(cleanup.includes("export async function cleanupSharedSessions("), "cleanupSharedSessions exists");
  assert(/from\("collaboration_invites"\)\.delete\(\)\.eq\("session_id", sessionId\)/.test(cleanup), "invites deleted");
  assert(/from\("collaboration_sessions"\)\.delete\(\)\.eq\("id", sessionId\)/.test(cleanup), "session deleted");
});

Deno.test("R3 the creator's Delete removes the other members, then the session", () => {
  const found = appSources.some((source) => {
    const partners = source.search(/from\(["']session_participants["']\)\s*\.delete\(\)\s*\.eq\(["']session_id["'],[^)]*\)\s*\.neq\(["']user_id["']/);
    if (partners < 0) return false;
    const rest = source.slice(partners);
    return /from\(["']collaboration_sessions["']\)\s*\.delete\(\)/.test(rest);
  });
  assert(found, "a delete of the other members followed by the session delete exists");
});

Deno.test("R6-legacy accepting the second invite creates the board and activates the session", () => {
  const service = read("src/services/collaborationInviteService.ts");
  assert(/acceptedMembers\.length >= 2/.test(service), "activation waits for 2 accepted (INV-6 legacy)");
  assert(/from\('boards'\)\s*\.insert\(/.test(service), "a board is created");
  assert(/from\('board_collaborators'\)\s*\.upsert\(/.test(service), "board collaborators are written");
  assert(/update\(\{ status: 'active'/.test(service), "the session becomes active");
});

Deno.test("R11-selector collab mode with fewer than 2 accepted waits for participants", () => {
  const ctx = read("src/contexts/RecommendationsContext.tsx");
  assert(/const acceptedCount = allParticipantPrefs\.length;\s*if \(acceptedCount < 2\) \{\s*return \{ type: 'WAITING_FOR_PARTICIPANTS' \};/.test(ctx), "selector < 2");
});

Deno.test("R21-mapper group join results map to actions", () => {
  equals(groupJoinAction({ status: "joined", conversationId: "c", sessionId: "s" }, null), { type: "open_chat", conversationId: "c", sessionId: "s" }, "joined");
  equals(groupJoinAction({ status: "already_member", conversationId: "c" }, null), { type: "open_chat", conversationId: "c", sessionId: null }, "already_member");
  equals(groupJoinAction({ status: "invited", conversationId: "c", sessionId: "s", inviteId: "i" }, null), { type: "accept_then_open", conversationId: "c", sessionId: "s", inviteId: "i" }, "invited");
  equals(groupJoinAction({ status: "requested", conversationId: "c" }, null).type, "toast", "requested");
});

Deno.test("R25 R26 cancel and board-screen leave delete only my row and decline my invite", () => {
  const hook = read("src/hooks/useSessionManagement.ts");
  const start = hook.indexOf("const cancelSession = useCallback(");
  assert(start >= 0, "cancelSession exists");
  const body = hook.slice(start, hook.indexOf("\n  }, [", start));
  assert(/from\('session_participants'\)\s*\.delete\(\)\s*\.eq\('session_id', sessionId\)\s*\.eq\('user_id', user\.id\)/.test(body), "own row deleted");
  assert(/from\('collaboration_invites'\)\s*\.update\(\{ status: 'declined' \}\)/.test(body), "own invite declined");
  assert(body.includes("remove_participant_prefs"), "prefs removed");
});

Deno.test("R35 add-to-board offers pending and active sessions", () => {
  const modal = read("src/components/AddToBoardModal.tsx");
  assert(/session\.status === 'active' \|\| session\.status === 'pending'/.test(modal), "pending and active");
});

Deno.test("R31 a 1:1 collab is joined once past pending", () => {
  assert(!isDmCollabActive({ id: "s", name: "n", status: "pending", createdBy: null, createdAt: "", participants: [] }), "pending");
  assert(isDmCollabActive({ id: "s", name: "n", status: "active", createdBy: null, createdAt: "", participants: [] }), "active");
});

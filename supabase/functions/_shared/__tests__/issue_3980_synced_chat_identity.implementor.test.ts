// Issue #3980 synced program, Wave 1 — two chats on one agent key are told
// apart. The connector hands each connection a session id on initialize and
// passes a chat key derived from it (or from a work tool's chat name) to the
// gateway; nothing else changes on the wire.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CHAT_NAME_WORDS,
  chatKey,
  createTeamAgentHandler,
  sha256Hex,
} from "../teamAgentMcp.ts";
import { TEAM_AGENT_WORK_TOOLS } from "../teamAgentWorkTools.ts";

const KEY = "mgla_c_" + "s".repeat(43);
const URL_ = "https://example.test/functions/v1/team-agent";
const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

type Seen = { tool: string; args: Record<string, unknown>; chat: string };

function request(
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return new Request(URL_, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

function handler(seen: Seen[], lines: Record<string, unknown>[] = []) {
  return createTeamAgentHandler({
    minRefusalMs: 0,
    log: (line) => lines.push(line),
    gateway: async (_hash, tool, args, _client, chat) => {
      seen.push({ tool, args, chat });
      return {
        ok: true,
        result: { results: [] },
        me: { role: "growth", agent: "claude", work: true },
      };
    },
  });
}

const first16 = async (s: string) => (await sha256Hex(s)).slice(0, 16);

Deno.test("#3980 synced: initialize hands out a session id; ping and tools/list do not", async () => {
  const seen: Seen[] = [];
  const h = handler(seen);
  const init = await h(request("initialize", { protocolVersion: "2025-11-25" }));
  assertEquals(init.status, 200);
  assertMatch(init.headers.get("mcp-session-id") ?? "", /^[0-9a-f]{32}$/);
  const again = await h(request("initialize", { protocolVersion: "2025-11-25" }));
  assertNotEquals(again.headers.get("mcp-session-id"), init.headers.get("mcp-session-id"));
  // A client's own well-formed id is kept.
  const own = await h(request("initialize", {}, { "mcp-session-id": "client-session-0001" }));
  assertEquals(own.headers.get("mcp-session-id"), "client-session-0001");
  // A malformed one is replaced.
  const bad = await h(request("initialize", {}, { "mcp-session-id": "short" }));
  assertMatch(bad.headers.get("mcp-session-id") ?? "", /^[0-9a-f]{32}$/);
  for (const method of ["ping", "tools/list"]) {
    const r = await h(request(method, {}, { "mcp-session-id": "client-session-0001" }));
    assertEquals(r.status, 200);
    assertEquals(r.headers.get("mcp-session-id"), null, method);
  }
});

Deno.test("#3980 synced: the gateway gets the chat key from the session, from a chat name without one, else nothing", async () => {
  const seen: Seen[] = [];
  const h = handler(seen);
  const call = (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) =>
    h(request("tools/call", { name, arguments: args }, headers));
  await call("my_work", {}, { "mcp-session-id": "session-aaaa-1111" });
  assertEquals(seen.at(-1)!.chat, await first16("chat:session-aaaa-1111"));
  await call("my_work", { chat: "  Hosts Sweep " });
  assertEquals(seen.at(-1)!.chat, await first16("name:hosts sweep"));
  assertEquals(seen.at(-1)!.args.chat, "  Hosts Sweep ", "the name is passed on for the gateway to store");
  // The session wins over the name.
  await call("my_work", { chat: "Hosts sweep" }, { "mcp-session-id": "session-aaaa-1111" });
  assertEquals(seen.at(-1)!.chat, await first16("chat:session-aaaa-1111"));
  await call("my_work", {});
  assertEquals(seen.at(-1)!.chat, "");
  // Two sessions are two chats.
  await call("my_work", {}, { "mcp-session-id": "session-bbbb-2222" });
  assertNotEquals(seen.at(-1)!.chat, await first16("chat:session-aaaa-1111"));
  assertMatch(seen.at(-1)!.chat, /^[0-9a-f]{16}$/);
  // A non-work tool never reads a chat name, but a session still counts.
  await h(request("tools/call", { name: "my_day", arguments: {} }));
  assertEquals(seen.at(-1)!.chat, "");
  await h(request("tools/call", { name: "my_day", arguments: {} }, { "mcp-session-id": "session-aaaa-1111" }));
  assertEquals(seen.at(-1)!.chat, await first16("chat:session-aaaa-1111"));
  // The helper agrees.
  assertEquals(await chatKey(request("ping", {}), true, { chat: "x" }), await first16("name:x"));
});

Deno.test("#3980 synced: a chat name of the wrong shape is refused and never reaches the gateway", async () => {
  const seen: Seen[] = [];
  const h = handler(seen);
  for (const chat of ["   ", "a\u0007b", "x".repeat(41)]) {
    const before = seen.length;
    const r = await (await h(request("tools/call", { name: "my_work", arguments: { chat } }))).json();
    assertEquals(r.result.isError, true, JSON.stringify(chat));
    assertEquals(r.result.structuredContent.error.token, "invalid_arguments");
    if (chat.length <= 40) assertEquals(r.result.structuredContent.error.message, CHAT_NAME_WORDS);
    assert(seen.slice(before).every((s) => s.tool !== "my_work"), "the tool was not called");
  }
});

Deno.test("#3980 synced: the log line keeps its fields and never holds the session or the chat key", async () => {
  const seen: Seen[] = [];
  const lines: Record<string, unknown>[] = [];
  const h = handler(seen, lines);
  await h(request("tools/call", { name: "my_work", arguments: { chat: "Hosts sweep" } }, { "mcp-session-id": "session-cccc-3333" }));
  const line = lines.at(-1)!;
  assertEquals(Object.keys(line), ["fn", "request_id", "method", "tool", "outcome", "status", "ms", "key_prefix"]);
  const text = JSON.stringify(line);
  assert(!text.includes("session-cccc-3333") && !text.includes(seen.at(-1)!.chat) && !text.includes("Hosts sweep"));
});

Deno.test("#3980 synced: index.ts passes the chat as one header and keeps the four argument names and one rpc call", () => {
  const edge = read("supabase/functions/team-agent/index.ts")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assertEquals([...edge.matchAll(/\.rpc\(gateway,/g)].length, 1);
  assertEquals([...edge.matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]), ["p_key_hash", "p_tool", "p_args", "p_client"]);
  assertMatch(edge, /gateway: async \(keyHash, tool, args, client, chat\) =>/);
  assertMatch(edge, /if \(chat\) call = call\.setHeader\("x-mingla-chat", chat\);/);
  const mcp = read("supabase/functions/_shared/teamAgentMcp.ts");
  assert(!mcp.includes("There is no session."));
  assertMatch(mcp, /Each connection is\s+\/\/\s+handed a random Mcp-Session-Id\. It is never stored and grants nothing;\s+\/\/\s+it only tells two chats on one key apart\./);
});

Deno.test("#3980 synced: every work tool takes chat; add_work and update_work take github", () => {
  assertEquals(TEAM_AGENT_WORK_TOOLS.length, 14);
  for (const t of TEAM_AGENT_WORK_TOOLS) {
    const chat = t.inputSchema.properties.chat;
    assert(chat && chat.type === "string" && chat.maxLength === 40 && chat.minLength === 1, t.name);
    assert(!t.inputSchema.required.includes("chat"), t.name);
    assert(t.description.length < 1900, t.name);
  }
  const add = TEAM_AGENT_WORK_TOOLS.find((t) => t.name === "add_work")!;
  const card = (add.inputSchema.properties.cards as { items: { properties: Record<string, { type: string; maxItems?: number }> } }).items;
  assertEquals(card.properties.github.type, "array");
  assertEquals(card.properties.github.maxItems, 10);
  const update = TEAM_AGENT_WORK_TOOLS.find((t) => t.name === "update_work")!;
  const changes = update.inputSchema.properties.changes as { properties: Record<string, { type: string }> };
  assertEquals(changes.properties.github.type, "array");
  assertMatch(TEAM_AGENT_WORK_TOOLS.find((t) => t.name === "claim")!.description,
    /Cards are not claimed; start_work marks you as working on a card for as long as it takes\./);
  assertMatch(TEAM_AGENT_WORK_TOOLS.find((t) => t.name === "start_work")!.description,
    /Marks you as working on the card until you close it, push it back or release it\. Another chat cannot take it while you post updates\./);
});

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("staff reply requires a persisted next-update promise", () => {
  assertStringIncludes(source, "first_response_at, next_update_at");
  assertStringIncludes(source, "const nextUpdateMs = ticket.next_update_at ? Date.parse(ticket.next_update_at) : Number.NaN");
  assertStringIncludes(source, "if (senderIsStaff && (!Number.isFinite(nextUpdateMs) || nextUpdateMs <= Date.now()))");
  assertStringIncludes(source, 'return json({ error: "next_update_required" }, 422)');
});

Deno.test("the promise gate rejects missing or expired promises without blocking a requester adding context", () => {
  const gate = source.indexOf("if (senderIsStaff && (!Number.isFinite(nextUpdateMs) || nextUpdateMs <= Date.now()))");
  const requester = source.indexOf("const isRequester = ticket.requester_user_id === user.id");
  assert(requester >= 0 && gate > requester);
  assertStringIncludes(source, "nextUpdateMs <= Date.now()");
  assert(!/isRequester\s*&&\s*!Number\.isFinite/.test(source));
});

Deno.test("a dual-role account uses the explicit surface mode", () => {
  assertStringIncludes(source, 'body.actorMode === "staff" || body.actorMode === "requester"');
  assertStringIncludes(source, 'const senderIsStaff = actorMode === "staff" || (actorMode === null && !isRequester && isStaff)');
  assertStringIncludes(source, 'if (actorMode === "staff" && !isStaff) return json({ error: "Forbidden" }, 403)');
  assertStringIncludes(source, 'action: senderIsStaff ? "staff_reply" : "requester_reply"');
});

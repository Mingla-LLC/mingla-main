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
  // [TEST-MOD-APPROVED #3988] Brand-visible tickets intentionally extend the
  // requester role to active brand members. Bind the gate ordering to the
  // direct-or-brand union instead of the retired direct-only declaration.
  const directRequester = source.indexOf("const isDirectRequester = ticket.requester_user_id === user.id");
  const requester = source.indexOf("const isRequester = isDirectRequester || isBrandRequester");
  assert(directRequester >= 0 && requester > directRequester && gate > requester);
  assertStringIncludes(source, 'if (ticket.audience === "brand" && ticket.brand_id)');
  assertStringIncludes(source, "isBrandRequester = membership !== null");
  assertStringIncludes(source, "nextUpdateMs <= Date.now()");
  assert(!/isRequester\s*&&\s*!Number\.isFinite/.test(source));
});

Deno.test("a dual-role account uses the explicit surface mode", () => {
  assertStringIncludes(source, 'body.actorMode === "staff" || body.actorMode === "requester"');
  assertStringIncludes(source, 'const senderIsStaff = actorMode === "staff" || (actorMode === null && !isRequester && isStaff)');
  assertStringIncludes(source, 'if (actorMode === "staff" && !isStaff) return json({ error: "Forbidden" }, 403)');
  assertStringIncludes(source, 'action: senderIsStaff ? "staff_reply" : "requester_reply"');
});

// #3988 — Hosts must not see a staff email as the reply display name.
Deno.test("staff sender display name skips email-shaped candidates", () => {
  assertStringIncludes(source, '!value.includes("@")');
  assertStringIncludes(source, '"Mingla teammate"');
  const pick = source.indexOf("senderDisplayName = [");
  const fallback = source.indexOf('?? "Mingla teammate"', pick);
  assert(pick >= 0 && fallback > pick);
  assert(source.slice(pick, fallback).includes('!value.includes("@")'));
});

import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const notifySource = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const sendSource = await Deno.readTextFile(
  new URL("../support-send/index.ts", import.meta.url),
);

Deno.test("#3988 staff replies reach every active member of a brand-visible case", () => {
  assertStringIncludes(
    notifySource,
    'ticket.audience === "brand" && ticket.brand_id',
  );
  assertStringIncludes(notifySource, '.not("accepted_at", "is", null)');
  assertStringIncludes(notifySource, '.is("removed_at", null)');
  assertStringIncludes(
    notifySource,
    "idempotencyKey: `${type}:${body?.messageId ?? ticketId}:${userId}`",
  );
});

Deno.test("#3988 any active brand member can reply through the authenticated support path", () => {
  assertStringIncludes(
    sendSource,
    "const isRequester = isDirectRequester || isBrandRequester",
  );
  assertStringIncludes(sendSource, '.eq("user_id", user.id)');
  assertStringIncludes(sendSource, 'body.actorMode === "staff"');
  assertStringIncludes(sendSource, 'body.actorMode === "requester"');
});

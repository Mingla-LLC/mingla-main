import { handler } from "./index.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const dispatchSource = await Deno.readTextFile(new URL("../offering-invite-dispatch/index.ts", import.meta.url));
const exportSource = await Deno.readTextFile(new URL("../brand-people-export/index.ts", import.meta.url));

Deno.test("#873 action edge owns validation, preview persistence, and shared dispatch delegation", () => {
  for (const token of [
    '"biz_guest_roster_resolve_action"',
    '"biz_guest_roster_store_preview"',
    '"biz_guest_roster_get_preview"',
    '"biz_guest_roster_consume_preview"',
    "offeringDispatch(new Request",
    'status: "queued"',
    "262_144",
  ]) {
    if (!source.includes(token)) throw new Error(`missing action boundary: ${token}`);
  }
  for (const provider of ["api.resend.com", "api.twilio.com", "api.onesignal.com"]) {
    if (source.includes(provider)) throw new Error(`guest action edge called provider directly: ${provider}`);
  }
  if (!dispatchSource.includes('request.headers.get("x-mingla-internal-service-key") !== serviceKey')) {
    throw new Error("resolved person/attempt selection is not protected by service-only delegation proof");
  }
});

Deno.test("#873 audited export status returns only a short-lived authorized signed URL", () => {
  for (const token of [
    'input.operation === "status"',
    '"biz_get_brand_people_export_job"',
    '"biz_get_brand_people_export_storage"',
    'createSignedUrl(storagePath, 60)',
  ]) {
    if (!exportSource.includes(token)) throw new Error(`missing audited export status boundary: ${token}`);
  }
});

Deno.test("#873 action edge handles CORS, unsupported methods, and malformed input before auth", async () => {
  const options = await handler(new Request("https://edge.test/guest-roster-actions", { method: "OPTIONS" }));
  if (options.status !== 200) throw new Error("OPTIONS failed");
  const get = await handler(new Request("https://edge.test/guest-roster-actions", { method: "GET" }));
  if (get.status !== 405 || (await get.json()).code !== "method_not_allowed") throw new Error("GET was not rejected");
  const invalid = await handler(new Request("https://edge.test/guest-roster-actions", {
    method: "POST", body: JSON.stringify({ operation: "preview", eventId: "not-a-uuid" }),
  }));
  if (invalid.status !== 400 || (await invalid.json()).code !== "invalid_request") throw new Error("invalid request reached auth/provider work");
});

// META-ORCH-1221 — implementor HAPPY-PATH regression for careers-apply.
//
// Exercises the application validation/CV contract at the pure-logic layer (the
// same validateApplication + builders the handler ships), plus the handler's
// OPTIONS/405 wiring. This is the implementor half of the CLOSE Step 0.5
// regression pair: it PASSES on the fixed code and MUST FAIL on revert (e.g. if
// any of the six required-field checks, the CV mime/size gate, the WhatsApp/URL
// validators, or the role-binding 400 are removed). The tester adds the
// adversarial half (RLS deny, role_not_open DB path, signed-URL 403).
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/careers-apply/__tests__/apply_happy.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildApplicantEmail,
  buildNotifyEmail,
  decodeBase64,
  firstForwardedHop,
  handler,
  hashIp,
  isValidHttpUrl,
  isValidWhatsApp,
  sanitizeFilename,
  validateApplication,
} from "../index.ts";

// A 1-byte valid base64 ("AA==" → 0x00). Tiny PDF-mime payload for the happy case.
const TINY_CV_B64 = btoa("PDF");

const GOOD_INPUT = {
  job_slug: "multimedia-designer",
  full_name: "Ada Lovelace",
  email: "Ada@Example.com",
  whatsapp_phone: "+234 803 123 4567",
  preferred_salary: "₦200,000/month",
  portfolio_url: "https://ada.design",
  cv_base64: TINY_CV_B64,
  cv_filename: "ada cv (final).pdf",
  cv_mime: "application/pdf",
};

Deno.test("validateApplication — happy path normalises + accepts all six fields", () => {
  const r = validateApplication(GOOD_INPUT);
  assert(r.ok, "expected a valid application");
  if (!r.ok) return;
  assertEquals(r.application.email, "ada@example.com"); // trimmed + lowercased
  assertEquals(r.application.full_name, "Ada Lovelace");
  assertEquals(r.application.job_slug, "multimedia-designer");
  assertEquals(r.application.preferred_salary, "₦200,000/month");
  assertEquals(r.application.portfolio_url, "https://ada.design");
  assert(r.application.cv_bytes.length > 0, "CV decoded to bytes");
});

Deno.test("validateApplication — EACH of the six required fields, when missing, names itself", () => {
  const cases: Array<[Partial<typeof GOOD_INPUT>, string]> = [
    [{ full_name: "" }, "full_name"],
    [{ email: "not-an-email" }, "email"],
    [{ whatsapp_phone: "123" }, "whatsapp_phone"],
    [{ preferred_salary: "" }, "preferred_salary"],
    [{ portfolio_url: "ftp://nope" }, "portfolio_url"],
    [{ cv_mime: "image/png" }, "cv"],
  ];
  for (const [patch, field] of cases) {
    const r = validateApplication({ ...GOOD_INPUT, ...patch });
    assert(!r.ok, `expected ${field} to reject`);
    if (r.ok) continue;
    assert(r.fields.includes(field), `expected fields to include ${field}, got ${r.fields}`);
  }
});

Deno.test("validateApplication — ALL fields omitted → all six present in fields", () => {
  const r = validateApplication({});
  assert(!r.ok);
  if (r.ok) return;
  for (const f of ["job_slug", "full_name", "email", "whatsapp_phone", "preferred_salary", "portfolio_url", "cv"]) {
    assert(r.fields.includes(f), `missing ${f} in ${r.fields}`);
  }
});

Deno.test("validateApplication — CV over 5 MB rejects with 'cv'", () => {
  // 5 MB + 1 byte of base64-decoded content.
  const big = "A".repeat(5 * 1024 * 1024 + 16);
  const r = validateApplication({ ...GOOD_INPUT, cv_base64: btoa(big) });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.fields.includes("cv"), "oversize CV must reject");
});

Deno.test("isValidWhatsApp — accepts +countrycode + digits, rejects too-short/garbage", () => {
  assert(isValidWhatsApp("+2348031234567"));
  assert(isValidWhatsApp("2348031234567"));
  assert(isValidWhatsApp("+234 803 123 4567"));
  assert(!isValidWhatsApp("123"));
  assert(!isValidWhatsApp("abc"));
  assert(!isValidWhatsApp(""));
});

Deno.test("isValidHttpUrl — only http(s)", () => {
  assert(isValidHttpUrl("https://x.com"));
  assert(isValidHttpUrl("http://x.com/path"));
  assert(!isValidHttpUrl("ftp://x.com"));
  assert(!isValidHttpUrl("javascript:alert(1)"));
  assert(!isValidHttpUrl("notaurl"));
});

Deno.test("sanitizeFilename — strips unsafe chars, keeps extension, caps length, no path traversal", () => {
  assertEquals(sanitizeFilename("ada cv (final).pdf"), "ada-cv-final.pdf");
  // Path-traversal input must NOT yield a slash or '..' (storage safety).
  const traversal = sanitizeFilename("../../etc/passwd");
  assert(!traversal.includes("/"), "no slash survives");
  assert(!traversal.includes(".."), "no '..' survives");
  assert(sanitizeFilename("x".repeat(200) + ".docx").endsWith(".docx"));
});

Deno.test("decodeBase64 — tolerates a data: URL prefix, returns null on garbage", () => {
  assert(decodeBase64("data:application/pdf;base64," + TINY_CV_B64) !== null);
  assertEquals(decodeBase64("@@@not base64@@@")?.length ?? 0 > 0, false);
});

Deno.test("buildApplicantEmail — to the applicant, branded shell, role + first name", () => {
  const email = buildApplicantEmail(
    "Ada Lovelace",
    "Multimedia Designer",
    "ada@example.com",
    "Mingla <notifications@usemingla.com>",
  );
  assertEquals(email.to, ["ada@example.com"]);
  assertEquals(email.from, "Mingla <notifications@usemingla.com>");
  assert(email.html.includes('alt="Mingla"'), "must flow through renderShell");
  assert(email.html.includes("Multimedia Designer"));
  assert(email.html.includes("Hi Ada"), "greets by first name");
});

Deno.test("buildNotifyEmail — to seth, lists all captured fields, escapes input", () => {
  const email = buildNotifyEmail(
    {
      full_name: "<b>Ada</b>",
      email: "ada@example.com",
      whatsapp_phone: "+2348031234567",
      preferred_salary: "₦200,000",
      portfolio_url: "https://ada.design",
    },
    "Multimedia Designer",
    "Mingla <notifications@usemingla.com>",
    "2026-06-22T10:00:00.000Z",
  );
  assertEquals(email.to, ["seth@usemingla.com"]);
  assert(email.subject.includes("Multimedia Designer"));
  assert(email.text.includes("ada@example.com"));
  assert(email.text.includes("+2348031234567"));
  assert(!email.html.includes("<b>Ada</b>"), "raw HTML must be escaped");
  assert(email.html.includes("&lt;b&gt;Ada&lt;/b&gt;"));
});

Deno.test("firstForwardedHop + hashIp — first hop, salted, never raw IP", async () => {
  assertEquals(firstForwardedHop("1.2.3.4, 5.6.7.8"), "1.2.3.4");
  const h1 = await hashIp("1.2.3.4", "salt-a");
  const h2 = await hashIp("1.2.3.4", "salt-b");
  assert(h1 !== null && !h1.includes("1.2.3.4"));
  assert(h1 !== h2, "different salt → different hash");
});

Deno.test("handler — OPTIONS returns CORS preflight 200", async () => {
  const res = await handler(
    new Request("https://x/careers-apply", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handler — non-POST returns 405 method_not_allowed", async () => {
  const res = await handler(
    new Request("https://x/careers-apply", { method: "GET" }),
  );
  assertEquals(res.status, 405);
  assertEquals(await res.json(), { ok: false, error: "method_not_allowed" });
});

Deno.test("handler — invalid payload → 400 validation (never reaches DB)", async () => {
  const res = await handler(
    new Request("https://x/careers-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: "" }),
    }),
  );
  assertEquals(res.status, 400);
  const b = await res.json();
  assertEquals(b.ok, false);
  assertEquals(b.error, "validation");
});

Deno.test("handler — fully-valid payload passes validation (clears the 400 gate)", async () => {
  // With no Supabase env the role-lookup/insert path errors → 500, but crucially
  // NOT 400 (validation passed) and NOT 405 — proving the six-field + CV gate is
  // cleared by a good payload.
  const res = await handler(
    new Request("https://x/careers-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(GOOD_INPUT),
    }),
  );
  assert(res.status !== 400, `expected validation to pass, got ${res.status}`);
  assert(res.status !== 405);
});

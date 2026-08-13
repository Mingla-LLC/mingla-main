import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  CONTACT_IMPORT_ATTESTATION_TEMPLATE,
  renderContactImportAttestation,
  suggestContactImportMapping,
} from "./importContract.ts";
import { handler, parseCsvBytes, sha256Hex } from "./index.ts";

Deno.test("#1775 happy: browser preflight allows import authority headers", async () => {
  const response = await handler(
    new Request("http://localhost", { method: "OPTIONS" }),
  );
  const allowed = response.headers.get("access-control-allow-headers") ?? "";
  assert(allowed.includes("x-mingla-import-action"));
  assert(allowed.includes("x-mingla-brand-id"));
});

Deno.test("#1775 happy: exact legal bytes and both substitutions", () => {
  const brand = "Smoke & Rhythm";
  const rendered = renderContactImportAttestation(brand);
  assertEquals((rendered.match(/Smoke & Rhythm/g) ?? []).length, 2);
  assert(!rendered.includes("{brandName}"));
  assert(CONTACT_IMPORT_ATTESTATION_TEMPLATE.includes("— it wasn’t"));
});

Deno.test("#1775 happy: Eventbrite/Mailchimp/manual mapping fixtures", () => {
  assertEquals(
    suggestContactImportMapping([
      "Attendee name",
      "Email",
      "Cell phone",
      "Ticket type",
      "Row",
      "Seat",
    ]),
    {
      "Attendee name": "full_name",
      "Email": "email",
      "Cell phone": "phone",
      "Ticket type": "ignore",
      "Row": "ignore",
      "Seat": "ignore",
    },
  );
  assertEquals(
    suggestContactImportMapping([
      "Email Address",
      "First Name",
      "Last Name",
      "Phone Number",
    ]),
    {
      "Email Address": "email",
      "First Name": "first_name",
      "Last Name": "last_name",
      "Phone Number": "phone",
    },
  );
  assertEquals(suggestContactImportMapping(["Mystery"]), { Mystery: "ignore" });
});

Deno.test("#1775 happy: parser binds digest, dialect, quotes and 10k boundary", async () => {
  const source =
    'Attendee name,Email,Cell phone\r\n"Ada, A",ada@example.com,+14155552671\r\n';
  const parsed = parseCsvBytes(
    new TextEncoder().encode(source),
    "eventbrite.csv",
  );
  assertEquals(parsed.dialect, "comma");
  assertEquals(parsed.rows[0][0], "Ada, A");
  assertEquals((await sha256Hex(source)).length, 64);
  const valid = `Name,Email\n${
    Array.from({ length: 10_000 }, (_, i) => `P${i},p${i}@example.com`).join(
      "\n",
    )
  }`;
  assertEquals(
    parseCsvBytes(new TextEncoder().encode(valid), "ten.csv").rows.length,
    10_000,
  );
  const tooMany = `${valid}\nP10000,p10000@example.com`;
  const error = await assertRejects(async () =>
    parseCsvBytes(new TextEncoder().encode(tooMany), "too-many.csv")
  );
  assertEquals((error as { code?: string }).code, "ROW_LIMIT_EXCEEDED");
});

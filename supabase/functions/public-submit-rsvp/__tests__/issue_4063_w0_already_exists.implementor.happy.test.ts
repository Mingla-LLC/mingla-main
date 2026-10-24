import { assert } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("P4063 and the stable message map to the same minimal 409 response", () => {
  const switchAt = source.indexOf("switch (error.code)");
  const legacyAt = source.indexOf('const code = error.message ?? ""', switchAt);
  assert(switchAt >= 0 && legacyAt > switchAt, "error mapping order changed");

  const structured = source.slice(switchAt, legacyAt);
  for (
    const token of [
      'case "P4063":',
      'reason: "rsvp_already_exists"',
      "authenticated: false",
      'return json(409, { error: "rsvp_already_exists" })',
    ]
  ) {
    assert(structured.includes(token), `missing structured mapping: ${token}`);
  }

  const fallbackAt = source.indexOf(
    'if (code.includes("rsvp_already_exists"))',
    legacyAt,
  );
  assert(fallbackAt > legacyAt, "stable-message fallback is missing");
  const fallback = source.slice(
    fallbackAt,
    source.indexOf("\n    }", fallbackAt) + 6,
  );
  assert(
    fallback.includes('return json(409, { error: "rsvp_already_exists" })'),
    "fallback response changed",
  );

  for (const mapping of [structured, fallback]) {
    for (
      const forbidden of [
        "guestName",
        "guestEmail",
        "guestPhone",
        "normalizedGuests",
        "confirmationToken",
        "credentials",
        "anonymousRecovery",
      ]
    ) {
      assert(!mapping.includes(forbidden), `mapping leaks ${forbidden}`);
    }
  }
});

Deno.test("#4063 anonymous success returns only a claim pointer, never pass credentials", () => {
  const responseAt = source.indexOf("return json(200, {");
  assert(responseAt >= 0, "success response is missing");
  const response = source.slice(
    responseAt,
    source.indexOf("\n  });", responseAt),
  );
  for (
    const required of [
      "confirmationToken: userId !== null && passEligible",
      "credentials: userId !== null && passEligible",
      "anonymousRecovery: []",
      "shortUrl: claim?.url ?? null",
      "code: claim?.code ?? null",
    ]
  ) {
    assert(
      response.includes(required),
      `missing anonymous boundary: ${required}`,
    );
  }
  assert(
    source.includes('mintClaimLink(admin, "rsvp", result.rsvpId)'),
    "successful admitted RSVP does not mint its claim pointer",
  );
});

// Issue #1447 tester-owned adversarial guard.
// Angle: one authorization barrier must protect both metadata and PDF
// representations, and anonymous recovery secrets must remain fragment-only.

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const read = (relative: string): Promise<string> =>
  Deno.readTextFile(new URL(relative, import.meta.url));

const passEdge = await read("../index.ts");
const recoveryPrimitives = await read("../../_shared/rsvpPass.ts");
const recoveryRoute = await read(
  "../../../../mingla-business/app/rsvp/pass.tsx",
);
const publicClient = await read(
  "../../../../mingla-business/src/services/rsvpEvents.ts",
);
const explorerClient = await read(
  "../../../../app-mobile/src/services/rsvpDeckService.ts",
);

function representationBoundaryIsSafe(source: string): boolean {
  const deny = source.indexOf(
    "if (!authenticatedEntityOwner && !authenticatedPartyOwner && !recoveryAuthorized)",
  );
  const metadata = source.indexOf("if (wantsMetadata)");
  const pdf = source.indexOf("const pdf = await buildRsvpPassPdf");
  return deny >= 0 && metadata > deny && pdf > metadata;
}

Deno.test("one owner-or-recovery barrier protects metadata and PDF", () => {
  assert(
    representationBoundaryIsSafe(passEdge),
    "metadata/PDF must not render before the shared owner-or-recovery denial",
  );
  assert(
    passEdge.includes("constantTimeHexEqual(") &&
      passEdge.includes("await sha256Hex(recoveryToken)"),
    "anonymous recovery must compare only a hash in constant time",
  );
  assert(
    passEdge.includes('"Cache-Control": "no-store"') &&
      passEdge.includes('"Referrer-Policy": "no-referrer"'),
    "authorized pass responses must not be cached or leaked by referrer",
  );
});

Deno.test("clients explicitly negotiate metadata versus PDF", () => {
  assert(
    passEdge.includes('includes(\n    "application/json",\n  )') &&
      passEdge.includes('"Content-Type": "application/pdf"'),
    "the endpoint must reserve JSON for an explicit Accept and default to PDF",
  );
  assert(
    publicClient.includes('headers: { Accept: "application/json" }') &&
      publicClient.includes('headers: { Accept: "application/pdf" }'),
    "anonymous recovery clients must request each representation explicitly",
  );
  assert(
    explorerClient.includes('Accept: "application/pdf"') &&
      explorerClient.includes('startsWith("application/pdf")'),
    "Explorer must request and verify PDF bytes",
  );
});

Deno.test("anonymous recovery proof stays out of request URLs and analytics", () => {
  assert(
    recoveryPrimitives.includes(
      "return `https://business.usemingla.com/rsvp/pass#${fragment}`;",
    ),
    "recovery proof must be placed after the URL fragment marker",
  );
  assert(
    recoveryRoute.includes("window.location.hash") &&
      !recoveryRoute.includes("window.location.search"),
    "the recovery route must read the fragment, never the query string",
  );
  for (const forbidden of ["recoveryToken:", "qrCode:", "email:", "phone:"]) {
    assert(
      !recoveryRoute.includes(`captureWeb(\"rsvp_pass_viewed\", { ${forbidden}`),
      `analytics must not include ${forbidden}`,
    );
  }
});

Deno.test("true-source authorization reversion is rejected", () => {
  const reverted = passEdge.replace(
    "if (!authenticatedEntityOwner && !authenticatedPartyOwner && !recoveryAuthorized)",
    "if (false)",
  );
  assert(
    !representationBoundaryIsSafe(reverted),
    "removing the shared authorization barrier must turn this guard red",
  );
});

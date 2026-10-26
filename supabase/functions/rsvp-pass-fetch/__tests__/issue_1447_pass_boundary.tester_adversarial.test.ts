// Issue #1447 tester-owned adversarial guard.
// [TEST-MOD-APPROVED ORCH-1447] Bind to the split recovery client module.
// Angle: one signed-in ownership barrier must protect both metadata and PDF
// representations. #4063 retires recovery tokens as bearer pass credentials.

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
  "../../../../mingla-business/src/services/rsvpPassRecoveryService.ts",
);
const explorerClient = await read(
  "../../../../app-mobile/src/services/rsvpDeckService.ts",
);

function representationBoundaryIsSafe(source: string): boolean {
  const deny = source.indexOf(
    "if (!authenticatedEntityOwner && !authenticatedPartyOwner)",
  );
  const metadata = source.indexOf("if (wantsMetadata)");
  const pdf = source.indexOf("const pdf = await buildRsvpPassPdf");
  return deny >= 0 && metadata > deny && pdf > metadata;
}

Deno.test("one signed-in owner barrier protects metadata and PDF", () => {
  assert(
    representationBoundaryIsSafe(passEdge),
    "metadata/PDF must not render before the shared signed-in owner denial",
  );
  assert(
    passEdge.includes('return reply(403, { error: "sign_in_required" })') &&
      !passEdge.includes("constantTimeHexEqual(") &&
      !passEdge.includes("sha256Hex(recoveryToken)"),
    "anonymous recovery must not authorize metadata or PDF bytes",
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

Deno.test("legacy anonymous recovery pages scrub proofs and reveal nothing", () => {
  assert(
    recoveryPrimitives.includes(
      "return `https://host.usemingla.com/rsvp/pass#${fragment}`;",
    ),
    "recovery proof must be placed after the URL fragment marker",
  );
  assert(
    recoveryRoute.includes("StaticBuyerClaimPage") &&
      recoveryRoute.includes("scrubFragment") &&
      !recoveryRoute.includes("fetchPublicRsvpPass") &&
      !recoveryRoute.includes("react-native-qrcode-svg"),
    "the legacy route must render a static claim page without reading pass data",
  );
  for (const forbidden of ["recoveryToken:", "qrCode:", "email:", "phone:"]) {
    assert(
      !recoveryRoute.includes(
        `captureWeb(\"rsvp_pass_viewed\", { ${forbidden}`,
      ),
      `analytics must not include ${forbidden}`,
    );
  }
});

Deno.test("true-source authorization reversion is rejected", () => {
  const reverted = passEdge.replace(
    "if (!authenticatedEntityOwner && !authenticatedPartyOwner)",
    "if (false)",
  );
  assert(
    !representationBoundaryIsSafe(reverted),
    "removing the shared authorization barrier must turn this guard red",
  );
});

const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270614002987_issue_2979_attendance_claim_secret_continuity.sql",
    import.meta.url,
  ),
);
const handler = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function functionBody(signature: string, nextSignature: string): string {
  const start = migration.indexOf(signature);
  const end = migration.indexOf(nextSignature, start + signature.length);
  assert(start >= 0 && end > start, `missing function boundary: ${signature}`);
  return migration.slice(start, end);
}

Deno.test("#2979 tester: proof verification stays one locked, non-enumerating decision", () => {
  assert(
    (handler.match(/claim_attendance_internal_v2/g) ?? []).length === 1,
    "the handler must make exactly one dual-proof database decision",
  );
  assert(
    handler.includes("p_current_proof_digest"),
    "current candidate missing",
  );
  assert(handler.includes("p_legacy_proof_digest"), "legacy candidate missing");
  assert(
    handler.includes('error: "claim_temporarily_unavailable"'),
    "missing legacy authority must fail closed",
  );
  assert(
    !handler.includes("console."),
    "claim handler must not log bearer material",
  );
  const successStart = handler.lastIndexOf("return claimJson(200");
  const successEnd = handler.indexOf(");", successStart);
  assert(
    successStart >= 0 && successEnd > successStart,
    "success response missing",
  );
  assert(
    !handler.slice(successStart, successEnd).includes("generation"),
    "claim response exposes the matched generation",
  );
});

Deno.test("#2979 tester: token and identity claims reconcile outstanding recovery work", () => {
  const tokenClaim = functionBody(
    "CREATE OR REPLACE FUNCTION public.claim_attendance_internal_v2(",
    "CREATE OR REPLACE FUNCTION public.claim_attendance_internal(",
  );
  const identityClaim = functionBody(
    "CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity(",
    "CREATE OR REPLACE FUNCTION public.preview_issue_2979_attendance_claim_recovery(",
  );

  for (
    const [name, body] of [
      ["token claim", tokenClaim],
      ["identity claim", identityClaim],
    ] as const
  ) {
    assert(
      body.includes("state = 'claimed'"),
      `${name} does not resolve the recovery item`,
    );
    assert(
      body.includes("attendance_claim_deliveries"),
      `${name} leaves pending or leased recovery delivery work after ownership succeeds`,
    );
    assert(
      body.includes("claim_resolved"),
      `${name} does not give canceled recovery deliveries a value-blind terminal reason`,
    );
  }
});

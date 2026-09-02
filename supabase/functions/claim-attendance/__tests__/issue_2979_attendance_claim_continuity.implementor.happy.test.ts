const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2979 order claims derive two candidates and use one locked RPC", () => {
  assert(source.includes("resolveAttendanceClaimPepperRing()"), "ring reader");
  assert(source.includes("pepperRing.current.secret"), "current candidate");
  assert(source.includes("pepperRing.previous.secret"), "legacy candidate");
  assert(
    source.includes('admin.rpc("claim_attendance_internal_v2"'),
    "v2 claim RPC",
  );
  assert(
    (source.match(/claim_attendance_internal_v2/g) ?? []).length === 1,
    "one claim decision call",
  );
  assert(source.includes("p_current_proof_digest"), "current digest argument");
  assert(source.includes("p_legacy_proof_digest"), "legacy digest argument");
  assert(
    source.includes("legacyProof = proof"),
    "legacy-only mode supplies its sole verifier",
  );
  assert(
    source.includes("claim_temporarily_unavailable"),
    "missing previous reader fails closed while legacy remains",
  );
});

Deno.test("#2979 A13 both attendance functions authenticate the exact caller bearer before privileged work", async () => {
  const identitySource = await Deno.readTextFile(
    new URL(
      "../../attendance-claim-identity/index.ts",
      import.meta.url,
    ),
  );
  const strictBearer = /^Bearer ([^\s]+)$/i;
  const malformed = [
    "",
    "Bearer",
    "Bearer ",
    "Basic caller-token",
    "Bearer  caller-token",
    "Bearer\tcaller-token",
    "Bearer caller-token ",
    "Bearer caller-token extra",
  ];

  for (const value of malformed) {
    assert(
      strictBearer.exec(value) === null,
      `malformed Authorization unexpectedly matched: ${JSON.stringify(value)}`,
    );
  }
  assert(
    strictBearer.exec("Bearer caller-token")?.[1] === "caller-token",
    "canonical Bearer token was not extracted",
  );
  assert(
    strictBearer.exec("bearer caller-token")?.[1] === "caller-token",
    "HTTP auth scheme matching must remain case-insensitive",
  );

  for (
    const [name, handler] of [
      ["claim-attendance", source],
      ["attendance-claim-identity", identitySource],
    ] as const
  ) {
    assert(
      handler.includes("const STRICT_BEARER_TOKEN = /^Bearer ([^\\s]+)$/i;"),
      `${name} lost strict non-empty Bearer extraction`,
    );
    assert(
      handler.includes(
        "authorization?.match(STRICT_BEARER_TOKEN)?.[1] ?? null",
      ),
      `${name} no longer returns only the extracted token`,
    );

    const extractIndex = handler.indexOf(
      'const callerToken = extractBearerToken(req.headers.get("authorization"))',
    );
    const malformedGuardIndex = handler.indexOf(
      "if (!callerToken)",
      extractIndex,
    );
    const configIndex = handler.indexOf('Deno.env.get("SUPABASE_URL")');
    const explicitAuthIndex = handler.indexOf(
      "viewer.auth.getUser(\n    callerToken,\n  )",
    );
    const invalidGuardIndex = handler.indexOf(
      "if (authError)",
      explicitAuthIndex,
    );
    const missingUserGuardIndex = handler.indexOf(
      "if (!authData.user)",
      invalidGuardIndex,
    );
    const adminIndex = handler.indexOf(
      "const admin = createClient(url, service",
    );
    const admissionIndex = handler.indexOf('"begin_attendance_claim_attempt"');

    assert(
      extractIndex >= 0 &&
        malformedGuardIndex > extractIndex &&
        configIndex > malformedGuardIndex,
      `${name} does not reject malformed Authorization before configuration/secret work`,
    );
    assert(
      explicitAuthIndex > configIndex &&
        invalidGuardIndex > explicitAuthIndex &&
        missingUserGuardIndex > invalidGuardIndex &&
        adminIndex > missingUserGuardIndex &&
        admissionIndex > adminIndex,
      `${name} can reach service-role or claim work before explicit caller validation`,
    );
    assert(
      handler.slice(malformedGuardIndex, configIndex).includes(
        '401, { ok: false, error: "authentication_required" }',
      ),
      `${name} malformed bearer does not use the generic 401 contract`,
    );
    assert(
      handler.slice(invalidGuardIndex, adminIndex).includes(
        '401, { ok: false, error: "authentication_required" }',
      ),
      `${name} invalid bearer does not use the generic 401 contract`,
    );
    assert(
      !handler.includes("auth.getUser()"),
      `${name} regressed to implicit no-argument getUser()`,
    );
    assert(
      !handler.includes("global: { headers:"),
      `${name} still relies on a global Authorization default as auth state`,
    );
    assert(
      !handler.includes("console."),
      `${name} must not log bearer material`,
    );
  }
});

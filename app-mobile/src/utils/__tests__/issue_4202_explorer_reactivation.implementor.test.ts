/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  captureExplorerReactivationIntentForAuthEvent,
  resolveExplorerProfileAfterAuthEvent,
  withExplorerReactivationIntent,
} from "../explorerReactivation.ts";
import { buildExplorerProfileAuthRestRequest } from "../explorerProfileAuthRest.ts";

const deletedProfile: {
  id: string;
  explorer_deleted_at: string | null;
  has_completed_onboarding: boolean;
} = {
  id: "00000000-0000-4000-8000-000000004202",
  explorer_deleted_at: "2026-10-31T21:37:28Z",
  has_completed_onboarding: false,
};

Deno.test("#4202 explicit sign-in reactivates a deleted Explorer side for fresh onboarding", async () => {
  let calls = 0;
  const result = await resolveExplorerProfileAfterAuthEvent(
    true,
    deletedProfile,
    () => {
      calls += 1;
      return Promise.resolve({
        data: {
          ...deletedProfile,
          explorer_deleted_at: null,
          has_completed_onboarding: false,
        },
        error: null,
      });
    },
  );

  assertEquals(calls, 1);
  assertEquals(result.kind, "reactivated");
  assert(result.kind === "reactivated");
  assertEquals(result.profile.explorer_deleted_at, null);
  assertEquals(result.profile.has_completed_onboarding, false);
});

for (const event of ["INITIAL_SESSION", "TOKEN_REFRESHED", "USER_UPDATED"]) {
  Deno.test(`#4202 ${event} cannot silently revive a deleted Explorer side`, async () => {
    let calls = 0;
    const result = await resolveExplorerProfileAfterAuthEvent(
      false,
      deletedProfile,
      () => {
        calls += 1;
        return Promise.resolve({ data: deletedProfile, error: null });
      },
    );

    assertEquals(calls, 0);
    assertEquals(result, { kind: "deleted_session" });
  });
}

Deno.test("#4202 reactivation fails closed when the profile marker survives", async () => {
  const result = await resolveExplorerProfileAfterAuthEvent(
    true,
    deletedProfile,
    () => Promise.resolve({ data: deletedProfile, error: null }),
  );
  assertEquals(result.kind, "reactivation_failed");
});

Deno.test("#4202 an active Explorer profile is never rewritten", async () => {
  let calls = 0;
  const profile = { ...deletedProfile, explorer_deleted_at: null };
  const result = await resolveExplorerProfileAfterAuthEvent(
    true,
    profile,
    () => {
      calls += 1;
      return Promise.resolve({ data: profile, error: null });
    },
  );

  assertEquals(calls, 0);
  assertEquals(result, { kind: "active", profile });
});

Deno.test("#4202 SIGNED_IN needs a live user-initiated auth bracket", async () => {
  assertEquals(captureExplorerReactivationIntentForAuthEvent("SIGNED_IN"), false);

  await withExplorerReactivationIntent(async () => {
    assertEquals(captureExplorerReactivationIntentForAuthEvent("INITIAL_SESSION"), false);
    assertEquals(captureExplorerReactivationIntentForAuthEvent("TOKEN_REFRESHED"), false);
    assertEquals(captureExplorerReactivationIntentForAuthEvent("SIGNED_IN"), true);
  });

  assertEquals(captureExplorerReactivationIntentForAuthEvent("SIGNED_IN"), false);
});

Deno.test("#4202 a failed auth attempt cannot leave reactivation intent armed", async () => {
  try {
    await withExplorerReactivationIntent(() => Promise.reject(new Error("no session")));
  } catch {
    // Expected: the assertion is that finally disarms the bracket.
  }
  assertEquals(captureExplorerReactivationIntentForAuthEvent("SIGNED_IN"), false);
});

Deno.test("#4202 post-auth profile reads use the captured bearer, never the anon key", () => {
  const request = buildExplorerProfileAuthRestRequest({
    supabaseUrl: "https://project.supabase.co/",
    anonKey: "anon-key",
    accessToken: "verified-user-token",
    userId: deletedProfile.id,
    reactivate: false,
  });

  assertEquals(request.init.method, "GET");
  assertEquals(request.init.body, undefined);
  assertEquals(
    (request.init.headers as Record<string, string>).Authorization,
    "Bearer verified-user-token",
  );
  assertEquals((request.init.headers as Record<string, string>).apikey, "anon-key");
  assert(request.url.startsWith("https://project.supabase.co/rest/v1/profiles?"));
  assert(request.url.includes(`id=eq.${deletedProfile.id}`));
});

Deno.test("#4202 reactivation PATCH changes only the Explorer marker and onboarding", () => {
  const request = buildExplorerProfileAuthRestRequest({
    supabaseUrl: "https://project.supabase.co",
    anonKey: "anon-key",
    accessToken: "verified-user-token",
    userId: deletedProfile.id,
    reactivate: true,
  });

  assertEquals(request.init.method, "PATCH");
  assertEquals(
    JSON.parse(String(request.init.body)),
    { explorer_deleted_at: null, has_completed_onboarding: false },
  );
  assertEquals(
    (request.init.headers as Record<string, string>).Prefer,
    "return=representation",
  );
  assertEquals(
    (request.init.headers as Record<string, string>).Authorization,
    "Bearer verified-user-token",
  );
});

Deno.test("#4202 the auth callback clears only the Explorer marker and restarts onboarding", async () => {
  const hookSource = await Deno.readTextFile(
    new URL("../../hooks/useAuthSimple.ts", import.meta.url),
  );
  const appStateSource = await Deno.readTextFile(
    new URL("../../components/AppStateManager.tsx", import.meta.url),
  );
  const emailSource = await Deno.readTextFile(
    new URL("../../services/emailOtpService.ts", import.meta.url),
  );
  const claimSource = await Deno.readTextFile(
    new URL("../../services/attendanceClaimService.ts", import.meta.url),
  );
  const supabaseSource = await Deno.readTextFile(
    new URL("../../services/supabase.ts", import.meta.url),
  );
  const authRestSource = await Deno.readTextFile(
    new URL("../explorerProfileAuthRest.ts", import.meta.url),
  );
  assert(hookSource.includes("captureExplorerReactivationIntentForAuthEvent(event)"));
  assert(hookSource.includes("resolveExplorerProfileAfterAuthEvent"));
  assert(authRestSource.includes("explorer_deleted_at: null"));
  assert(authRestSource.includes("has_completed_onboarding: false"));
  assert(hookSource.includes("requestOwnExplorerProfileForAuthEvent<ExplorerAuthProfile>"));
  assert(hookSource.includes("accessToken: session.access_token"));
  assert(supabaseSource.includes("buildExplorerProfileAuthRestRequest"));
  assert(supabaseSource.includes("fetchWithTimeout(request.url"));
  assert(hookSource.includes('resolution.kind === "deleted_session"'));
  assert(hookSource.includes('resolution.kind === "reactivation_failed"'));
  assert(appStateSource.includes("withExplorerReactivationIntent(signInWithGoogle)"));
  assert(appStateSource.includes("withExplorerReactivationIntent(signInWithApple)"));
  assert(emailSource.includes("withExplorerReactivationIntent(() =>"));
  assert(claimSource.includes("withExplorerReactivationIntent(() =>"));
});

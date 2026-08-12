import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  evaluateMetaIdentityAuthority,
  type ExactMetaIdentity,
  type MetaIdentityAuthorityDependencies,
} from "../metaIdentityAuthority.ts";

const REGISTERED_BUSINESS_IDENTITY: ExactMetaIdentity = {
  pageId: "1223994124127087",
  instagramUserId: "17841422359567322",
};

function unavailableDiagnosticDependencies(probe: {
  ok: boolean;
  createdObject: boolean;
}) {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const dependencies: MetaIdentityAuthorityDependencies = {
    checkPageAuthorization: (pageId) => {
      calls.push({ operation: "page", value: pageId });
      return Promise.resolve({ ok: true });
    },
    fetchPageLinkedInstagram: (pageId) => {
      calls.push({ operation: "diagnostic", value: pageId });
      return Promise.reject(new Error("diagnostic lookup unavailable"));
    },
    validateExactIdentity: (identity) => {
      calls.push({ operation: "probe", value: identity });
      return Promise.resolve(probe);
    },
  };
  return { calls, dependencies };
}

Deno.test("#1942 tester guard: a failed diagnostic lookup cannot block exact no-object validation", async () => {
  const { calls, dependencies } = unavailableDiagnosticDependencies({
    ok: true,
    createdObject: false,
  });

  assertEquals(
    await evaluateMetaIdentityAuthority(
      REGISTERED_BUSINESS_IDENTITY,
      dependencies,
    ),
    { verdict: "ready", reason: null, pageLinkDiagnostic: "unavailable" },
  );
  assertEquals(calls, [
    { operation: "page", value: REGISTERED_BUSINESS_IDENTITY.pageId },
    { operation: "diagnostic", value: REGISTERED_BUSINESS_IDENTITY.pageId },
    { operation: "probe", value: REGISTERED_BUSINESS_IDENTITY },
  ]);
});

Deno.test("#1942 tester guard: diagnostic failure never masks a returned provider object", async () => {
  const { dependencies } = unavailableDiagnosticDependencies({
    ok: true,
    createdObject: true,
  });

  assertEquals(
    await evaluateMetaIdentityAuthority(
      REGISTERED_BUSINESS_IDENTITY,
      dependencies,
    ),
    {
      verdict: "blocked",
      reason: "meta_validate_only_failed",
      pageLinkDiagnostic: "unavailable",
    },
  );
});

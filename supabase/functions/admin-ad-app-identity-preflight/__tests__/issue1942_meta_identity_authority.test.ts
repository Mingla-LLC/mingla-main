import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  evaluateMetaIdentityAuthority,
  type ExactMetaIdentity,
  type MetaIdentityAuthorityDependencies,
} from "../metaIdentityAuthority.ts";

const BUSINESS_IDENTITY: ExactMetaIdentity = {
  pageId: "1223994124127087",
  instagramUserId: "17841422359567322",
};

function dependencies(input: {
  pageAuthorized?: boolean;
  linkedInstagramId?: string | null;
  probeOk?: boolean;
  createdObject?: boolean;
}) {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const deps: MetaIdentityAuthorityDependencies = {
    checkPageAuthorization: (pageId) => {
      calls.push({ operation: "page", value: pageId });
      return Promise.resolve({ ok: input.pageAuthorized ?? true });
    },
    fetchPageLinkedInstagram: (pageId) => {
      calls.push({ operation: "diagnostic", value: pageId });
      return Promise.resolve(input.linkedInstagramId ?? null);
    },
    validateExactIdentity: (identity) => {
      calls.push({ operation: "probe", value: identity });
      return Promise.resolve({
        ok: input.probeOk ?? true,
        createdObject: input.createdObject ?? false,
      });
    },
  };
  return { calls, deps };
}

Deno.test("#1942 null Page link plus exact no-object validate-only success is ready", async () => {
  const { calls, deps } = dependencies({ linkedInstagramId: null });
  assertEquals(
    await evaluateMetaIdentityAuthority(BUSINESS_IDENTITY, deps),
    { verdict: "ready", reason: null, pageLinkDiagnostic: "absent" },
  );
  assertEquals(calls, [
    { operation: "page", value: BUSINESS_IDENTITY.pageId },
    { operation: "diagnostic", value: BUSINESS_IDENTITY.pageId },
    { operation: "probe", value: BUSINESS_IDENTITY },
  ]);
});

Deno.test("#1942 mismatched Page link cannot replace exact registered IDs when validate-only succeeds", async () => {
  const { calls, deps } = dependencies({
    linkedInstagramId: "17841477287060530",
  });
  assertEquals(
    await evaluateMetaIdentityAuthority(BUSINESS_IDENTITY, deps),
    { verdict: "ready", reason: null, pageLinkDiagnostic: "mismatch" },
  );
  assertEquals(calls.at(-1), {
    operation: "probe",
    value: BUSINESS_IDENTITY,
  });
});

Deno.test("#1942 validate-only provider rejection blocks the exact identity", async () => {
  const { deps } = dependencies({ probeOk: false });
  assertEquals(
    await evaluateMetaIdentityAuthority(BUSINESS_IDENTITY, deps),
    {
      verdict: "blocked",
      reason: "meta_validate_only_failed",
      pageLinkDiagnostic: "absent",
    },
  );
});

Deno.test("#1942 validate-only returning an object ID blocks preflight", async () => {
  const { deps } = dependencies({ createdObject: true });
  assertEquals(
    await evaluateMetaIdentityAuthority(BUSINESS_IDENTITY, deps),
    {
      verdict: "blocked",
      reason: "meta_validate_only_failed",
      pageLinkDiagnostic: "absent",
    },
  );
});

Deno.test("#1942 unauthorized Page blocks before diagnostics or validate-only", async () => {
  const { calls, deps } = dependencies({ pageAuthorized: false });
  assertEquals(
    await evaluateMetaIdentityAuthority(BUSINESS_IDENTITY, deps),
    {
      verdict: "blocked",
      reason: "meta_page_not_authorized",
      pageLinkDiagnostic: null,
    },
  );
  assertEquals(calls, [
    { operation: "page", value: BUSINESS_IDENTITY.pageId },
  ]);
});

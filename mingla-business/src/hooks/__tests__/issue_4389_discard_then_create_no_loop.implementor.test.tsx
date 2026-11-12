/**
 * #4389 P0 — "Discard and start new", then create a brand on F1, crashed Ari
 * with "Maximum update depth exceeded" (device, 2 of 2).
 *
 * ROOT CAUSE. N1's discard called the brand-delete function and touched NO
 * cache. The brand list still held the discarded draft and the creator account
 * still named it as default. The two current-brand writers then ping-ponged
 * (the ORCH-1062 loop): `useCurrentBrandRecovery` re-selected the draft from
 * the stale list/default, `useCurrentBrand` cleared it (its detail read is
 * null), and so on, synchronously, until React's nested-update cap. F1's new
 * brand made it worse: it was made current before it was in the list, so the
 * recovery resolved straight back to the stale default.
 *
 * WHAT IS REAL. The discard hook and its React Query cache writes, the brand
 * adoption helper, the resolver, the recovery write body and the auto-clear
 * predicate. The settle loop below runs those two writers in turn exactly as
 * their effects do.
 *
 * FAILS ON REVERT: drop `evictDeletedBrandFromCaches` from useDiscardDraftBrand
 * → T1 never settles; drop `adoptBrandIntoCaches` from commitDefaultBrand →
 * T3 (pin) and T2's guarded scenario loses the new brand.
 */
import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): { unmount(): void };
  act(callback: () => void | Promise<void>): Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "acct-4389" }, isAuthReady: true }),
}));
jest.mock("../../services/supabase", () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn(), rpc: jest.fn(), from: jest.fn() },
}));
jest.mock("../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../services/creatorAccount", () => ({
  setCreatorDefaultBrand: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../services/brandSetupService", () => ({
  discardDraftBrand: jest.fn(() => Promise.resolve({ ok: true, stripe: "none", paystack: "none" })),
}));

/* eslint-disable import/first */
import { adoptBrandIntoCaches, useDiscardDraftBrand } from "../useBrandSetupFlowWrites";
import { brandKeys } from "../brandKeys";
import { creatorAccountKeys } from "../creatorAccountKeys";
import type { CreatorAccountRow } from "../useCreatorAccount";
import { runBrandRecoveryWrite } from "../useCurrentBrandRecovery";
import { resolveCurrentBrandId } from "../../utils/currentBrandResolver";
import { shouldClearCurrentBrandId } from "../../utils/currentBrandAutoClear";
import type { Brand } from "../../store/currentBrandStore";
/* eslint-enable import/first */

const ACCT = "acct-4389";
const DRAFT = "43890000-0000-4000-8000-00000000000d";
const NEW = "43890000-0000-4000-8000-00000000000e";
const brand = (id: string, name: string): Brand =>
  ({ id, displayName: name, role: "owner", stats: { events: 0, rev: 0, rev7d: 0, attendees: 0 } }) as unknown as Brand;
const account = (defaultBrandId: string | null): CreatorAccountRow => ({
  id: ACCT,
  email: null,
  display_name: null,
  avatar_url: null,
  marketing_opt_in: false,
  default_brand_id: defaultBrandId,
  deleted_at: null,
});

/**
 * Runs the recovery write then the auto-clear, as their effects do after each
 * commit, until neither writes. Returns null when it never settles (the crash).
 */
function settle(qc: QueryClient, start: string | null, gone: Set<string>): string | null | "LOOP" {
  let current = start;
  const appliedKeyRef: { current: string | null } = { current: null };
  for (let i = 0; i < 40; i += 1) {
    // One commit: both effects read the value this render saw.
    const rendered = current;
    let next = rendered;
    const list = qc.getQueryData<Brand[]>(brandKeys.list(ACCT)) ?? [];
    const def = qc.getQueryData<CreatorAccountRow | null>(creatorAccountKeys.byId(ACCT))?.default_brand_id ?? null;
    const resolution = resolveCurrentBrandId({ currentBrandId: rendered, defaultBrandId: def, brands: list });
    const appliedKey = [ACCT, rendered ?? "null", def ?? "null", list.map((b) => b.id).join("|"), resolution.brandId ?? "null", resolution.reason].join("::");
    runBrandRecoveryWrite({
      authoritative: true,
      isAuthReady: true,
      userId: ACCT,
      resolution,
      appliedKey,
      appliedKeyRef,
      currentBrandId: rendered,
      setCurrentBrandId: (id) => {
        next = id;
      },
      setErrorMessage: () => undefined,
    });
    if (
      shouldClearCurrentBrandId({
        hasHydrated: true,
        isAuthReady: true,
        currentBrandId: rendered,
        isFetched: true,
        isError: false,
        brandIsNull: rendered !== null && gone.has(rendered),
      })
    ) {
      next = null;
    }
    if (next === rendered) return rendered;
    current = next;
  }
  return "LOOP";
}

function seed(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<Brand[]>(brandKeys.list(ACCT), [brand(DRAFT, "Draft brand")]);
  qc.setQueryData<CreatorAccountRow | null>(creatorAccountKeys.byId(ACCT), account(DRAFT));
  qc.setQueryData<Brand>(brandKeys.detail(DRAFT), brand(DRAFT, "Draft brand"));
  return qc;
}

async function discardWithHook(qc: QueryClient): Promise<void> {
  let discard: ((id: string) => Promise<unknown>) | null = null;
  const Harness = (): null => {
    discard = useDiscardDraftBrand(ACCT);
    return null;
  };
  let r: { unmount(): void } | null = null;
  await TestRenderer.act(() => {
    r = TestRenderer.create(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await TestRenderer.act(async () => {
    await (discard as unknown as (id: string) => Promise<unknown>)(DRAFT);
  });
  await TestRenderer.act(() => (r as unknown as { unmount(): void }).unmount());
}

describe("#4389 P0 — discard a draft, then create on F1: no current-brand loop", () => {
  test("T0 control: with the stale caches the two writers never settle (the crash)", () => {
    const qc = seed();
    expect(settle(qc, DRAFT, new Set([DRAFT]))).toBe("LOOP");
  });

  test("T1: the discard hook evicts the draft, so the pointer settles", async () => {
    const qc = seed();
    await discardWithHook(qc);
    expect(qc.getQueryData<Brand[]>(brandKeys.list(ACCT))?.map((b) => b.id)).toEqual([]);
    expect(qc.getQueryData<CreatorAccountRow>(creatorAccountKeys.byId(ACCT))?.default_brand_id).toBeNull();
    expect(qc.getQueryData(brandKeys.detail(DRAFT))).toBeUndefined();
    expect(settle(qc, DRAFT, new Set([DRAFT]))).toBeNull();
  });

  test("T2: the new F1 brand, adopted into the caches, stays current", async () => {
    const qc = seed();
    await discardWithHook(qc);
    adoptBrandIntoCaches(qc, brand(NEW, "New brand"), ACCT);
    expect(settle(qc, NEW, new Set([DRAFT]))).toBe(NEW);
  });

  test("T3: F1 adopts the brand into the caches before making it current", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../components/brand/BrandCreationFlow.tsx"), "utf8");
    const body = src.slice(src.indexOf("const commitDefaultBrand"), src.indexOf("const adoptCreatedBrand"));
    const adopt = body.indexOf("adoptBrandIntoCaches(");
    const select = body.indexOf("setCurrentBrand(newBrand)");
    expect(adopt).toBeGreaterThan(-1);
    expect(select).toBeGreaterThan(adopt);
    // DraftInProgress discards through the evicting hook, never the bare service.
    expect(src).toMatch(/useDiscardDraftBrand\(/);
    expect(src).not.toMatch(/^\s*discardDraftBrand,\s*$/m);
  });
});

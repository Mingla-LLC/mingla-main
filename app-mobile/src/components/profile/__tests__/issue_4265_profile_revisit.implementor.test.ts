// @ts-nocheck — Deno-discovered suite; app-mobile's tsc sweep has no Deno globals,
// URL imports or allowImportingTsExtensions, while the deno-2-unit lane executes it directly.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
//
// #4265 — a Profile revisit inside five minutes refetches nothing.
//
// Inactive tabs unmount, so each Profile tap mounts new query observers, and
// React Query refetches on mount any query older than THAT observer's staleTime
// (refetchOnMount: true compares dataUpdatedAt + staleTime with now). Profile's
// observers used 30–60 s windows and mounted queries it never shows (friend
// requests, blocked users, and the closed Billing sheet's subscription /
// server-tier / RevenueCat reads), so a visit a minute after the last one
// re-sent ~20 requests. The two waterfalls on the follow list (follows → brands
// → prefs, then → follower counts) also ran one round trip after another.
//
// FAILS-ON-REVERT: set PROFILE_REVISIT_STALE_MS back to 60_000 → P-1 fails; put
// `useFriends()` back in ProfilePage or a 30/60 s window back on any Profile
// section → P-2/P-3 fail; mount the closed sheets again → P-4 fails; await the
// brand details and prefs one after the other → P-5 fails.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PROFILE_REVISIT_STALE_MS } from "../profileFreshness.ts";

const root = new URL("../../../../", import.meta.url);
const read = (rel: string): string => Deno.readTextFileSync(new URL(rel, root));
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const dense = (src: string): string => code(src).replace(/\s+/g, "");

// React Query v5 `isStaleByTime`: stale once now >= dataUpdatedAt + staleTime.
const refetchesOnMount = (gapMs: number, staleTime: number): boolean => gapMs >= staleTime;

Deno.test("#4265 P-1 a Profile revisit one to four minutes later reuses every section", () => {
  assertEquals(PROFILE_REVISIT_STALE_MS, 5 * 60_000);
  for (const gap of [61_000, 90_000, 4 * 60_000]) {
    assertEquals(refetchesOnMount(gap, PROFILE_REVISIT_STALE_MS), false, `gap ${gap} ms`);
    assertEquals(refetchesOnMount(gap, 60_000), true, `oracle: the old 60 s window refetched at ${gap} ms`);
  }
  assertEquals(refetchesOnMount(5 * 60_000, PROFILE_REVISIT_STALE_MS), true, "older than five minutes still refreshes");
});

Deno.test("#4265 P-2 Profile reads only the friends list, with the revisit window", () => {
  const page = code(read("src/components/ProfilePage.tsx"));
  assert(!/\buseFriends\(\)/.test(page), "useFriends() also mounts friend requests and blocked users");
  assert(page.includes("useFriendsList(user?.id, { staleTime: PROFILE_REVISIT_STALE_MS })"));
  assert(dense(page).includes("queryKey:userLevelKeys.level(user?.id??''),queryFn:()=>fetchUserLevel(user!.id),enabled:!!user?.id,staleTime:PROFILE_REVISIT_STALE_MS,"));
  const hook = dense(read("src/hooks/useFriendsQuery.ts"));
  assert(hook.includes("staleTime:options?.staleTime??FRIENDS_STALE_TIME,"), "other callers keep the 30 s friends window");
});

Deno.test("#4265 P-3 every Profile section query uses the revisit window", () => {
  const purchasesCard = code(read("src/components/profile/PurchasesCard.tsx"));
  assert(purchasesCard.includes("usePurchases(userId, { staleTime: PROFILE_REVISIT_STALE_MS })"));
  const purchases = dense(read("src/hooks/usePurchases.ts"));
  assertEquals((purchases.match(/staleTime,refetchOnWindowFocus:true,refetchOnMount:true,/g) ?? []).length, 4, "all four purchase lists take the caller's window");
  assert(purchases.includes("conststaleTime=options?.staleTime??60_000;"), "the Purchases screen keeps 60 s");

  const creator = code(read("src/components/profile/CreatorProgramsSection.tsx"));
  assertEquals((creator.match(/staleTime: PROFILE_REVISIT_STALE_MS/g) ?? []).length, 5);
  assert(!/staleTime: (30|60)_000/.test(creator));

  const brands = code(read("src/components/profile/BrandsYouFollowSection.tsx"));
  assert(!/staleTime: (30|60)_000/.test(brands));
  assert(dense(brands).includes("useBrandFollowerCounts(rows.map((row)=>row.brandId),{staleTime:PROFILE_REVISIT_STALE_MS},);"));
});

Deno.test("#4265 P-4 the closed Account and Billing sheets do not mount with the tab", () => {
  const page = dense(read("src/components/ProfilePage.tsx"));
  assert(page.includes("if(showAccountSettings)accountSettingsOpenedRef.current=true;"));
  assert(page.includes("if(showBillingSheet)billingSheetOpenedRef.current=true;"));
  assert(page.includes("{accountSettingsOpenedRef.current?(<AccountSettings"), "Account Settings must wait for its first open");
  assert(page.includes("{billingSheetOpenedRef.current?(<BillingSheet"), "Billing (subscription, server tier, RevenueCat) must wait for its first open");
});

Deno.test("#4265 P-5 the follow list's waterfalls are broken", () => {
  const service = dense(read("src/services/brandFollowsService.ts"));
  const start = service.indexOf("asynclistFollows(");
  const body = service.slice(start, service.indexOf("return(follows??[]).map(", start));
  const ids = body.indexOf("options?.onBrandIds?.(brandIds);");
  const parallel = body.indexOf("]=awaitPromise.all([");
  assert(ids !== -1 && parallel !== -1 && ids < parallel, "the ids are handed out before the detail reads start");
  assert(body.indexOf('.from("business_public_brands_view")') > parallel, "brand details are inside the parallel read");
  assert(body.indexOf('.from("brand_follow_channel_prefs")') > parallel, "channel prefs are inside the parallel read");
  assertEquals((body.match(/awaitsupabase/g) ?? []).length, 1, "only the follows read is awaited on its own");

  const section = dense(read("src/components/profile/BrandsYouFollowSection.tsx"));
  assert(
    section.includes("onBrandIds:(brandIds)=>{voidqueryClient.prefetchQuery(brandFollowerCountsQueryOptions(brandIds,{staleTime:PROFILE_REVISIT_STALE_MS}),);}"),
    "follower counts start as soon as the ids are known",
  );
  const counts = dense(read("src/hooks/useBrandFollowerCount.ts"));
  assert(counts.includes("returnuseQuery(brandFollowerCountsQueryOptions(brandIds,options));"), "hook and prefetch share one key/fetch definition");
});

Deno.test("#4265 P-6 sections hold their space while their first load runs", () => {
  const interests = code(read("src/components/profile/ProfileInterestsSection.tsx"));
  assert(interests.includes("{loading && !hasInterests ? (\n        <ProfileChipsSkeleton />"));
  assert(code(read("src/components/ProfilePage.tsx")).includes("loading={interestsLoading}"));
  const creator = dense(read("src/components/profile/CreatorProgramsSection.tsx"));
  assert(creator.includes("{statusPending?<ProfileRowsSkeleton/>:isCreator?<>"));
});

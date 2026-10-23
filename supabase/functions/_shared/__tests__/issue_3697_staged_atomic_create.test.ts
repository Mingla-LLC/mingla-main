import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AtomicCreateError, createStagedCampaignAtomic } from "../adChannel.ts";
import type { AdConnectionRow, ChannelAdapter } from "../adChannelCore.ts";

const CONN = {
  id: "connection-1",
  platform: "meta",
  lane: "consumer",
  external_account_id: "act_1",
  connected: true,
  status: "connected",
  currency: "USD",
  extra: {},
} as unknown as AdConnectionRow;

function adapter(input?: {
  calls?: string[];
  failAdAt?: number;
  creativeRollbackFailsFor?: string;
}): ChannelAdapter {
  const calls = input?.calls ?? [];
  let adSet = 0;
  let creative = 0;
  let ad = 0;
  return {
    platform: "meta",
    // deno-lint-ignore require-await
    createCampaign: async () => {
      calls.push("campaign");
      return { externalId: "campaign-1" };
    },
    // deno-lint-ignore require-await
    createAdSet: async () => {
      adSet += 1;
      calls.push(`adset-${adSet}`);
      return { externalId: `adset-${adSet}` };
    },
    // deno-lint-ignore require-await
    createCreative: async () => {
      creative += 1;
      calls.push(`creative-${creative}`);
      return { externalCreativeId: `creative-${creative}`, postId: null };
    },
    // deno-lint-ignore require-await
    createAd: async () => {
      ad += 1;
      calls.push(`ad-${ad}`);
      if (input?.failAdAt === ad) throw new Error(`ad ${ad} failed`);
      return { externalId: `ad-${ad}`, reviewStatus: "PENDING" };
    },
    // deno-lint-ignore require-await
    rollbackCampaign: async () => {
      calls.push("rollback-campaign");
    },
    // deno-lint-ignore require-await
    rollbackCreative: async (_conn: AdConnectionRow, id: string) => {
      calls.push(`rollback-${id}`);
      if (input?.creativeRollbackFailsFor === id) {
        throw new Error("creative cleanup failed");
      }
    },
    getStatus: () => Promise.reject(new Error("unused")),
    setStatus: () => Promise.reject(new Error("unused")),
    setBudget: () => Promise.reject(new Error("unused")),
    readBudget: () => Promise.reject(new Error("unused")),
  } as unknown as ChannelAdapter;
}

const stagedInput = {
  campaign: {
    name: "Mingla stages",
    objective: "OUTCOME_TRAFFIC",
    dailyBudgetCents: 10_000,
  },
  stages: [
    {
      key: "prospecting",
      adSet: {
        name: "Prospecting",
        optimizationGoal: "LANDING_PAGE_VIEWS",
        billingEvent: "IMPRESSIONS",
        targeting: {},
      },
      ads: [1, 2].map((number) => ({
        creative: {
          destUrl: "https://usemingla.com/e/b/e",
          message: `P${number}`,
        },
        ad: { name: `P${number}` },
      })),
    },
    {
      key: "retarget",
      adSet: {
        name: "Retarget",
        optimizationGoal: "LANDING_PAGE_VIEWS",
        billingEvent: "IMPRESSIONS",
        targeting: {},
      },
      ads: [1, 2].map((number) => ({
        creative: {
          destUrl: "https://usemingla.com/e/b/e",
          message: `R${number}`,
        },
        ad: { name: `R${number}` },
      })),
    },
  ],
};

Deno.test("#3697 staged atomic create makes every stage and creative paused-chain object", async () => {
  const calls: string[] = [];
  const result = await createStagedCampaignAtomic(
    adapter({ calls }),
    CONN,
    stagedInput,
  );
  assertEquals(result.externalCampaignId, "campaign-1");
  assertEquals(result.stages.map((stage) => stage.key), [
    "prospecting",
    "retarget",
  ]);
  assertEquals(result.stages.map((stage) => stage.ads.length), [2, 2]);
  assertEquals(calls, [
    "campaign",
    "adset-1",
    "creative-1",
    "ad-1",
    "creative-2",
    "ad-2",
    "adset-2",
    "creative-3",
    "ad-3",
    "creative-4",
    "ad-4",
  ]);
});

Deno.test("#3697 late staged failure deletes campaign before all creatives", async () => {
  const calls: string[] = [];
  const error = await assertRejects(
    () =>
      createStagedCampaignAtomic(
        adapter({ calls, failAdAt: 4 }),
        CONN,
        stagedInput,
      ),
    AtomicCreateError,
  );
  assertEquals(error.failure.step, "ad");
  assertEquals(error.failure.rollbackSucceeded, true);
  assertEquals(error.failure.creativeRollbackSucceeded, true);
  const campaignRollback = calls.indexOf("rollback-campaign");
  assert(campaignRollback > calls.indexOf("ad-4"));
  assert(campaignRollback < calls.indexOf("rollback-creative-4"));
  assertEquals(calls.slice(campaignRollback + 1), [
    "rollback-creative-4",
    "rollback-creative-3",
    "rollback-creative-2",
    "rollback-creative-1",
  ]);
});

Deno.test("#3697 staged rollback reports any remaining creative residue", async () => {
  const error = await assertRejects(
    () =>
      createStagedCampaignAtomic(
        adapter({ failAdAt: 4, creativeRollbackFailsFor: "creative-2" }),
        CONN,
        stagedInput,
      ),
    AtomicCreateError,
  );
  assertEquals(error.failure.rollbackSucceeded, true);
  assertEquals(error.failure.creativeRollbackSucceeded, false);
  assert(
    error.failure.partialExternalIds.external_creative_id_retarget_1 ===
      "creative-4",
  );
});

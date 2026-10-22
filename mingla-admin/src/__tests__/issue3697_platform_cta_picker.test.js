import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CTA_OPTIONS_BY_PLATFORM,
  DEFAULT_PLATFORM_CTAS,
} from "../lib/adBuilder/copyRules.js";
import { buildCreatePayload } from "../lib/adBuilder/payload.js";

const base = {
  lane: "consumer",
  name: "Friday",
  goal: {
    metaObjective: "OUTCOME_TRAFFIC",
    metaOptimizationGoal: "LANDING_PAGE_VIEWS",
    platforms: {
      tiktok: { objective: "TRAFFIC" },
      snapchat: {
        objective: "TRAFFIC",
        optimization_goal: "PIXEL_PAGE_VIEW",
      },
    },
  },
  destination: {
    page_type: "event",
    brand_slug: "room-27",
    entity_slug: "friday",
  },
  audience: {
    countries: ["NG"],
    ageMin: 18,
    ageMax: 45,
    gender: "all",
  },
  budget: { dailyCentsForChannel: 5000 },
  creative: {
    kind: "video",
    creativeLibraryId: "10000000-0000-4000-8000-000000000001",
    brandName: "Room 27",
  },
  copy: {
    primary: "Come through",
    headline: "Friday night",
    description: "One room",
    cta: "LEARN_MORE",
    platformCtas: {
      meta: "EVENT_RSVP",
      snapchat: "SHOWTIMES",
      tiktok: "Get showtimes",
      reddit: "Remind Me",
    },
    googleHeadlines: ["Friday", "Room 27", "Book now"],
    googleDescriptions: ["One room", "One night"],
    keywords: ["friday night"],
  },
  requestId: "20000000-0000-4000-8000-000000000002",
};

describe("#3697 provider CTA picker", () => {
  it("exposes provider-specific allowlists and defaults", () => {
    assert.ok(CTA_OPTIONS_BY_PLATFORM.meta.includes("EVENT_RSVP"));
    assert.ok(CTA_OPTIONS_BY_PLATFORM.snapchat.includes("SHOWTIMES"));
    assert.ok(CTA_OPTIONS_BY_PLATFORM.tiktok.includes("Get showtimes"));
    assert.equal(DEFAULT_PLATFORM_CTAS.snapchat, "BUY_TICKETS");
    assert.ok(!CTA_OPTIONS_BY_PLATFORM.tiktok.includes("BUY_TICKETS"));
  });

  it("sends the chosen native value only to its platform", () => {
    assert.equal(
      buildCreatePayload("meta", base).creative.call_to_action_type,
      "EVENT_RSVP",
    );
    assert.equal(
      buildCreatePayload("snapchat", base).creative.call_to_action,
      "SHOWTIMES",
    );
    assert.equal(
      buildCreatePayload("tiktok", base).creative.call_to_action,
      "Get showtimes",
    );
    assert.equal(
      buildCreatePayload("reddit", base).creative.call_to_action,
      "Remind Me",
    );
  });
});

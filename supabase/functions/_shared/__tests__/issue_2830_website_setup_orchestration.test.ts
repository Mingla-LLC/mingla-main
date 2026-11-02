import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { AgentLoopObservation } from "../agentLoop.ts";
import { isAriRenditionInputField } from "../ariRendition.ts";
import {
  buildWebsiteSetupPresentation,
  buildWebsiteSetupReply,
  buildWebsiteSetupRetryPresentation,
  resolveWebsiteSetupContextAnswer,
  WEBSITE_SETUP_RETURN_MESSAGES,
  WEBSITE_SETUP_SUBMISSION_SUFFIX,
  WEBSITE_SETUP_THEME_PRESETS,
  websiteSetupCityCountry,
  websiteSetupContextAnswer,
  websiteSetupContextRevision,
  websiteSetupEffectiveIntent,
  websiteSetupEmail,
  websiteSetupLinks,
  WEBSITE_SETUP_LINK_PLATFORMS,
  WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY,
  websiteSetupPhone,
  websiteSetupPhoneStart,
  websiteSetupSocialKey,
  detectWebsiteSetupIntent,
  WEBSITE_SETUP_FIELD_KEYS,
  websiteSetupApprovedWriteFollowup,
  websiteSetupCurrentTurnOnly,
  websiteSetupDesignAnswer,
  websiteSetupInitialCalls,
  websiteSetupInteractionKind,
  websiteSetupMergedPlanAnswers,
  websiteSetupPlanAnswer,
  websiteSetupPlanRevision,
  websiteSetupWorkflowInitialCalls,
} from "../agentWebsiteSetup.ts";

const BRAND_ID = "28300000-0000-4000-8000-000000000002";

Deno.test("#2830 confirmed Website plan writes resume through the Host owner", () => {
  for (
    const toolName of [
      "save_site_plan_design",
      "save_site_plan_answers",
      "update_brand_context",
    ]
  ) {
    assertStringIncludes(
      websiteSetupApprovedWriteFollowup(toolName) ?? "",
      "continuing to the next gap",
    );
  }
  assertEquals(websiteSetupApprovedWriteFollowup("create_site_draft"), null);
});

function observation(
  tool: string,
  result: unknown,
): AgentLoopObservation {
  return { tool, args: { brand_id: BRAND_ID }, result, elapsedMs: 1 };
}

const plan = {
  status: {
    done_count: 2,
    parts: [
      { key: "offer", done: true },
      { key: "brand", done: true },
      { key: "look", done: false },
      { key: "story", done: false },
      { key: "approve", done: false },
      { key: "build", done: false },
      { key: "first_offering", done: false },
      { key: "publish", done: false },
    ],
  },
  completeness: {
    fields: [
      {
        key: "design_key",
        label: "Website design",
        requirement: "required",
        state: "missing",
      },
      {
        key: "story.who",
        label: "Who comes with you",
        requirement: "recommended",
        state: "missing",
      },
      {
        key: "profile_photo",
        label: "Brand logo",
        requirement: "recommended",
        state: "missing",
        human_action_required: true,
      },
      {
        key: "theme",
        label: "Theme",
        requirement: "optional",
        state: "missing",
      },
    ],
  },
};

Deno.test("#2830 Website setup is a hard task boundary from event planning", () => {
  assertEquals(
    detectWebsiteSetupIntent(
      "Start Website setup. Read get_site_plan and summarize every gap.",
    ),
    "audit",
  );
  assertEquals(
    detectWebsiteSetupIntent(
      "Fix all Website brand-context gaps. Resume the durable job.",
    ),
    "fix_all",
  );
  assertEquals(
    detectWebsiteSetupIntent("Use November 15th at 18:00 for the event"),
    null,
  );
  assertEquals(
    detectWebsiteSetupIntent(
      "Use my answer for Website design, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap. Choices: Atelier",
    ),
    null,
  );
});

Deno.test("#2830 Website setup enforces its required tool chain before speaking", () => {
  assertEquals(websiteSetupInitialCalls("audit", BRAND_ID), [{
    name: "get_site_plan",
    args: { brand_id: BRAND_ID },
  }]);
  assertEquals(websiteSetupInitialCalls("fix_all", BRAND_ID), [{
    name: "get_site_plan",
    args: { brand_id: BRAND_ID },
  }, {
    name: "start_brand_completeness_job",
    args: { brand_id: BRAND_ID, takeover: false },
  }]);
});

Deno.test("#2830 later Website answers resume an active Fix all job before reasoning", () => {
  assertEquals(
    websiteSetupWorkflowInitialCalls({
      intent: null,
      brandId: BRAND_ID,
      activeFixAllJob: true,
    }),
    [{
      name: "get_site_plan",
      args: { brand_id: BRAND_ID },
    }, {
      name: "start_brand_completeness_job",
      args: { brand_id: BRAND_ID, takeover: false },
    }],
  );
  assertEquals(
    websiteSetupWorkflowInitialCalls({
      intent: null,
      brandId: BRAND_ID,
      activeFixAllJob: false,
    }),
    [{
      name: "get_site_plan",
      args: { brand_id: BRAND_ID },
    }],
  );
});

Deno.test("#2830 durable Website jobs reason from the current answer, not stale chat failures", () => {
  const staleFailure = { role: "model", text: "tool errors" };
  const staleAnswer = { role: "user", text: "Voyage" };
  const currentAnswer = { role: "user", text: "Atelier" };
  assertEquals(
    websiteSetupCurrentTurnOnly([staleFailure, staleAnswer, currentAnswer]),
    [currentAnswer],
  );
  assertEquals(websiteSetupCurrentTurnOnly([]), []);
});

Deno.test("#2830 structured design answers become exact pre-draft plan proposals", () => {
  const answer =
    "Use my answer for Website design, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap. Choices: Atelier";
  assertEquals(websiteSetupDesignAnswer(answer), {
    designKey: "atelier",
    ownerWords: "Choices: Atelier",
  });
  assertEquals(
    websiteSetupDesignAnswer(answer.replace("Atelier", "Studio")),
    null,
  );
  assertEquals(websiteSetupDesignAnswer("Use Voyage"), null);
  assertEquals(websiteSetupPlanRevision({ plan: { revision: 6 } }), 6);
  assertEquals(websiteSetupPlanRevision({ revision: 7 }), 7);
  assertEquals(websiteSetupPlanRevision({ plan: { revision: "6" } }), null);
});

Deno.test("#3355 a brand-new brand with no saved plan answers Ari at revision 0", () => {
  // The plan read returns `plan: null` until the first save creates the row.
  assertEquals(
    websiteSetupPlanRevision({ brand_id: BRAND_ID, entitled: true, plan: null }),
    0,
  );
  // Not entitled, or no plan read at all: still nothing to save against.
  assertEquals(
    websiteSetupPlanRevision({ brand_id: BRAND_ID, entitled: false }),
    null,
  );
  assertEquals(websiteSetupPlanRevision({ entitled: true }), null);
  assertEquals(websiteSetupPlanRevision(null), null);
});

Deno.test("#2830 structured plan answers preserve owner words without model inference", () => {
  assertEquals(
    websiteSetupPlanAnswer(
      "Use my answer for Who comes with you, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap.\nResponse: Couples and close friends",
    ),
    {
      fieldKey: "story.who",
      fieldLabel: "Who comes with you",
      answers: { story: { who: "Couples and close friends" } },
      ownerWords: "Response: Couples and close friends",
    },
  );
  assertEquals(
    websiteSetupPlanAnswer(
      "Use my answer for Main visitor action, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap. Choices: Explore offerings",
    ),
    {
      fieldKey: "story.main_action",
      fieldLabel: "Main visitor action",
      answers: { story: { main_action: "Explore offerings" } },
      ownerWords: "Choices: Explore offerings",
    },
  );
  assertEquals(
    websiteSetupPlanAnswer(
      "Use my answer for What you'll offer, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap. Choices: Events",
    ),
    {
      fieldKey: "offerings_selected",
      fieldLabel: "What you'll offer",
      answers: { offerings_selected: ["events"] },
      ownerWords: "Choices: Events",
    },
  );
  assertEquals(websiteSetupPlanAnswer("Response: anything"), null);
});

Deno.test("#2830 each story step merges instead of erasing earlier owner answers", () => {
  assertEquals(
    websiteSetupMergedPlanAnswers(
      {
        plan: {
          story: {
            who: "Couples and close friends",
            why: null,
            main_action: "",
          },
        },
      },
      { story: { why: "Local knowledge and a personal welcome" } },
    ),
    {
      story: {
        who: "Couples and close friends",
        why: "Local knowledge and a personal welcome",
      },
    },
  );
  assertEquals(
    websiteSetupMergedPlanAnswers(
      { plan: { story: { who: "Friends", why: "Local knowledge" } } },
      { venue_descriptor: "studio" },
    ),
    { venue_descriptor: "studio" },
  );
});

Deno.test("#2830 first Website response gives the live rundown and all three paths", () => {
  const reply = buildWebsiteSetupReply(
    "audit",
    [observation("get_site_plan", plan)],
    "North Star",
  );
  assertStringIncludes(reply ?? "", "2 of 8 complete");
  assertStringIncludes(reply ?? "", "Website design");
  assertStringIncludes(reply ?? "", "Who comes with you");
  assertStringIncludes(reply ?? "", "Brand logo");
  assertStringIncludes(reply ?? "", "Fix all gaps with Ari");
  assertStringIncludes(reply ?? "", "Review the gaps");
  assertStringIncludes(reply ?? "", "Add it myself");
  assertStringIncludes(reply ?? "", "not create a draft");
});

Deno.test("#2830 setup audit renders field completeness, not workspace diagnostics", () => {
  const presentation = buildWebsiteSetupPresentation(
    "audit",
    [observation("get_site_plan", {
      ...plan,
      active: true,
      expires_at: "2026-11-01T03:51:18Z",
      held_by_me: true,
      holder_name: "info",
      revision: 6,
      rank: 60,
    })],
    "North Star",
    BRAND_ID,
  );
  const serialized = JSON.stringify(presentation?.rendition ?? {});
  assertStringIncludes(serialized, "Every gap Ari found");
  assertStringIncludes(serialized, "Fix everything with Ari");
  assertStringIncludes(serialized, "Review the gaps");
  assertStringIncludes(serialized, "Add it myself");
  for (
    const internal of [
      "Workspace result",
      "Get Site Plan",
      "expires_at",
      "held_by_me",
      "holder_name",
      "revision",
      "rank",
    ]
  ) {
    assertEquals(serialized.includes(internal), false, internal);
  }
});

Deno.test("#2830 every manifest field has a deterministic user interaction", () => {
  assertEquals(WEBSITE_SETUP_FIELD_KEYS.length, 17);
  for (const key of WEBSITE_SETUP_FIELD_KEYS) {
    const kind = websiteSetupInteractionKind(
      key,
      key === "profile_photo" || key === "cover_media"
        ? { human_action_required: true }
        : {},
    );
    assertEquals(
      ["input", "choices", "callout"].includes(kind),
      true,
      `${key}: ${kind}`,
    );
  }
  assertEquals(WEBSITE_SETUP_FIELD_KEYS.at(-1), "approved_plan");
});

Deno.test("#2830 design question presents every valid design as a real choice", () => {
  const presentation = buildWebsiteSetupPresentation(
    "fix_all",
    [
      observation("get_site_plan", plan),
      observation("start_brand_completeness_job", {
        resumed: false,
        job: {
          status: "queued",
          pending_step_keys: ["design_key", "approved_plan"],
          completed_step_keys: ["name"],
          checkpoint: { current_step: "design_key" },
        },
        completeness: plan.completeness,
      }),
    ],
    "North Star",
    BRAND_ID,
  );
  const serialized = JSON.stringify(presentation?.rendition ?? {});
  assertStringIncludes(serialized, "Atelier");
  assertStringIncludes(serialized, "Voyage");
  assertStringIncludes(serialized, "Continue with Ari");
  assertStringIncludes(serialized, "Review remaining gaps");
  assertStringIncludes(serialized, "Add it myself");
});

Deno.test("#2830 Fix all creates one durable job and asks one current-step question", () => {
  const reply = buildWebsiteSetupReply(
    "fix_all",
    [
      observation("get_site_plan", plan),
      observation("start_brand_completeness_job", {
        resumed: false,
        job: {
          id: "28300000-0000-4000-8000-000000000003",
          status: "queued",
          pending_step_keys: ["design_key", "story.who", "approved_plan"],
          completed_step_keys: ["name", "description"],
          checkpoint: { current_step: "design_key" },
        },
        completeness: plan.completeness,
      }),
    ],
    "North Star",
  );
  // #3355 P1 (D-6): plain words, no engine vocabulary, no second counter.
  assertStringIncludes(reply ?? "", "Starting Website setup for North Star");
  assert(!/durable|job|checkpoint|\d+ remain/i.test(reply ?? ""));
  assertStringIncludes(reply ?? "", "Atelier or Voyage?");
  assertEquals((reply?.match(/\?/g) ?? []).length, 1);
  assertMatch(reply ?? "", /No draft will be created first/i);
});

Deno.test("#2830 Fix all reports teammate ownership without taking over", () => {
  const reply = buildWebsiteSetupReply(
    "fix_all",
    [
      observation("get_site_plan", plan),
      observation("start_brand_completeness_job", {
        blocked_by_other_job: true,
        takeover_available: true,
      }),
    ],
    "North Star",
  );
  assertStringIncludes(reply ?? "", "Another teammate is already working through");
  assertStringIncludes(reply ?? "", "explicitly take over");
  assertStringIncludes(reply ?? "", "didn’t start a second one");
});

// ---------------------------------------------------------------------------
// #2830 gaps 1-3: brand-context answers, owner approval, upload handoffs.
// ---------------------------------------------------------------------------

const CONTEXT_REVISION = "a".repeat(64);

function contextPlan(fields: Record<string, unknown>[] = []) {
  return {
    plan: { revision: 9, story: {} },
    completeness: {
      context_revision: CONTEXT_REVISION,
      fields,
    },
  };
}

function submission(label: string, tail: string): string {
  return `Use my answer for ${label}${WEBSITE_SETUP_SUBMISSION_SUFFIX}${tail}`;
}

function resolve(
  label: string,
  tail: string,
  plan: unknown = contextPlan(),
) {
  const answer = websiteSetupContextAnswer(submission(label, tail));
  if (!answer) throw new Error(`no context answer for ${label}`);
  return resolveWebsiteSetupContextAnswer({ brandId: BRAND_ID, plan, answer });
}

function proposalArgs(
  resolution: ReturnType<typeof resolveWebsiteSetupContextAnswer>,
): Record<string, unknown> {
  if (resolution.kind !== "proposal") {
    throw new Error(`expected a proposal, got ${JSON.stringify(resolution)}`);
  }
  return resolution.args;
}

function retryProblem(
  resolution: ReturnType<typeof resolveWebsiteSetupContextAnswer>,
): string {
  if (resolution.kind !== "retry") {
    throw new Error(`expected a retry, got ${JSON.stringify(resolution)}`);
  }
  return resolution.problem;
}

Deno.test("#2830 context answers parse the audit's own field labels only", () => {
  const parsed = websiteSetupContextAnswer(
    submission("Contact email", "\nResponse: hello@northstar.travel"),
  );
  assertEquals(parsed?.fieldKey, "contact_email");
  assertEquals(parsed?.response, "hello@northstar.travel");
  assertEquals(parsed?.ownerWords, "Response: hello@northstar.travel");
  assertEquals(
    websiteSetupContextAnswer(submission("City and country", " Response: Lisbon, Portugal"))
      ?.fieldKey,
    "city_country",
  );
  assertEquals(
    websiteSetupContextAnswer(submission("Mingla page theme", " Choices: Bold and energetic"))
      ?.choices,
    "Bold and energetic",
  );
  // Plan answers and unknown labels are not brand-context answers.
  assertEquals(websiteSetupContextAnswer(submission("Who comes with you", " Response: x")), null);
  assertEquals(websiteSetupContextAnswer("hello@northstar.travel"), null);
});

Deno.test("#2830 brand-context answers become update_brand_context args bound to both revisions", () => {
  const args = proposalArgs(
    resolve("Contact email", " Response: hello@northstar.travel"),
  );
  assertEquals(args, {
    brand_id: BRAND_ID,
    expected_plan_revision: 9,
    expected_context_revision: CONTEXT_REVISION,
    evidence: { source_type: "owner" },
    cites: [{
      kind: "owner_words",
      quote: "Response: hello@northstar.travel",
    }],
    patch: { contact_email: "hello@northstar.travel" },
    why: "The owner gave the public contact email during Website setup.",
  });
  assertEquals(websiteSetupContextRevision(contextPlan()), CONTEXT_REVISION);
  assertEquals(websiteSetupContextRevision({ completeness: { context_revision: "abc" } }), null);
  // Without a fresh context revision nothing is proposed.
  const stale = resolve("Contact email", " Response: hello@northstar.travel", {
    plan: { revision: 9 },
    completeness: { fields: [] },
  });
  assertEquals(stale.kind, "unavailable");
});

Deno.test("#2830 email answers use the Host form's rule before any write", () => {
  assertEquals(websiteSetupEmail(" hello@northstar.travel "), {
    ok: true,
    value: "hello@northstar.travel",
  });
  assertEquals(websiteSetupEmail("call us").ok, false);
  assertEquals(websiteSetupEmail("hello@northstar").ok, false);
  assertEquals(websiteSetupEmail("a@b.com or c@d.com").ok, false);
  // The form validates the whole field; Ari never digs an address out of prose.
  assertEquals(websiteSetupEmail("Our inbox is hello@northstar.travel").ok, false);
  assertStringIncludes(
    retryProblem(resolve("Contact email", " Response: just ring us")),
    "What public email should the Website show?",
  );
});

function phonePlan(
  stored: string | null,
  countryCode: string | null,
) {
  return contextPlan([
    { key: "contact_phone", label: "Contact phone", value: stored },
    {
      key: "city_country",
      label: "City and country",
      value: { city: countryCode ? "New York" : null, country_code: countryCode },
    },
  ]);
}

Deno.test("#2830 phone opens on the brand's country like the Host form", () => {
  assertEquals(
    websiteSetupPhoneStart({ stored: null, brandCountryCode: "US" }),
    { countryIso: "US", source: "brand", localText: "" },
  );
  const presentation = buildWebsiteSetupRetryPresentation({
    fieldKey: "contact_phone",
    field: { key: "contact_phone", label: "Contact phone", value: null },
    brandId: BRAND_ID,
    problem: "Enter a phone number.",
    completeness: phonePlan(null, "US").completeness,
  });
  const block = presentation.rendition.blocks.find((item) =>
    item.type === "input"
  ) as Record<string, unknown>;
  const field = block.field as Record<string, unknown>;
  assertEquals(field.label, "Contact phone — United States (+1)");
  assertEquals(field.kind, "phone");
  assertEquals(field.countryIso, "US");
  assertEquals(isAriRenditionInputField(field), true);
  // The owner types only the local number; the brand's country composes it.
  const args = proposalArgs(resolve(
    "Contact phone",
    " Country: US Response: (212) 555-0134",
    phonePlan(null, "US"),
  ));
  assertEquals(args.patch, { contact_phone: "+12125550134" });
  // An old client that sends no chip still composes under the shown country.
  assertEquals(
    proposalArgs(resolve(
      "Contact phone",
      " Response: 212 555 0134",
      phonePlan(null, "US"),
    )).patch,
    { contact_phone: "+12125550134" },
  );
});

Deno.test("#2830 a stored E.164 number decides the phone country over the brand's", () => {
  assertEquals(
    websiteSetupPhoneStart({
      stored: "+2348031234567",
      brandCountryCode: "US",
    }),
    { countryIso: "NG", source: "stored", localText: "8031234567" },
  );
  // A shared +1 number stays with the brand's own +1 country.
  assertEquals(
    websiteSetupPhoneStart({ stored: "+14165550123", brandCountryCode: "CA" })
      .countryIso,
    "CA",
  );
  const presentation = buildWebsiteSetupRetryPresentation({
    fieldKey: "contact_phone",
    field: { key: "contact_phone", label: "Contact phone", value: "+2348031234567" },
    brandId: BRAND_ID,
    problem: "Check the number.",
    completeness: phonePlan("+2348031234567", "US").completeness,
  });
  const serialized = JSON.stringify(presentation.rendition);
  assertStringIncludes(serialized, "Contact phone — Nigeria (+234)");
  assertStringIncludes(serialized, '"countryIso":"NG"');
});

Deno.test("#2830 digits with no chosen country are refused and nothing is written", () => {
  assertEquals(
    websiteSetupPhoneStart({ stored: null, brandCountryCode: null }),
    { countryIso: null, source: "fallback", localText: "" },
  );
  const resolution = resolve(
    "Contact phone",
    " Response: 020 7946 0958",
    phonePlan(null, null),
  );
  assertEquals(resolution.kind, "retry");
  assertEquals(retryProblem(resolution), "Choose the country for this number.");
  assertEquals(WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY, "Choose the country for this number.");
  const presentation = buildWebsiteSetupRetryPresentation({
    fieldKey: "contact_phone",
    field: { key: "contact_phone", label: "Contact phone", value: null },
    brandId: BRAND_ID,
    problem: retryProblem(resolution),
    completeness: phonePlan(null, null).completeness,
  });
  const block = presentation.rendition.blocks.find((item) =>
    item.type === "input"
  ) as Record<string, unknown>;
  const field = block.field as Record<string, unknown>;
  assertEquals(field.label, "Contact phone");
  assertEquals(field.countryIso, undefined);
  assertEquals(field.countryPlaceholder, "Choose country");
  // Choosing a country on the chip makes the same digits valid.
  assertEquals(
    proposalArgs(resolve(
      "Contact phone",
      " Country: GB Response: 020 7946 0958",
      phonePlan(null, null),
    )).patch,
    { contact_phone: "+442079460958" },
  );
});

Deno.test("#2830 a typed + number overrides the chip", () => {
  assertEquals(
    websiteSetupPhone({
      text: "+234 803 123 4567",
      countryIso: "US",
      stored: null,
      brandCountryCode: "US",
    }),
    { ok: true, value: "+2348031234567" },
  );
  assertEquals(
    proposalArgs(resolve(
      "Contact phone",
      " Country: US Response: +44 20 7946 0958",
      phonePlan(null, "US"),
    )).patch,
    { contact_phone: "+442079460958" },
  );
  // A + number needs no chip at all.
  assertEquals(
    proposalArgs(resolve(
      "Contact phone",
      " Response: +351 912 345 678",
      phonePlan(null, null),
    )).patch,
    { contact_phone: "+351912345678" },
  );
});

Deno.test("#2830 a number invalid for the chosen country is refused with the form's message", () => {
  // A Nigerian mobile typed under the UK chip names Nigeria, never +44.
  const wrong = websiteSetupPhone({
    text: "0803 123 4567",
    countryIso: "GB",
    stored: null,
    brandCountryCode: null,
  });
  assertEquals(wrong.ok, false);
  assertStringIncludes(wrong.ok ? "" : wrong.problem, "Nigeria");
  const short = resolve(
    "Contact phone",
    " Country: US Response: 555 01",
    phonePlan(null, "US"),
  );
  assertEquals(short.kind, "retry");
  // An unknown chip country is refused.
  assertEquals(
    retryProblem(resolve(
      "Contact phone",
      " Country: ZZ Response: 555 0134",
      phonePlan(null, "US"),
    )),
    "Choose the country for this phone number.",
  );
});

Deno.test("#2830 the phone submission carries the chip country back to the server", () => {
  const parsed = websiteSetupContextAnswer(
    submission("Contact phone", "\nCountry: US\nResponse: 212 555 0134"),
  );
  assertEquals(parsed?.fieldKey, "contact_phone");
  assertEquals(parsed?.country, "US");
  assertEquals(parsed?.response, "212 555 0134");
  assertEquals(parsed?.ownerWords, "Country: US Response: 212 555 0134");
  assertEquals(
    isAriRenditionInputField({
      id: "contact-phone",
      label: "Contact phone",
      value: "",
      kind: "text",
      countryIso: "US",
    }),
    false,
  );
});

Deno.test("#2830 public links are https only and map known hosts", () => {
  assertEquals(websiteSetupSocialKey("www.instagram.com"), "instagram");
  assertEquals(websiteSetupSocialKey("tiktok.com"), "tiktok");
  assertEquals(websiteSetupSocialKey("twitter.com"), "x");
  assertEquals(websiteSetupSocialKey("x.com"), "x");
  assertEquals(websiteSetupSocialKey("m.facebook.com"), "facebook");
  assertEquals(websiteSetupSocialKey("youtube.com"), "youtube");
  assertEquals(websiteSetupSocialKey("uk.linkedin.com"), "linkedin");
  assertEquals(websiteSetupSocialKey("threads.net"), "threads");
  assertEquals(websiteSetupSocialKey("northstar.travel"), "website");
  assertEquals(websiteSetupSocialKey("notinstagram.com"), "website");

  assertEquals(websiteSetupLinks("https://instagram.com/northstar"), {
    ok: true,
    value: { instagram: "https://instagram.com/northstar" },
  });
  // A bare domain is upgraded only when unambiguous.
  assertEquals(websiteSetupLinks("northstar.travel"), {
    ok: true,
    value: { website: "https://northstar.travel" },
  });
  assertEquals(
    websiteSetupLinks("Our site is www.northstar.travel and instagram.com/northstar"),
    {
      ok: true,
      value: {
        website: "https://www.northstar.travel",
        instagram: "https://instagram.com/northstar",
      },
    },
  );
  assertEquals(websiteSetupLinks("We build with Node.js mostly").ok, false);
  assertEquals(websiteSetupLinks("@northstar").ok, false);
});

Deno.test("#2830 http links are refused with a clear question", () => {
  const http = websiteSetupLinks("http://northstar.travel");
  assertEquals(http.ok, false);
  const problem = retryProblem(
    resolve("Public website or social link", " Response: http://northstar.travel"),
  );
  assertStringIncludes(problem, "isn’t secure");
  assertStringIncludes(problem, "https://");
});

Deno.test("#2830 link answers merge with saved links instead of erasing them", () => {
  const args = proposalArgs(resolve(
    "Public website or social link",
    " Response: https://www.tiktok.com/@northstar",
    contextPlan([{
      key: "social_links",
      value: {
        social_links: {
          instagram: "https://instagram.com/northstar",
          website: "http://old.example",
        },
        custom_links: [],
      },
    }]),
  ));
  assertEquals(args.patch, {
    social_links: {
      instagram: "https://instagram.com/northstar",
      tiktok: "https://www.tiktok.com/@northstar",
    },
  });
  assertStringIncludes(String(args.why), "TikTok");
});

Deno.test("#2830 city and country require both, with an explicit country", () => {
  assertEquals(websiteSetupCityCountry("Lisbon, Portugal"), {
    ok: true,
    value: { city: "Lisbon", country_code: "PT" },
  });
  assertEquals(websiteSetupCityCountry("London United Kingdom"), {
    ok: true,
    value: { city: "London", country_code: "GB" },
  });
  assertEquals(websiteSetupCityCountry("Austin, Texas, USA"), {
    ok: true,
    value: { city: "Austin, Texas", country_code: "US" },
  });
  assertEquals(websiteSetupCityCountry("Lagos, NG"), {
    ok: true,
    value: { city: "Lagos", country_code: "NG" },
  });
  // Never guessed from the city alone.
  assertEquals(websiteSetupCityCountry("Lisbon").ok, false);
  assertEquals(websiteSetupCityCountry("Paris").ok, false);
  // Country without a city is incomplete.
  assertEquals(websiteSetupCityCountry("Portugal").ok, false);
  // Alias codes save their canonical country, never the alias.
  assertEquals(websiteSetupCityCountry("Leeds, UK"), {
    ok: true,
    value: { city: "Leeds", country_code: "GB" },
  });
  // A US state code is never read as a country code.
  const ambiguous = websiteSetupCityCountry("Los Angeles, CA");
  assertEquals(ambiguous.ok, false);
  assertStringIncludes(
    ambiguous.ok ? "" : ambiguous.problem,
    "could be a state or a country",
  );
  const args = proposalArgs(resolve("City and country", " Response: Lisbon, Portugal"));
  assertEquals(args.patch, { city: "Lisbon", country_code: "PT" });
  assertEquals(retryProblem(resolve("City and country", " Response: Lisbon")).includes("won’t guess"), true);
});

Deno.test("#2830 theme looks map to complete schema-valid theme patches", () => {
  const fonts = new Set([
    "inter", "poppins", "space_grotesk", "plus_jakarta_sans", "manrope",
    "playfair_display", "dm_serif_display", "fraunces", "lora", "bebas_neue",
    "anton", "unbounded", "caveat", "dancing_script",
  ]);
  const motions = new Set([
    "none", "confetti", "fireworks", "balloons", "sparkles", "glitter_shower",
    "snowfall", "falling_petals", "hearts", "shimmer_reveal",
  ]);
  assertEquals(WEBSITE_SETUP_THEME_PRESETS.length, 3);
  for (const preset of WEBSITE_SETUP_THEME_PRESETS) {
    assertMatch(preset.theme.color, /^#[0-9a-fA-F]{6}$/);
    assertEquals(fonts.has(preset.theme.font), true, preset.theme.font);
    assertEquals(motions.has(preset.theme.animation), true, preset.theme.animation);
    const args = proposalArgs(
      resolve("Mingla page theme", ` Choices: ${preset.label}`),
    );
    assertEquals(args.patch, { theme: { ...preset.theme } });
  }
  assertStringIncludes(
    retryProblem(resolve("Mingla page theme", " Response: something purple")),
    "Pick one of the three looks",
  );
  const presentation = buildWebsiteSetupRetryPresentation({
    fieldKey: "theme",
    field: { label: "Mingla page theme" },
    brandId: BRAND_ID,
    problem: "Pick one.",
  });
  const serialized = JSON.stringify(presentation.rendition);
  for (const preset of WEBSITE_SETUP_THEME_PRESETS) {
    assertStringIncludes(serialized, preset.label);
    assertStringIncludes(serialized, preset.detail);
  }
});

Deno.test("#2830 owner not-applicable answers become exceptions only where allowed", () => {
  const args = proposalArgs(
    resolve("Address", " Response: We don't have a street address, we meet at the pier"),
  );
  assertEquals(args.patch, undefined);
  assertEquals(args.exceptions, [{
    field_key: "address",
    reason: "We don't have a street address, we meet at the pier",
  }]);
  assertStringIncludes(String(args.why), "should not show a street address");
  // A value beats a passing "we don't have" phrase.
  const withValue = proposalArgs(
    resolve(
      "Public website or social link",
      " Response: We don't have a website, but instagram.com/northstar",
    ),
  );
  assertEquals(withValue.patch, {
    social_links: { instagram: "https://instagram.com/northstar" },
  });
  // Required identity fields can never be skipped.
  assertStringIncludes(
    retryProblem(resolve("Brand name", " Response: not applicable")),
    "can’t be skipped",
  );
});

Deno.test("#2830 invalid answers re-ask the same question and write nothing", () => {
  const presentation = buildWebsiteSetupRetryPresentation({
    fieldKey: "contact_phone",
    field: { key: "contact_phone", label: "Contact phone" },
    brandId: BRAND_ID,
    problem: "That number doesn’t include a country code, and I won’t guess one.",
  });
  const serialized = JSON.stringify(presentation.rendition);
  assertStringIncludes(serialized, "Nothing was saved");
  assertStringIncludes(serialized, "Continue with Ari");
  assertStringIncludes(serialized, `Use my answer for Contact phone`);
  assertEquals(serialized.includes("update_brand_context"), false);
  // Owner-visible copy never carries tool names or snake_case keys.
  const visible = [
    presentation.text,
    presentation.rendition.title,
    presentation.rendition.body,
  ].join(" ");
  assertEquals(/\b[a-z]+_[a-z_]+\b/.test(visible), false, visible);
  assertEquals(
    retryProblem(resolve("Contact email", "")).startsWith("I didn’t get an answer"),
    true,
  );
});

Deno.test("#2830 approval is an owner handoff to the plan's approve part, never an Ari write", () => {
  const presentation = buildWebsiteSetupPresentation(
    "fix_all",
    [
      observation("get_site_plan", plan),
      observation("start_brand_completeness_job", {
        resumed: true,
        job: {
          status: "queued",
          pending_step_keys: ["approved_plan"],
          completed_step_keys: ["name", "design_key"],
          checkpoint: { current_step: "approved_plan" },
        },
        completeness: {
          fields: [{
            key: "approved_plan",
            label: "Owner-approved plan",
            requirement: "required",
            state: "missing",
          }],
        },
      }),
    ],
    "North Star",
    BRAND_ID,
  );
  const serialized = JSON.stringify(presentation?.rendition ?? {});
  assertStringIncludes(
    serialized,
    `/brand/${BRAND_ID}/website/plan?part=approve`,
  );
  assertStringIncludes(serialized, "Review and approve the plan");
  assertStringIncludes(serialized, "Ari never approves");
  assertEquals(serialized.includes("Review the plan now"), false);
  assertEquals(serialized.includes("Keep working"), false);
  assertEquals(serialized.includes("Continue with Ari"), false);
  assertEquals(serialized.includes("Use my answer for"), false);
  // Even a crafted approval submission is never turned into a write.
  const crafted = resolve("Owner-approved plan", " Choices: Review the plan now");
  assertEquals(crafted.kind, "retry");
  assertStringIncludes(retryProblem(crafted), "Only you can approve");
});

Deno.test("#2830 logo and cover are upload handoffs to the exact Brand details section", () => {
  for (
    const [key, label, section] of [
      ["profile_photo", "Brand logo", "photo"],
      ["cover_media", "Cover media", "cover"],
    ] as const
  ) {
    const presentation = buildWebsiteSetupPresentation(
      "fix_all",
      [
        observation("get_site_plan", plan),
        observation("start_brand_completeness_job", {
          resumed: true,
          job: {
            status: "queued",
            pending_step_keys: [key, "approved_plan"],
            completed_step_keys: ["name"],
            checkpoint: { current_step: key },
          },
          completeness: {
            fields: [{
              key,
              label,
              requirement: "recommended",
              state: "missing",
              human_action_required: true,
            }],
          },
        }),
      ],
      "North Star",
      BRAND_ID,
    );
    const serialized = JSON.stringify(presentation?.rendition ?? {});
    assertStringIncludes(serialized, `/brand/${BRAND_ID}/edit?section=${section}`);
    assertStringIncludes(serialized, "re-check it and continue");
    assertStringIncludes(serialized, "I’ve uploaded it");
    assertEquals(serialized.includes("Continue with Ari"), false);
    assertEquals(serialized.includes("https://"), false);
    const crafted = resolve(label, " Response: https://cdn.example.com/logo.png");
    assertEquals(crafted.kind, "retry");
  }
});

Deno.test("#2830 returning from a handoff resumes the durable job on a fresh read", () => {
  for (
    const message of [
      WEBSITE_SETUP_RETURN_MESSAGES.uploaded,
      WEBSITE_SETUP_RETURN_MESSAGES.approved,
    ]
  ) {
    assertEquals(detectWebsiteSetupIntent(message), "fix_all");
  }
  for (const message of ["I uploaded it", "Done", "Continue Website setup"]) {
    assertEquals(
      websiteSetupEffectiveIntent({
        intent: detectWebsiteSetupIntent(message),
        message,
        workflow: true,
        activeFixAllJob: true,
      }),
      "fix_all",
      message,
    );
  }
  // Without an active job, or outside the workflow, nothing is upgraded.
  assertEquals(
    websiteSetupEffectiveIntent({
      intent: null,
      message: "I uploaded it",
      workflow: true,
      activeFixAllJob: false,
    }),
    null,
  );
  assertEquals(
    websiteSetupEffectiveIntent({
      intent: "audit",
      message: "Review every remaining Website setup gap with me, one at a time.",
      workflow: true,
      activeFixAllJob: true,
    }),
    "audit",
  );
  assertEquals(
    websiteSetupWorkflowInitialCalls({
      intent: "fix_all",
      brandId: BRAND_ID,
      activeFixAllJob: true,
    }).map((call) => call.name),
    ["get_site_plan", "start_brand_completeness_job"],
  );
});

Deno.test("#2830 the offerings answer accepts the audit's label", () => {
  assertEquals(
    websiteSetupPlanAnswer(
      submission("What you offer", " Choices: Events"),
    )?.answers,
    { offerings_selected: ["events"] },
  );
});

Deno.test("#2830 links are asked like the form: pick the platform, paste its link", () => {
  assertEquals(
    WEBSITE_SETUP_LINK_PLATFORMS.map((platform) => platform.label),
    ["Website", "Instagram", "TikTok", "X", "Facebook", "YouTube", "LinkedIn", "Threads"],
  );
  const presentation = buildWebsiteSetupRetryPresentation({
    fieldKey: "social_links",
    field: { key: "social_links", label: "Public website or social link" },
    brandId: BRAND_ID,
    problem: "Paste the link.",
  });
  const serialized = JSON.stringify(presentation.rendition);
  assertStringIncludes(serialized, '"selection":"single"');
  assertStringIncludes(serialized, '"kind":"url"');
  assertEquals(
    proposalArgs(resolve(
      "Public website or social link",
      " Choices: Instagram Response: https://www.instagram.com/northstar",
    )).patch,
    { social_links: { instagram: "https://www.instagram.com/northstar" } },
  );
  // The website box takes any page, as in the form.
  assertEquals(
    proposalArgs(resolve(
      "Public website or social link",
      " Choices: Website Response: northstar.travel",
    )).patch,
    { social_links: { website: "https://northstar.travel" } },
  );
  // A platform box refuses another platform's link.
  assertStringIncludes(
    retryProblem(resolve(
      "Public website or social link",
      " Choices: Instagram Response: https://tiktok.com/@northstar",
    )),
    "That link isn’t for Instagram",
  );
});

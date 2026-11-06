// #4273 wave B — the Blast selection model.
// MINGLA-INVARIANT: I-4273-PREFILL-NEVER-RAW-OR-COSTLIER | issue #4273 | Text auto-filled from an email into SMS or push carries no HTML, event card or unsupported {token}, and auto-filled SMS fits one segment with its STOP footer.
import {
  audienceButtonName,
  audienceSourceDetail,
  combinedCountCaption,
  emailBodyToPlainText,
  followerRowStatus,
  leadBlastChannel,
  needsCombinedLane,
  pickerDoneLabel,
  prefillPushFromEmail,
  prefillSmsFromEmail,
  pushTitleFromSubject,
  reconcileBlastChannels,
  sendByUnavailable,
  sourceKeyForOption,
  sourceKeysForDefinition,
  stripUnsupportedTokens,
  toggleBlastChannel,
  PUSH_AUDIENCE_LIMIT,
  pushBuyerListReason,
  PUSH_PREFILL_MAX,
  SMS_PREFILL_MAX_GSM,
} from "../blastSendModel";
import { readFileSync } from "fs";
import path from "path";
import { computeSegments, isGsm7, sanitizeGsm7, wireBody } from "../../../utils/smsCost";

const measure = { isGsm7, sanitizeGsm7 };
const LONG = `<p>${"Live band from 8pm, kitchen open till late. ".repeat(12)}</p>`;

describe("#4273 Send by", () => {
  it("at least one method always stays on", () => {
    expect(toggleBlastChannel(["email"], "email")).toBeNull();
    expect(toggleBlastChannel(["email"], "push")).toEqual(["email", "push"]);
    expect(toggleBlastChannel(["push", "email"], "email")).toEqual(["push"]);
  });

  it("the lead follows the display order", () => {
    expect(leadBlastChannel(["push", "sms"])).toBe("sms");
    expect(leadBlastChannel(["push"])).toBe("push");
  });

  it("a buyer list turns Push off for the whole selection, never a subset", () => {
    const reasons = sendByUnavailable({
      sourceKeys: ["book", "event:e1"],
      combinedAllowed: true,
      sealedAudience: true,
      lead: "email",
    });
    // #4273 — the reason names the buyer list, not "pick Your Book…".
    expect(reasons).toEqual({ push: pushBuyerListReason([]) });
    expect(reconcileBlastChannels(["email", "push"], reasons)).toEqual(["email"]);
    // Push alone falls back to the first method still available.
    expect(reconcileBlastChannels(["push"], reasons)).toEqual(["email"]);
  });

  it("Your Book + Followers keeps every method", () => {
    expect(sendByUnavailable({
      sourceKeys: ["book", "followers"],
      combinedAllowed: true,
      sealedAudience: true,
      lead: "email",
    })).toEqual({});
  });

  it("a method switched off for a picked group says so", () => {
    expect(sendByUnavailable({
      sourceKeys: ["followers"],
      combinedAllowed: true,
      sealedAudience: true,
      lead: "email",
      followersEnabled: { email: true, sms: false, push: true },
    }).sms).toContain("Followers");
  });

  it("without the combined lane, a plain buyer list keeps one method at a time", () => {
    expect(sendByUnavailable({
      sourceKeys: ["brand_buyers"],
      combinedAllowed: false,
      sealedAudience: false,
      lead: "email",
    })).toEqual({ sms: PUSH_AUDIENCE_LIMIT, push: pushBuyerListReason([]) });
  });
});

describe("#4273 which lane", () => {
  it("one group by one method stays on its existing lane", () => {
    expect(needsCombinedLane(["book"], ["email"])).toBe(false);
    expect(needsCombinedLane(["brand_buyers"], ["sms"])).toBe(false);
    expect(needsCombinedLane([], ["email", "sms"])).toBe(false);
  });
  it("several groups or several methods travel combined", () => {
    expect(needsCombinedLane(["book", "followers"], ["email"])).toBe(true);
    expect(needsCombinedLane(["book"], ["email", "push"])).toBe(true);
  });
  it("Followers who are all in the Book need the combined lane to be reached", () => {
    expect(needsCombinedLane(["followers"], ["email"], 1)).toBe(true);
    expect(needsCombinedLane(["followers"], ["email"], 0)).toBe(false);
  });
  it("maps rows and saved audiences to the server's keys", () => {
    expect(sourceKeyForOption({ kind: "manual_group", target_id: "g1" })).toBe("group:g1");
    expect(sourceKeyForOption({ kind: "event_buyers", target_id: "e1" })).toBe("event:e1");
    expect(sourceKeysForDefinition("a1", { kind: "manual_group" })).toEqual(["group:a1"]);
    expect(sourceKeysForDefinition("a1", { kind: "combined_sources", sources: ["book", "followers"] }))
      .toEqual(["book", "followers"]);
    expect(sourceKeysForDefinition("a1", null)).toEqual([]);
  });
});

describe("#4273 wording", () => {
  it("the Done button shows the server's total, never a sum", () => {
    expect(pickerDoneLabel({ state: "ready", people: 3 })).toBe("Done · 3 people");
    expect(pickerDoneLabel({ state: "ready", people: 1 })).toBe("Done · 1 person");
    expect(pickerDoneLabel({ state: "none" })).toBe("Pick at least one group");
    expect(pickerDoneLabel({ state: "unavailable" })).toBe("Done");
  });
  it("a follower who is in the Book is named, not hidden as no followers", () => {
    expect(followerRowStatus({ reachCount: 0, followersTotal: 1, followersAlsoInBook: 1 })?.countLabel)
      .toBe("1 follower · also in Your Book");
    expect(followerRowStatus({ reachCount: 2, followersTotal: 3, followersAlsoInBook: 1 })?.countLabel)
      .toBe("3 followers · 1 also in Your Book");
    expect(followerRowStatus({ reachCount: 0, followersTotal: 0, followersAlsoInBook: 0 })).toBeNull();
  });
  it("names several groups with one count", () => {
    expect(audienceButtonName(["Your Book", "Followers"])).toBe("Your Book + Followers");
    expect(audienceButtonName(["A", "B", "C", "D", "E"])).toBe("A + B + 3 more");
    expect(combinedCountCaption(3)).toBe("3 people · each counted once");
    expect(audienceSourceDetail({ key: "followers", count: 1, alsoInBookCount: 1 }))
      .toBe("1 person, also in Your Book");
    expect(audienceSourceDetail({ key: "book", count: 3, alsoInBookCount: 3 })).toBe("3 people");
  });
});

describe("#4273 pre-fill", () => {
  it("is plain text: no HTML, entities or event cards", () => {
    expect(emailBodyToPlainText('<p>Doors <b>at 9</b>&nbsp;&amp; late</p>{{event:abc|compact}}<p>See you</p>'))
      .toBe("Doors at 9 & late See you");
  });

  it("tokens the SMS and push lanes cannot fill never reach a person raw", () => {
    expect(stripUnsupportedTokens("Hi {first_name}, {brand_name} opens {event_date}.", "Harmattan"))
      .toBe("Hi, Harmattan opens.");
    const sms = prefillSmsFromEmail(
      { subject: "{first_name}, see {event_name}", bodyHtml: "<p>Hi {first_name}!</p>", brandName: "Harmattan" },
      measure,
    );
    const push = prefillPushFromEmail({ bodyHtml: "<p>Hi {first_name}! {{event:x}}</p>", brandName: "H" });
    for (const text of [sms, push, pushTitleFromSubject("Hello {first_name}", "H")]) {
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it("names the brand and the subject, then the words", () => {
    expect(prefillSmsFromEmail(
      { subject: "Highlife Live is this Saturday", bodyHtml: "<p>Live band from 8pm.</p>", brandName: "Harmattan Club" },
      measure,
    )).toBe("Harmattan Club: Highlife Live is this Saturday. Live band from 8pm.");
  });

  it("a long email fits one text with its STOP footer, so it costs no more", () => {
    const sms = prefillSmsFromEmail({ subject: "Highlife", bodyHtml: LONG, brandName: "Harmattan" }, measure);
    expect(sms.length).toBeLessThanOrEqual(SMS_PREFILL_MAX_GSM);
    expect(sms.endsWith("...")).toBe(true);
    expect(computeSegments(wireBody(sms))).toBe(1);
  });

  it("curly quotes fold first; text that must stay Unicode still fits one segment", () => {
    const curly = prefillSmsFromEmail({ subject: "Don’t miss it", bodyHtml: LONG, brandName: null }, measure);
    expect(curly).toContain("Don't");
    expect(computeSegments(wireBody(curly))).toBe(1);
    const emoji = prefillSmsFromEmail({ subject: "Tonight 🎉", bodyHtml: LONG, brandName: null }, measure);
    expect(computeSegments(wireBody(emoji))).toBe(1);
  });

  it("push fits the 120 characters; empty email stays empty", () => {
    expect(prefillPushFromEmail({ bodyHtml: LONG, brandName: null }).length).toBeLessThanOrEqual(PUSH_PREFILL_MAX);
    expect(prefillPushFromEmail({ bodyHtml: "", brandName: null })).toBe("");
    expect(prefillSmsFromEmail({ subject: "", bodyHtml: "<p></p>", brandName: "H" }, measure)).toBe("");
  });
});

describe("#4273 composer wiring", () => {
  const compose = readFileSync(
    path.join(__dirname, "../../../../app/(tabs)/marketing/campaigns/compose.tsx"),
    "utf8",
  );

  it("the tiles read the server's group figures, never a client sum", () => {
    expect(compose).toContain("selectedCount={groupFigures?.selectedCount");
    expect(compose).toContain("groupFigures.reachableCount");
    expect(compose).not.toMatch(/reachableCount\s*\+/);
  });

  it("SMS and push leave the composer with no unsupported token", () => {
    expect(compose).toContain("body: stripUnsupportedTokens(pushBody, brandName)");
    expect(compose).toContain("body: stripUnsupportedTokens(smsBody, brandName)");
  });

  it("both previews get a tab per ticked method", () => {
    expect(compose.match(/<ComposerPreviewTabs/g)).toHaveLength(2);
    expect(compose).not.toContain("CampaignChannelSelector");
  });
});

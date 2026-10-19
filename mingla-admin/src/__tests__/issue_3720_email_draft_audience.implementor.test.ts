import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { restoreDraftAudience } from "../lib/emailDraftAudience.js";

// MINGLA-INVARIANT: I-3720-EMAIL-DRAFT-HOST-DEFAULT | issue #3720 | A restored Admin email draft never pre-selects an audience that reaches Explorer users; it falls back to Hosts and keeps the rest of the draft.

const DEFAULTS = {
  userType: "host",
  country: "all",
  onboarding: "all",
  accountStatus: "all",
  emailStatus: "all",
  language: "all",
  beta: "all",
  joinedFrom: "",
  joinedTo: "",
};

Deno.test("#3720 a saved Everyone draft restores as Hosts", () => {
  const restored = restoreDraftAudience({ version: 1, audienceMode: "everyone", filters: DEFAULTS }, DEFAULTS);
  assertEquals(restored.audienceMode, "segment");
  assertEquals(restored.filters.userType, "host");
});

Deno.test("#3720 Explorer and all-user segments restore as Hosts", () => {
  for (const userType of ["explorer", "all", undefined]) {
    const restored = restoreDraftAudience(
      { version: 1, audienceMode: "segment", filters: { ...DEFAULTS, userType, country: "NG" } },
      DEFAULTS,
    );
    assertEquals(restored, { audienceMode: "segment", filters: { ...DEFAULTS, userType: "host" } });
  }
});

Deno.test("#3720 host-only drafts keep their filters; one chosen person is kept", () => {
  const host = restoreDraftAudience(
    { version: 2, audienceMode: "segment", filters: { ...DEFAULTS, country: "GB" } },
    DEFAULTS,
  );
  assertEquals(host.filters.country, "GB");
  assertEquals(host.filters.userType, "host");
  const person = restoreDraftAudience(
    { version: 2, audienceMode: "person", selectedRecipient: { profile_id: "p1" }, filters: DEFAULTS },
    DEFAULTS,
  );
  assertEquals(person.audienceMode, "person");
  const orphan = restoreDraftAudience({ version: 2, audienceMode: "person", filters: DEFAULTS }, DEFAULTS);
  assertEquals(orphan.audienceMode, "segment");
  assertEquals(restoreDraftAudience(null, DEFAULTS).filters.userType, "host");
});

Deno.test("#3720 the composer restores drafts only through the host-default guard", async () => {
  const composer = await Deno.readTextFile(new URL("../components/email/EmailComposer.jsx", import.meta.url));
  assertMatch(composer, /restoreDraftAudience\(saved, EMPTY_FILTERS\)/);
  assertNotMatch(composer, /\["everyone", "segment", "person"\]\.includes\(saved\.audienceMode\)/);
  assertNotMatch(composer, /setAudienceMode\(saved\.audienceMode\)/);
});

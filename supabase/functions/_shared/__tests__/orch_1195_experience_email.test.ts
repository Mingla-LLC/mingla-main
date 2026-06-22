// ORCH-1195 FIX 4 — the experience confirmation email must include the itinerary
// (experience_stops), labelled Start Here / Then / End With, and use an
// experience-shaped subject — instead of falling through to the generic event
// template (which had no stops). 0-stop experiences degrade gracefully.
import { assert } from "jsr:@std/assert@1";
Deno.env.set("DENO_TESTING", "1"); // requireEnv fallbacks for logo/footer/from
const { renderExperienceConfirmationEmail } = await import(
  "../email/experienceConfirmationEmail.ts"
);

const base = {
  recipient: { name: "Ethan", email: "e@x.com" },
  brand: { name: "Lantern & Vine", profilePhotoUrl: null },
  order: { id: "ord_1", shortId: "AB12CD", totalCents: 14000, currency: "USD" },
};

Deno.test("renders stops as a labelled itinerary + experience subject", () => {
  const r = renderExperienceConfirmationEmail({
    ...base,
    experience: {
      title: "Raleigh Wine and Dine Crawl",
      dateIso: "2026-06-21T18:00:00Z",
      timezone: "America/New_York",
      venueText: "Raleigh, USA",
      stops: [
        { stopOrder: 0, placeName: "Sparkling Welcome Flight", address: "Fayetteville St", startTime: "18:00", priceCents: 3500 },
        { stopOrder: 1, placeName: "Rooftop Nightcap", address: "Glenwood Ave", startTime: "20:30", priceCents: 3500 },
      ],
    },
  });
  assert(r.subject.includes("You're reserved"), "experience subject");
  assert(r.subject.includes("Raleigh Wine and Dine Crawl"), "title in subject");
  assert(r.html.includes("Sparkling Welcome Flight"), "stop 1 in body");
  assert(r.html.includes("Rooftop Nightcap"), "stop 2 in body");
  assert(r.html.includes("Start Here"), "first-stop label");
  assert(r.html.includes("End With"), "last-stop label");
  assert(r.text.includes("Sparkling Welcome Flight"), "stop in text part");
  assert(r.from.address.length > 0, "from address resolved");
});

Deno.test("0-stop experience degrades gracefully (no itinerary block, still sends)", () => {
  const r = renderExperienceConfirmationEmail({
    ...base,
    experience: {
      title: "Open Studio",
      dateIso: "2026-06-21T18:00:00Z",
      timezone: "America/New_York",
      venueText: null,
      stops: [],
    },
  });
  assert(r.subject.includes("You're reserved"), "still experience subject");
  assert(!r.html.includes("Your itinerary"), "no itinerary heading when no stops");
  assert(r.html.includes("Open Studio"), "title still present");
});

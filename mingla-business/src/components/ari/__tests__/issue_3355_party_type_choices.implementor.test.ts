/**
 * #3355 P7 — Ari's "What kind of event is it?" card lists all 15 canonical
 * party types. The client capped a choices block at 12 options and dropped the
 * whole card, so the owner saw the question with nothing to pick.
 */
import {
  MAX_CHOICE_OPTIONS,
  parseAriRendition,
} from "../renditions/ariRenditionProtocol";

const PARTY_TYPES = [
  "Birthday Party",
  "Rooftop Party",
  "Club Night",
  "House Party",
  "Warehouse Party",
  "Beach Party",
  "Pool Party",
  "Boat Party",
  "Themed Party",
  "Corporate Event",
  "Graduation Party",
  "Holiday Party",
  "Networking Event",
  "Rave",
  "Festival",
];

const partyTypeCard = (labels: string[]) => ({
  schema_version: 2,
  rendition_id: "q:run:question",
  kind: "event-setup",
  title: "Party type",
  body: "What kind of event is it? Pick one or more.",
  eyebrow: "New event",
  blocks: [
    {
      id: "party_types-choices",
      type: "choices",
      version: 1,
      selection: "multiple",
      options: labels.map((label) => ({
        id: label.toLowerCase().replace(/\s+/g, "-"),
        label,
      })),
    },
  ],
  actions: [
    {
      id: "continue-with-ari",
      label: "Continue",
      style: "primary",
      behavior: { type: "submit", message: "Use my answer" },
    },
  ],
});

describe("#3355 the party type card shows every party type", () => {
  it("parses a choices block carrying all 15 party types", () => {
    const rendition = parseAriRendition(partyTypeCard(PARTY_TYPES));
    expect(rendition).not.toBeNull();
    if (rendition?.schema_version !== 2) return;
    const block = rendition.blocks[0];
    expect(block.type).toBe("choices");
    if (block.type !== "choices") return;
    expect(block.options.map((option) => option.label)).toEqual(PARTY_TYPES);
  });

  it("still refuses an unbounded list", () => {
    const tooMany = Array.from(
      { length: MAX_CHOICE_OPTIONS + 1 },
      (_, index) => `Option ${index + 1}`,
    );
    expect(parseAriRendition(partyTypeCard(tooMany))).toBeNull();
  });
});

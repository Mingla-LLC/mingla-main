/**
 * issue #3281 R2 — guest unit labels + options fallback.
 */
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  experienceBlockLengthLabel,
  experienceOfferingOptions,
  experiencePriceBasisLabel,
  parseExperiencePriceBasis,
  type ExperiencePriceBasis,
} from "../experiencePriceBasis.ts";

Deno.test("#3281 R2 basis labels", () => {
  assertEquals(experiencePriceBasisLabel("person"), "per person");
  assertEquals(experiencePriceBasisLabel("group"), "per group");
  assertEquals(experiencePriceBasisLabel("block", 30), "per 30 min");
  assertEquals(experiencePriceBasisLabel(undefined), "per person");
});

Deno.test("#3281 R2 options fallback to ticket", () => {
  const ticket: { ticketTypeId: string; name: string; priceBasis: ExperiencePriceBasis } = {
    ticketTypeId: "t1",
    name: "Standard",
    priceBasis: "person",
  };
  assertEquals(experienceOfferingOptions({ ticket, options: undefined }), [
    ticket,
  ]);
  assertEquals(
    experienceOfferingOptions({
      ticket,
      options: [
        { ticketTypeId: "t2", name: "Group", priceBasis: "group" },
        { ticketTypeId: "t3", name: "Hourly", priceBasis: "block" },
      ],
    }).length,
    2,
  );
});

Deno.test("#3281 R2 block length label + parse", () => {
  assertEquals(experienceBlockLengthLabel(1, 60), "1 hour");
  assertEquals(experienceBlockLengthLabel(2, 60), "2 hours");
  assertEquals(experienceBlockLengthLabel(1, 30), "30 min");
  assertEquals(parseExperiencePriceBasis("block"), "block");
  assertEquals(parseExperiencePriceBasis("nope"), undefined);
});

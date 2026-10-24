import { describe, expect, it } from "vitest";
import { isRecapWorkCard, stateName } from "../opsModel";

describe("#3988 post-event lifecycle presentation", () => {
  it("uses Happened for the completed event state", () => {
    expect(stateName({ k: "done" })).toBe("Happened");
  });

  it("identifies only the generated recap work cards", () => {
    expect(isRecapWorkCard({ title: "Recap Foodie Fantasy: sales, check-ins, what to repeat" })).toBe(true);
    expect(isRecapWorkCard({ title: "Follow up with Foodie Fantasy" })).toBe(false);
  });
});

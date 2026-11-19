/**
 * #4453 Website workspace — a refused change says what was wrong. Core relays
 * the limit or the problems Studio found; the owner reads a plain sentence,
 * never a request field name, and never just "something needs fixing".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { plainProblem, refusalDetailFrom, refusalSentence } from "../refusalCopy";

describe("what Core relayed is read, bounded", () => {
  it("keeps the limits and the problems", () => {
    expect(refusalDetailFrom({ code: "VALUE_TOO_LONG", key: "heading", max: 120 })).toEqual({ max: 120 });
    expect(refusalDetailFrom({ code: "VALIDATION_FAILED", problems: ["  this section needs at least 1 photo ", 4, ""] })).toEqual({ problems: ["this section needs at least 1 photo"] });
  });
  it("is null when there is nothing usable", () => {
    expect(refusalDetailFrom(null)).toBeNull();
    expect(refusalDetailFrom({ code: "VALIDATION_FAILED" })).toBeNull();
    expect(refusalDetailFrom({ max: -1, min: 1.5, problems: "x" })).toBeNull();
  });
});

describe("a problem is shown only when it is plain words", () => {
  it.each([
    ["this section always needs that picture; choose another one instead", "This section always needs that picture; choose another one instead."],
    ["that page is a Draft from Ari: publish or remove it from the Pages screen", "That page is a Draft from Ari: publish or remove it from the Pages screen."],
    ["the home page keeps its top picture", "The home page keeps its top picture."],
    ["heading must be plain text", "Heading must be plain text."],
  ])("%s", (problem, shown) => {
    expect(plainProblem(problem)).toBe(shown);
  });
  it.each([
    "list_ops[0].values",
    "media_id",
    "slot",
    "edits[2] needs a key and a value",
    "items.0.question must be plain text",
    "to_index is not a place on that page",
    "step.op must be one of edit_section, move_section",
    "group_id must be a uuid",
  ])("never shows %s", (problem) => {
    expect(plainProblem(problem)).toBeNull();
  });
});

describe("the owner's sentence", () => {
  const base = "That is too long for this spot. Shorten it a little.";
  it("says how long the words may be", () => {
    expect(refusalSentence("VALUE_TOO_LONG", base, { max: 80 })).toBe("That is too long for this spot. Keep it to 80 characters.");
    expect(refusalSentence("VALUE_TOO_LONG", base, null)).toBe(base);
  });
  it("says how many rows a list holds or needs", () => {
    expect(refusalSentence("LIST_LIMIT_REACHED", "full", { max: 6 })).toBe("That list holds 6 rows at most. Remove a row before adding another.");
    expect(refusalSentence("LIST_ROW_REQUIRED", "stays", { min: 1 })).toBe("That list needs at least 1 row, so this one stays.");
  });
  it("says what was wrong with a change that did not pass its checks", () => {
    expect(refusalSentence("VALIDATION_FAILED", "", { problems: ["this section needs at least 1 photo"] }))
      .toBe("That change wasn’t made. This section needs at least 1 photo.");
  });
  it("falls back to the code's own sentence when the problems are not plain words", () => {
    expect(refusalSentence("VALIDATION_FAILED", "", { problems: ["media_id", "list_ops[0].values"] })).toBe("");
    expect(refusalSentence("VALIDATION_FAILED", "Something needs fixing.", { problems: ["slot"] })).toBe("Something needs fixing.");
  });
  it("adds the reason a section has to stay", () => {
    expect(refusalSentence("SECTION_CANNOT_BE_REMOVED", "Your website needs this section, so it can’t be removed.", { problems: ["the home page keeps its top picture"] }))
      .toBe("Your website needs this section, so it can’t be removed. The home page keeps its top picture.");
  });
  it("never shows a code or a field name", () => {
    for (const code of ["VALUE_TOO_LONG", "VALIDATION_FAILED", "LIST_LIMIT_REACHED", "LIST_ROW_REQUIRED", "SECTION_LIMIT_REACHED", "SECTION_CANNOT_BE_REMOVED", "HOME_ALWAYS_ON"]) {
      const sentence = refusalSentence(code, "A plain sentence.", { max: 3, min: 1, problems: ["list_ops[0].values", "this section needs at least 1 photo"] });
      expect(sentence).not.toMatch(/[A-Z]{3,}_|_|\[/);
      expect(sentence.length).toBeGreaterThan(0);
    }
  });
});

describe("every content call uses it", () => {
  const source = readFileSync(resolve(__dirname, "../contentApi.ts"), "utf8");
  it("reads Core's detail before choosing the sentence", () => {
    expect(source).toContain("const detail = refusalDetailFrom(body?.error);");
    expect(source).toContain("refusalSentence(code, CONTENT_MESSAGES[code]!, detail)");
    expect(source).toMatch(/code === "VALIDATION_FAILED"\) \{\s+const sentence = refusalSentence\(code, "", detail\);/);
  });
});

import {
  friendlyWebsiteSetupAnswer,
  websiteSetupProposalCopy,
} from "../websiteSetupProposalCopy";

const HASH = "75b3148665ef39eef03725887025f1bc6499e1e0000000000000000000000000";

describe("#2830 Website setup confirmations read as plain words", () => {
  const contextArgs = (patch: Record<string, unknown>, extra = {}) => ({
    brand_id: "c4e709a1-c810-4f69-bf6f-b72876b2b98e",
    expected_plan_revision: 8,
    expected_context_revision: HASH,
    patch,
    evidence: { source_type: "owner" },
    why: "The owner gave the public street address during Website setup.",
    cites: [{ kind: "owner_words", quote: "Response: 123 Example Street" }],
    ...extra,
  });

  it("shows the saved value and never revisions, hashes or tool names", () => {
    const copy = websiteSetupProposalCopy(
      "update_brand_context",
      contextArgs({ address: "123 Example Street, New York, NY 10001" }),
    )!;
    expect(copy.title).toBe("Save your address");
    expect(copy.verb).toBe("Save to your brand");
    expect(copy.fields).toEqual([
      { label: "Address", value: "123 Example Street, New York, NY 10001" },
    ]);
    const shown = JSON.stringify(copy);
    expect(shown).not.toContain(HASH);
    expect(shown).not.toMatch(/revision|brand_context|evidence|owner_words/i);
  });

  it("formats a phone, links, theme and an owner exception", () => {
    const copy = websiteSetupProposalCopy(
      "update_brand_context",
      contextArgs(
        {
          contact_phone: "+12125550123",
          social_links: { instagram: "https://www.instagram.com/demo" },
          theme: {
            color: "#eb7825",
            font: "fraunces",
            animation: "shimmer_reveal",
          },
        },
        { exceptions: [{ field_key: "address", reason: "We meet online" }] },
      ),
    )!;
    expect(copy.title).toBe("Save your brand details");
    expect(copy.fields).toEqual([
      { label: "Contact phone", value: "+1 (212) 555-0123" },
      { label: "Instagram", value: "https://www.instagram.com/demo" },
      {
        label: "Page theme",
        value: "Colour #EB7825 · Fraunces type · Shimmer reveal motion",
      },
      { label: "Address", value: "Doesn’t apply — “We meet online”" },
    ]);
  });

  it("keeps platform names capitalised in the title", () => {
    expect(
      websiteSetupProposalCopy(
        "update_brand_context",
        contextArgs({
          social_links: { instagram: "https://www.instagram.com/demo" },
        }),
      )!.title,
    ).toBe("Save your Instagram");
  });

  it("covers plan answers and design, and leaves other tools alone", () => {
    expect(
      websiteSetupProposalCopy("save_site_plan_answers", {
        answers: { offerings_selected: ["events", "venue_food_drink"] },
      })!.fields,
    ).toEqual([
      { label: "What you’ll offer", value: "Events, Restaurant, bar or café" },
    ]);
    expect(
      websiteSetupProposalCopy("save_site_plan_design", {
        design_key: "atelier",
      })!.fields,
    ).toEqual([{ label: "Design", value: "Atelier" }]);
    expect(websiteSetupProposalCopy("create_event", {})).toBeNull();
  });

  it("shows the owner's answer as they would say it, not the protocol", () => {
    expect(
      friendlyWebsiteSetupAnswer(
        "Use my answer for Contact phone, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap. Country: US Response: 2125550123",
      ),
    ).toBe("Contact phone: +1 (212) 555-0123");
    expect(
      friendlyWebsiteSetupAnswer(
        "Use my answer for Website design, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap. Choices: Atelier",
      ),
    ).toBe("Website design: Atelier");
    expect(friendlyWebsiteSetupAnswer("Continue Website setup")).toBe(
      "Continue Website setup",
    );
  });

  it("wires both into the card and the owner's bubble", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const card = fs.readFileSync(
      path.resolve(__dirname, "../ToolProposalCard.tsx"),
      "utf8",
    );
    const list = fs.readFileSync(
      path.resolve(__dirname, "../MessageList.tsx"),
      "utf8",
    );
    expect(card).toContain("websiteSetupProposalCopy(toolName, args)");
    expect(list).toContain("friendlyWebsiteSetupAnswer(text)");
  });
});

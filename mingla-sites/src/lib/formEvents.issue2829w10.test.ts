/*
 * #2829 W10 — a sent contact form or newsletter signup counts in the owner's
 * analytics ONLY when the visitor allowed analytics, whether the form was
 * sent with JavaScript (JSON) or without (plain form post). Never on a
 * refused send, never with any of the form's words, and a failed record
 * never changes what the visitor is told.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), formsFunctionsBaseUrl: "http://127.0.0.1:1" }) }));

import { w5Artifact } from "../contracts/w5Content.fixture";
import { clearFormRateLimits, handleFormSubmission, type FormSubmissionDeps } from "./formSubmission";
import { formStampSignature } from "./siteForms";
import type { ResolvedSite } from "./publication";

const artifact = w5Artifact();
const site = { site_id: artifact.site_id } as unknown as ResolvedSite;
const load = async () => ({ artifact, resolution: site });
const RENDERED = 1_760_000_000_000;
const CONSENT = "mingla_site_analytics_consent_v1=granted";

type Recorded = { site: unknown; event: Record<string, unknown> };

function deps(reply: { status: number; body: unknown } = { status: 202, body: { status: "sent" } }, failRecord = false) {
  const recorded: Recorded[] = [];
  const value: FormSubmissionDeps = {
    now: () => RENDERED + 10_000,
    forward: async () => reply,
    availability: async () => "available",
    recordEvent: async (where, event) => {
      if (failRecord) throw new Error("CORE_UNAVAILABLE");
      recorded.push({ site: where, event });
    },
  };
  return { recorded, value };
}

async function body(block: string, patch: Record<string, string> = {}) {
  return {
    page: "contact-us", block, t0: String(RENDERED), ts: await formStampSignature(artifact.site_id, RENDERED), website: "",
    name: "Fixture Person", email: "person@example.com", message: "Is the spring trip open?", ...patch,
  };
}

function request(kind: string, fields: Record<string, string>, { json, cookie }: { json: boolean; cookie?: string }) {
  return new Request(`http://brand.sites.localhost/api/forms/${kind}`, {
    method: "POST",
    headers: {
      "content-type": json ? "application/json" : "application/x-www-form-urlencoded",
      ...(json ? { accept: "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}`,
    },
    body: json ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
  });
}

beforeEach(() => clearFormRateLimits());

describe("#2829 W10 form analytics follow consent", () => {
  it("a sent contact form (JSON) with consent records form_submit_contact for this site, no words", async () => {
    const { recorded, value } = deps();
    const response = await handleFormSubmission("contact", request("contact", await body("0"), { json: true, cookie: CONSENT }), load, value);
    expect(response.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect((recorded[0]!.site as { site_id: string }).site_id).toBe(artifact.site_id);
    const event = recorded[0]!.event;
    expect(event.event_name).toBe("form_submit_contact");
    expect(event.page_path).toBe("/contact-us");
    expect(event.publication_id).toBe(artifact.publication_id);
    expect(JSON.stringify(event)).not.toMatch(/person@example\.com|Fixture Person|spring trip/);
  });

  it("a newsletter signup without JavaScript, with consent, records form_submit_newsletter", async () => {
    const { recorded, value } = deps();
    const response = await handleFormSubmission("newsletter", request("newsletter", await body("1"), { json: false, cookie: CONSENT }), load, value);
    expect(response.status).toBe(303);
    expect(recorded.map((row) => row.event.event_name)).toEqual(["form_submit_newsletter"]);
  });

  it("records nothing without consent, with consent declined, or when the send was refused", async () => {
    for (const cookie of [undefined, "mingla_site_analytics_consent_v1=necessary"]) {
      const { recorded, value } = deps();
      await handleFormSubmission("contact", request("contact", await body("0"), { json: true, cookie }), load, value);
      expect(recorded, String(cookie)).toHaveLength(0);
    }
    const refused = deps({ status: 400, body: { error: "invalid_input", field: "email" } });
    await handleFormSubmission("contact", request("contact", await body("0"), { json: true, cookie: CONSENT }), load, refused.value);
    expect(refused.recorded).toHaveLength(0);
    const trapped = deps();
    await handleFormSubmission("contact", request("contact", await body("0", { website: "bot" }), { json: true, cookie: CONSENT }), load, trapped.value);
    expect(trapped.recorded).toHaveLength(0);
  });

  it("a failed record never changes what the visitor is told", async () => {
    const { value } = deps(undefined, true);
    const response = await handleFormSubmission("contact", request("contact", await body("0"), { json: true, cookie: CONSENT }), load, value);
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});

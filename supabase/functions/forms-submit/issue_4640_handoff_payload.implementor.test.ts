import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CREATORS_DEF } from "../_shared/__tests__/issue_4452_forms_contract_vectors.ts";
import {
  bookingHandoffPayload,
  handleFormsRequest,
  type LiveForm,
  MIN_FILL_MS,
  type SubmitDb,
} from "./submit.ts";

Deno.test("#4640 a validated Host form becomes the scheduler's small plain payload", () => {
  const form = {
    id: "46400000-0000-4000-8000-000000000001",
    key: "host-demo",
    audience: "host",
    status: "live",
    template: null,
    version: 1,
    definition: {
      v: 1,
      audience: "host",
      fields: [
        { key: "name", type: "name", label: "Your name", required: true },
        { key: "email", type: "email", label: "Work email", required: true },
        { key: "phone", type: "phone", label: "Phone number", required: true },
        {
          key: "venue",
          type: "short",
          label: "What is the place or event called?",
          required: true,
        },
        {
          key: "icp",
          type: "single",
          label: "What do you run?",
          required: true,
          options: ["Events"],
        },
        {
          key: "social",
          type: "social",
          label: "Main social page",
          required: true,
        },
      ],
      ads: { lead_on: true, goal: "call_booked" },
      routing: { card: { on: false } },
    },
  } as LiveForm;
  const payload = bookingHandoffPayload(form, {
    name: "Ada Host",
    email: "ada@example.com",
    phone: "+2348012345678",
    venue: "Ada Hall",
    icp: "Events",
    social: { platform: "instagram", url: "https://instagram.com/adahall" },
  }, {
    name: "Ada Host",
    email: "ada@example.com",
    phone_e164: "+2348012345678",
  });
  assertEquals(payload, {
    audience: "host",
    name: "Ada Host",
    email: "ada@example.com",
    phone: "+2348012345678",
    social_platform: "instagram",
    social_handle: "https://instagram.com/adahall",
    icp: "events",
    venue: "Ada Hall",
  });
});

Deno.test("#4640 a saved form never reports success without its required scheduler handoff", async () => {
  const formId = "4640f000-0000-4000-8000-000000000001";
  const definition = {
    ...CREATORS_DEF,
    after_submit: {
      action: "book_call" as const,
      scheduler_key: "creator-call",
    },
  };
  const db: SubmitDb = {
    adClient: {},
    loadForm: () =>
      Promise.resolve({
        id: formId,
        key: "creator-demo",
        audience: "creator",
        status: "live",
        template: null,
        version: 1,
        definition,
      }),
    countAttempts: () => Promise.resolve({ form10m: 0, ip24h: 0 }),
    recordAttempt: () => Promise.resolve(),
    submitCore: () =>
      Promise.resolve({
        replay: false,
        deduped: true,
        submission_id: "4640f000-0000-4000-8000-000000000002",
        lead_on: false,
        run_id: null,
      }),
    setLeadEvent: () => Promise.resolve(),
    trackEvent: () => Promise.resolve(),
    mintHandoff: () => Promise.resolve(null),
  };
  const request = new Request("https://fn/forms-submit", {
    method: "POST",
    headers: {
      origin: "https://usemingla.com",
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.46",
    },
    body: JSON.stringify({
      action: "submit",
      idempotency_key: crypto.randomUUID(),
      form_id: formId,
      form_version: 1,
      answers: {
        name: "Ada Okafor",
        email: "ada@example.org",
        phone: { country: "NG", dial: "+234", number: "801 234 5678" },
        what_do_you_make: "Photo",
        your_main_social: { platform: "instagram", value: "@ada.films" },
        city: { label: "Lagos, Nigeria", country: "NG" },
        consent: true,
      },
      placement: "form_page",
      page_url: "https://usemingla.com/creators",
      time_zone: "Africa/Lagos",
      hp: "",
      t_open_ms: MIN_FILL_MS + 5000,
    }),
  });
  const response = await handleFormsRequest(request, {
    db,
    env: () => undefined,
    log: () => {},
  });
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "server" });
});

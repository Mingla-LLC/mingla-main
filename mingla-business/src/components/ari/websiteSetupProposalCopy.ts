/**
 * #2830 — what the owner reads on the confirmation card for a Website setup
 * save. The card used to fall back to the raw tool arguments, so the owner saw
 * "update brand context", "expected plan revision 8" and a 64-character
 * revision hash, and never the value being saved. Revisions, evidence and
 * citations are concurrency and audit plumbing: they stay in the proposal the
 * server checks, never on the card. The card says what will be saved, in the
 * owner's words.
 *
 * Pure on purpose: no React Native, so every branch is provable in a unit test.
 */

import {
  formatPhoneNational,
  phoneDialCodeForCountry,
} from "@mingla/phone-input/phoneNumber";

export interface WebsiteSetupProposalField {
  label: string;
  value: string;
}

export interface WebsiteSetupProposalCopy {
  /** Small heading above the card title. */
  verb: string;
  /** The card title. */
  title: string;
  fields: WebsiteSetupProposalField[];
}

type Args = Record<string, unknown>;

const SOCIAL_LABELS: Readonly<Record<string, string>> = {
  website: "Website",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
};

const EXCEPTION_LABELS: Readonly<Record<string, string>> = {
  venue_descriptor: "Venue description",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  address: "Address",
  city_country: "City and country",
  social_links: "Website and social links",
  profile_photo: "Brand logo",
  cover_media: "Cover",
  theme: "Page theme",
};

// Mirrors PLAN_OFFERING_OPTIONS (supabase/functions/_shared/siteContracts/sitePlan.ts).
const OFFERING_LABELS: Readonly<Record<string, string>> = {
  trips: "Trips",
  events: "Events",
  experiences: "Experiences",
  venue_food_drink: "Restaurant, bar or café",
  venue_play: "Play",
  venue_creative_arts: "Creative & arts",
  venue_stay: "Stay",
};

const FONT_LABELS: Readonly<Record<string, string>> = {
  inter: "Inter",
  poppins: "Poppins",
  space_grotesk: "Space Grotesk",
  plus_jakarta_sans: "Plus Jakarta Sans",
  manrope: "Manrope",
  playfair_display: "Playfair Display",
  dm_serif_display: "DM Serif Display",
  fraunces: "Fraunces",
  lora: "Lora",
  bebas_neue: "Bebas Neue",
  anton: "Anton",
  unbounded: "Unbounded",
  caveat: "Caveat",
  dancing_script: "Dancing Script",
};

function object(value: unknown): Args {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Args)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function words(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "+12125550123" → "+1 (212) 555-0123"; unknown shapes are shown as saved. */
export function displayPhone(e164: string): string {
  if (e164.startsWith("+1") && e164.length === 12) {
    return `+1 ${formatPhoneNational("US", e164.slice(2))}`;
  }
  return e164;
}

function brandContextFields(args: Args): WebsiteSetupProposalField[] {
  const patch = object(args.patch);
  const out: WebsiteSetupProposalField[] = [];
  const name = text(patch.name);
  if (name) out.push({ label: "Brand name", value: name });
  if ("description" in patch) {
    out.push({
      label: "Description",
      value: text(patch.description) ?? "Remove the description",
    });
  }
  const email = text(patch.contact_email);
  if (email) out.push({ label: "Contact email", value: email });
  const phone = text(patch.contact_phone);
  if (phone) out.push({ label: "Contact phone", value: displayPhone(phone) });
  const address = text(patch.address);
  if (address) out.push({ label: "Address", value: address });
  const city = text(patch.city);
  const country = text(patch.country_code);
  if (city || country) {
    out.push({
      label: "City and country",
      value: [city, country].filter(Boolean).join(", "),
    });
  }
  for (const [key, url] of Object.entries(object(patch.social_links))) {
    const link = text(url);
    if (link)
      out.push({ label: SOCIAL_LABELS[key] ?? words(key), value: link });
  }
  if (Array.isArray(patch.custom_links)) {
    for (const entry of patch.custom_links) {
      const label = text(object(entry).label);
      const url = text(object(entry).url);
      if (label && url) out.push({ label, value: url });
    }
  }
  const theme = object(patch.theme);
  if (Object.keys(theme).length > 0) {
    const parts = [
      text(theme.color) ? `Colour ${String(theme.color).toUpperCase()}` : null,
      text(theme.font)
        ? `${FONT_LABELS[String(theme.font)] ?? words(String(theme.font))} type`
        : null,
      text(theme.animation)
        ? theme.animation === "none"
          ? "No motion"
          : `${words(String(theme.animation))} motion`
        : null,
    ].filter(Boolean);
    out.push({ label: "Page theme", value: parts.join(" · ") });
  }
  if (Array.isArray(args.exceptions)) {
    for (const entry of args.exceptions) {
      const key = text(object(entry).field_key);
      if (!key) continue;
      const reason = text(object(entry).reason);
      out.push({
        label: EXCEPTION_LABELS[key] ?? words(key),
        value: reason ? `Doesn’t apply — “${reason}”` : "Doesn’t apply",
      });
    }
  }
  return out;
}

function planAnswerFields(args: Args): WebsiteSetupProposalField[] {
  const answers = object(args.answers);
  const out: WebsiteSetupProposalField[] = [];
  if (Array.isArray(answers.offerings_selected)) {
    const offered = answers.offerings_selected.map(
      (key) => OFFERING_LABELS[String(key)] ?? words(String(key)),
    );
    out.push({
      label: "What you’ll offer",
      value: offered.length > 0 ? offered.join(", ") : "Nothing yet",
    });
  }
  const venue = text(answers.venue_descriptor);
  if (venue) out.push({ label: "Venue description", value: venue });
  const story = object(answers.story);
  const who = text(story.who);
  if (who) out.push({ label: "Who comes with you", value: who });
  const why = text(story.why);
  if (why) out.push({ label: "Why they choose you", value: why });
  const action = text(story.main_action);
  if (action) out.push({ label: "Main visitor action", value: action });
  return out;
}

/** Platform names keep their capitals; ordinary labels read mid-sentence. */
function titleLabel(label: string): string {
  return Object.values(SOCIAL_LABELS).includes(label)
    ? label
    : label.charAt(0).toLowerCase() + label.slice(1);
}

/** Copy for a Website setup save, or null for any other tool. */
export function websiteSetupProposalCopy(
  toolName: string,
  args: Args,
): WebsiteSetupProposalCopy | null {
  switch (toolName) {
    case "update_brand_context": {
      const fields = brandContextFields(args);
      return {
        verb: "Save to your brand",
        title:
          fields.length === 1
            ? `Save your ${titleLabel(fields[0].label)}`
            : "Save your brand details",
        fields,
      };
    }
    case "save_site_plan_answers":
      return {
        verb: "Save to your Website plan",
        title: "Save your answer",
        fields: planAnswerFields(args),
      };
    case "save_site_plan_design": {
      const key = text(args.design_key);
      return {
        verb: "Save to your Website plan",
        title: "Save your design",
        fields: key ? [{ label: "Design", value: words(key) }] : [],
      };
    }
    case "create_site_draft":
      return {
        verb: "Build your Website",
        title: "Build your draft pages",
        fields: [
          {
            label: "What happens",
            value:
              "Ari builds private draft pages from your approved plan. Nothing is published.",
          },
        ],
      };
    default:
      return null;
  }
}

const SUBMISSION =
  /^Use my answer for (.+?), confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap\.(?:\s+Country: ([A-Z]{2}))?(?:\s+Choices: ([\s\S]*?))?(?:\s+Response: ([\s\S]*))?$/;

/**
 * #2830 — how the owner's own bubble reads after they answer a Website setup
 * card. The text sent to the server keeps the exact structured shape the
 * server parses (label, country, choices, response); only the bubble shows it
 * as the owner would say it: "Contact phone: +1 (212) 555-0123". Any other
 * message is returned unchanged.
 */
export function friendlyWebsiteSetupAnswer(message: string): string {
  const match = message.replace(/\s+/g, " ").trim().match(SUBMISSION);
  if (!match) return message;
  const [, label, country, choices, response] = match;
  let answer = (response ?? "").trim() || (choices ?? "").trim();
  if (country && answer && !answer.startsWith("+")) {
    const dial = phoneDialCodeForCountry(country);
    if (dial) answer = `${dial} ${formatPhoneNational(country, answer)}`;
  }
  return answer ? `${label}: ${answer}` : label;
}

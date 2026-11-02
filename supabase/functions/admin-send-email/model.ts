import { escapeHtml } from "../_shared/email/escape.ts";
import { sanitizeAdminRichText } from "../_shared/email/genericBody.ts";
import type { EmailContentBlock } from "../_shared/email/types.ts";

export const PERSONALIZATION_TOKENS = [
  "first_name",
  "display_name",
  "username",
  "country",
  "language",
  "joined_date",
] as const;

export type PersonalizationToken = typeof PERSONALIZATION_TOKENS[number];

export interface RecipientProfile {
  id?: string | null;
  email?: string | null;
  first_name?: string | null;
  display_name?: string | null;
  username?: string | null;
  country?: string | null;
  preferred_language?: string | null;
  created_at?: string | null;
  segment?: string | null;
  /** #4226: People app status, staff/test flag and marketing consent. */
  app_status?: string | null;
  is_internal?: boolean | null;
  marketing_consent?: string | null;
}

export interface SnapshotOptions {
  /** Leave staff and test people out (every bulk send). */
  excludeInternal?: boolean;
  /** True when this recipient may only be sent marketing with consent 'yes'. */
  requireConsent?: (profile: RecipientProfile) => boolean;
}

export function normalizedValidEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.toLowerCase().trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * #3720 — create one deterministic recipient snapshot from the complete
 * paginated audience. Invalid addresses, global suppressions, and duplicate
 * normalized addresses remain visible in review counts without entering the
 * provider delivery queue.
 */
export function snapshotAudience(
  profiles: RecipientProfile[],
  suppressed: Set<string>,
  options: SnapshotOptions = {},
) {
  const seen = new Set<string>();
  let noContact = 0;
  let duplicate = 0;
  let skippedOptOut = 0;
  let noConsent = 0;
  let internalExcluded = 0;
  // #4226: who will receive, by People app status (the Everyone breakdown).
  const byGroup: Record<string, number> = {};
  const deliveries: Array<{
    profile_id: string | null;
    recipient_email: string;
    personalization: RecipientProfile;
    status: "pending" | "skipped_opt_out";
  }> = [];
  for (const profile of profiles) {
    // #4226: staff and test never join a bulk send; counted, not queued.
    if (options.excludeInternal && profile.is_internal === true) {
      internalExcluded += 1;
      continue;
    }
    const email = normalizedValidEmail(profile.email);
    if (!email) {
      noContact += 1;
      continue;
    }
    if (seen.has(email)) {
      duplicate += 1;
      continue;
    }
    seen.add(email);
    const isSuppressed = suppressed.has(email) ||
      profile.marketing_consent === "unsubscribed";
    // #4226: a ticket buyer reached for marketing needs a recorded 'yes'.
    if (
      !isSuppressed && options.requireConsent?.(profile) &&
      profile.marketing_consent !== "yes"
    ) {
      noConsent += 1;
      continue;
    }
    if (isSuppressed) skippedOptOut += 1;
    else {
      const group = profile.app_status || "unknown";
      byGroup[group] = (byGroup[group] ?? 0) + 1;
    }
    deliveries.push({
      profile_id: profile.id ?? null,
      recipient_email: email,
      personalization: profile,
      status: isSuppressed ? "skipped_opt_out" : "pending",
    });
  }
  return {
    deliveries,
    matched: profiles.length,
    willReceive: deliveries.length - skippedOptOut,
    skippedOptOut,
    noContact,
    duplicate,
    noConsent,
    internalExcluded,
    byGroup,
  };
}

export interface AudienceDefinition {
  mode: "everyone" | "segment" | "person";
  profileId?: string;
  /** #4226: a person with no account is addressed by email. */
  email?: string;
  filters?: {
    userType?: "all" | "host" | "explorer" | "ticket_buyers" | "host_contacts";
    appStatus?:
      | "all"
      | "explorer"
      | "host"
      | "both"
      | "incomplete"
      | "ticket_buyer_no_app"
      | "host_contact_no_app";
    /** #4226: narrow to ticket buyers or host contacts. */
    source?: "all" | "ticket_buyer" | "host_contact";
    city?: string;
    boughtTickets?: "all" | "yes" | "no";
    brandId?: string;
    country?: string;
    onboarding?: "all" | "completed" | "incomplete";
    accountStatus?: "all" | "active" | "inactive";
    emailStatus?: "all" | "verified" | "unverified";
    language?: string;
    beta?: "all" | "beta" | "non_beta";
    joinedFrom?: string;
    joinedTo?: string;
  };
}

export function fallbackPersonalization(
  profile: RecipientProfile,
): Record<PersonalizationToken, string> {
  const rawFirstName = profile.first_name?.trim() ?? "";
  const rawDisplayName = profile.display_name?.trim() ?? "";
  const rawUsername = (profile.username?.trim() ?? "").replace(/^@+/, "");
  const firstName = rawFirstName || rawDisplayName.split(/\s+/)[0] ||
    rawUsername || "there";
  const displayName = rawDisplayName || rawFirstName ||
    (rawUsername ? `@${rawUsername}` : "") || "Mingla member";
  const username = rawUsername
    ? `@${rawUsername}`
    : rawDisplayName || rawFirstName || "Mingla member";
  const countryCode = profile.country?.trim().toUpperCase() ?? "";
  const languageCode = profile.preferred_language?.trim().toLowerCase() ?? "";
  let country = "your area";
  let language = "English";
  try {
    if (countryCode) {
      country = new Intl.DisplayNames(["en"], { type: "region" }).of(
        countryCode,
      ) || country;
    }
    if (languageCode) {
      language = new Intl.DisplayNames(["en"], { type: "language" }).of(
        languageCode,
      ) || language;
    }
  } catch {
    country = countryCode || country;
    language = languageCode || language;
  }
  return {
    first_name: firstName,
    display_name: displayName,
    username,
    country,
    language,
    joined_date: profile.created_at
      ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
        .format(new Date(profile.created_at))
      : "recently",
  };
}

export function personalizeText(
  value: string,
  profile: RecipientProfile,
): string {
  const values = fallbackPersonalization(profile);
  return value.replace(
    /\{(first_name|display_name|username|country|language|joined_date|name)\}/g,
    (_match, key) => {
      if (key === "name") return values.first_name;
      return values[key as PersonalizationToken];
    },
  );
}

export function personalizeDocument(
  document: EmailContentBlock[],
  profile: RecipientProfile,
): EmailContentBlock[] {
  const values = fallbackPersonalization(profile);
  const replaceHtmlTokens = (value: string) =>
    value.replace(
      /\{(first_name|display_name|username|country|language|joined_date|name)\}/g,
      (_match, key) =>
        escapeHtml(
          key === "name"
            ? values.first_name
            : values[key as PersonalizationToken],
        ),
    );

  return document.map((block) => {
    if (block.type === "rich_text") {
      return { ...block, html: replaceHtmlTokens(block.html) };
    }
    if (block.type === "image") {
      return { ...block, alt: personalizeText(block.alt, profile) };
    }
    return block;
  });
}

export function validateDocument(input: unknown): EmailContentBlock[] {
  if (
    input && typeof input === "object" && !Array.isArray(input) &&
    (input as Record<string, unknown>).version === 1
  ) {
    input = (input as Record<string, unknown>).blocks;
  }
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw new Error("email_document_invalid");
  }
  if (
    input.filter((candidate) =>
      candidate && typeof candidate === "object" &&
      (candidate as Record<string, unknown>).type === "blog_post"
    ).length > 3
  ) {
    throw new Error("email_block_blog_post_limit");
  }
  return input.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`email_block_invalid:${index}`);
    }
    const block = candidate as Record<string, unknown>;
    const id = typeof block.id === "string" ? block.id.slice(0, 80) : undefined;
    if (block.type === "divider") return { id, type: "divider" };
    if (block.type === "rich_text") {
      if (typeof block.html !== "string" || block.html.length > 100_000) {
        throw new Error(`email_rich_text_invalid:${index}`);
      }
      return {
        id,
        type: "rich_text",
        html: sanitizeAdminRichText(block.html),
      };
    }
    if (block.type === "image") {
      if (
        typeof block.url !== "string" || typeof block.alt !== "string" ||
        !block.alt.trim()
      ) {
        throw new Error(`email_image_invalid:${index}`);
      }
      let url: URL;
      try {
        url = new URL(block.url);
      } catch {
        throw new Error(`email_image_url_invalid:${index}`);
      }
      if (url.protocol !== "https:") {
        throw new Error(`email_image_url_invalid:${index}`);
      }
      let link: string | null = null;
      if (typeof block.link === "string" && block.link.trim()) {
        let parsedLink: URL;
        try {
          parsedLink = new URL(block.link);
        } catch {
          throw new Error(`email_image_link_invalid:${index}`);
        }
        if (parsedLink.protocol !== "https:") {
          throw new Error(`email_image_link_invalid:${index}`);
        }
        link = parsedLink.toString();
      }
      return {
        id,
        type: "image",
        url: url.toString(),
        alt: block.alt.trim().slice(0, 500),
        link,
      };
    }
    if (block.type === "blog_post") {
      const postId = typeof block.postId === "string"
        ? block.postId.trim()
        : "";
      const style = block.style;
      const buttonText = typeof block.buttonText === "string"
        ? block.buttonText.trim()
        : "";
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(postId)
      ) {
        throw new Error(`email_block_blog_post_id_invalid:${index}`);
      }
      if (!new Set(["card", "row", "link"]).has(String(style))) {
        throw new Error(`email_block_blog_post_style_invalid:${index}`);
      }
      if (
        !buttonText || buttonText.length > 40 || /[{}\r\n]/.test(buttonText)
      ) {
        throw new Error(`email_block_blog_post_button_invalid:${index}`);
      }
      const snapshot = block.snapshot && typeof block.snapshot === "object"
        ? block.snapshot as Extract<
          EmailContentBlock,
          { type: "blog_post" }
        >["snapshot"]
        : undefined;
      return {
        id,
        type: "blog_post",
        postId,
        style: style as "card" | "row" | "link",
        buttonText,
        snapshot,
      };
    }
    throw new Error(`email_block_type_unsupported:${String(block.type)}`);
  });
}

export function versionedDocument(document: EmailContentBlock[]) {
  return { version: 1 as const, blocks: document };
}

export function assertSupportedPersonalization(
  subject: string,
  document: EmailContentBlock[],
) {
  const allowed = new Set<string>([...PERSONALIZATION_TOKENS, "name"]);
  const values = [
    subject,
    ...document.flatMap((block) =>
      block.type === "rich_text"
        ? [block.html]
        : block.type === "image"
        ? [block.alt]
        : []
    ),
  ];
  for (const value of values) {
    for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
      if (!allowed.has(match[1])) {
        throw new Error(`personalization_token_unsupported:${match[1]}`);
      }
    }
  }
}

export function legacyBodyDocument(body: string): EmailContentBlock[] {
  const paragraphs = body.split(/\n{2,}/).map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return [{
    type: "rich_text",
    html: paragraphs.map((paragraph) =>
      `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
    ).join(""),
  }];
}

export function documentPlainText(document: EmailContentBlock[]): string {
  return document.map((block) => {
    if (block.type === "divider") return "────────";
    if (block.type === "image") return block.alt;
    if (block.type === "blog_post") return block.snapshot?.title || "Blog post";
    if (block.type === "blog_post_resolved") return block.title;
    return block.html
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>|<\/h2>|<\/h3>|<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }).filter(Boolean).join("\n\n");
}

export function normalizeAudience(input: unknown): AudienceDefinition {
  if (!input || typeof input !== "object") {
    throw new Error("audience_mode_invalid");
  }
  const raw = input as Record<string, unknown>;
  if (raw.mode === "person") {
    const profileId = typeof raw.profileId === "string"
      ? raw.profileId.trim()
      : "";
    // #4226: a ticket buyer with no account has no profile; address by email.
    if (!profileId && typeof raw.email === "string") {
      const email = normalizedValidEmail(raw.email);
      if (!email) throw new Error("recipient_email_invalid");
      return { mode: "person", email };
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(profileId)
    ) {
      throw new Error("recipient_profile_invalid");
    }
    return { mode: "person", profileId };
  }
  if (raw.mode === "everyone") return { mode: "everyone", filters: {} };
  if (raw.mode !== "segment") throw new Error("audience_mode_invalid");
  const source = raw.filters && typeof raw.filters === "object"
    ? raw.filters as Record<string, unknown>
    : {};
  const value = (key: string) =>
    typeof source[key] === "string" ? String(source[key]).trim() : "";
  const enumFilter = <T extends string>(
    key: string,
    allowed: readonly T[],
  ): T | "all" => {
    const rawValue = value(key);
    if (!rawValue || rawValue === "all") return "all";
    if (!allowed.includes(rawValue as T)) {
      throw new Error(`audience_filter_invalid:${key}`);
    }
    return rawValue as T;
  };
  const joinedFrom = value("joinedFrom");
  const joinedTo = value("joinedTo");
  for (
    const [key, dateValue] of [["joinedFrom", joinedFrom], [
      "joinedTo",
      joinedTo,
    ]]
  ) {
    if (dateValue && !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      throw new Error(`audience_filter_invalid:${key}`);
    }
  }
  if (joinedFrom && joinedTo && joinedFrom > joinedTo) {
    throw new Error("audience_filter_invalid:joined_range");
  }
  const brandId = value("brandId");
  if (
    brandId && brandId !== "all" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(brandId)
  ) {
    throw new Error("audience_filter_invalid:brandId");
  }
  return {
    mode: "segment",
    filters: {
      userType: enumFilter(
        "userType",
        ["host", "explorer", "ticket_buyers", "host_contacts"] as const,
      ),
      appStatus: enumFilter(
        "appStatus",
        [
          "explorer",
          "host",
          "both",
          "incomplete",
          "ticket_buyer_no_app",
          "host_contact_no_app",
        ] as const,
      ),
      source: enumFilter("source", ["ticket_buyer", "host_contact"] as const),
      city: value("city").slice(0, 120) || "all",
      boughtTickets: enumFilter("boughtTickets", ["yes", "no"] as const),
      brandId: brandId || "all",
      country: value("country") || "all",
      onboarding: enumFilter(
        "onboarding",
        ["completed", "incomplete"] as const,
      ),
      accountStatus: enumFilter(
        "accountStatus",
        ["active", "inactive"] as const,
      ),
      emailStatus: enumFilter(
        "emailStatus",
        ["verified", "unverified"] as const,
      ),
      language: value("language") || "all",
      beta: enumFilter("beta", ["beta", "non_beta"] as const),
      joinedFrom: joinedFrom || undefined,
      joinedTo: joinedTo || undefined,
    },
  };
}

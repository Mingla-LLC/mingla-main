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
  email: string;
  first_name?: string | null;
  display_name?: string | null;
  username?: string | null;
  country?: string | null;
  preferred_language?: string | null;
  created_at?: string | null;
  segment?: string | null;
}

export interface AudienceDefinition {
  mode: "everyone" | "segment" | "person";
  email?: string;
  filters?: {
    userType?: "all" | "host" | "explorer";
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
  const displayName = profile.display_name?.trim() || "Mingla member";
  const firstName = profile.first_name?.trim() || displayName.split(/\s+/)[0] ||
    "there";
  return {
    first_name: firstName,
    display_name: displayName,
    username: profile.username?.trim() || "member",
    country: profile.country?.trim() || "your area",
    language: profile.preferred_language?.trim() || "your preferred language",
    joined_date: profile.created_at
      ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" })
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
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw new Error("email_document_invalid");
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
    throw new Error(`email_block_type_unsupported:${String(block.type)}`);
  });
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
    return { mode: "everyone", filters: {} };
  }
  const raw = input as Record<string, unknown>;
  if (raw.mode === "person") {
    const email = typeof raw.email === "string"
      ? raw.email.toLowerCase().trim()
      : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("recipient_email_invalid");
    }
    return { mode: "person", email };
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
  return {
    mode: "segment",
    filters: {
      userType: enumFilter("userType", ["host", "explorer"] as const),
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

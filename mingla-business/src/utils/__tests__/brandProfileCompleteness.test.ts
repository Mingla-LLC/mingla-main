/**
 * ORCH-1256 — brandProfileCompleteness predicate matrix (SPEC §7 T-4/T-5/T-6
 * + isBlank contract). Implementor happy-path regression: reverting the
 * trim rule (or any predicate) fails these tests.
 *
 * Invariant under test: I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE — a
 * filled (non-blank after trim) profile field NEVER reads as "needs".
 */
import { describe, expect, test } from "@jest/globals";

import type { Brand } from "../../types/brand";
import {
  deriveBrandProfileTodoInput,
  isBlank,
  SOCIAL_TODO_KEYS,
} from "../brandProfileCompleteness";

/** Minimal fresh brand (name + slug only — every profile field empty). */
const freshBrand = (overrides: Partial<Brand> = {}): Brand => ({
  id: "b1",
  displayName: "Test Brand",
  slug: "test-brand",
  address: null,
  coverHue: 25,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  ...overrides,
});

describe("isBlank — trim-empty contract (F-2)", () => {
  test("null / undefined / empty / whitespace-only are ALL blank", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank("\n\t ")).toBe(true);
  });

  test("any non-whitespace content is NOT blank", () => {
    expect(isBlank("x")).toBe(false);
    expect(isBlank("  padded  ")).toBe(false);
  });
});

describe("deriveBrandProfileTodoInput — fresh vs filled", () => {
  test("fresh brand (name+slug only) → all 8 predicates true", () => {
    expect(deriveBrandProfileTodoInput(freshBrand())).toEqual({
      needsCover: true,
      needsPhoto: true,
      needsTagline: true,
      needsDescription: true,
      needsAddress: true,
      needsEmail: true,
      needsPhone: true,
      needsSocials: true,
    });
  });

  test("fully filled brand → all 8 predicates false", () => {
    const filled = freshBrand({
      coverMediaUrl: "https://cdn.example.com/cover.jpg",
      photo: "https://cdn.example.com/photo.jpg",
      tagline: "One line",
      bio: "A longer story",
      address: "12 Old Street, London",
      contact: { email: "hello@brand.com", phone: "+44 7700 900312" },
      links: { instagram: "https://instagram.com/brand" },
    });
    expect(deriveBrandProfileTodoInput(filled)).toEqual({
      needsCover: false,
      needsPhoto: false,
      needsTagline: false,
      needsDescription: false,
      needsAddress: false,
      needsEmail: false,
      needsPhone: false,
      needsSocials: false,
    });
  });

  test("coverHue alone is NOT a cover — hue-only brand still needsCover", () => {
    const hueOnly = freshBrand({ coverHue: 210 });
    expect(deriveBrandProfileTodoInput(hueOnly).needsCover).toBe(true);
  });

  // T-4 — whitespace-only values count as EMPTY (address is mapped untrimmed;
  // one blank-string social still leaves ALL networks empty).
  test("T-4: whitespace-only address/email/instagram all count as EMPTY", () => {
    const whitespacey = freshBrand({
      address: "  ",
      contact: { email: " " },
      links: { instagram: "  " },
    });
    const derived = deriveBrandProfileTodoInput(whitespacey);
    expect(derived.needsAddress).toBe(true);
    expect(derived.needsEmail).toBe(true);
    expect(derived.needsSocials).toBe(true);
  });

  // T-5 — ONE filled network suppresses the aggregated socials row.
  test("T-5: only threads filled → needsSocials false", () => {
    const oneSocial = freshBrand({
      links: { threads: "https://threads.net/@brand" },
    });
    expect(deriveBrandProfileTodoInput(oneSocial).needsSocials).toBe(false);
  });

  test.each(SOCIAL_TODO_KEYS)(
    "any single filled network (%s) suppresses needsSocials",
    (key) => {
      const brand = freshBrand({ links: { [key]: "https://example.com/x" } });
      expect(deriveBrandProfileTodoInput(brand).needsSocials).toBe(false);
    },
  );

  // T-6 — links.custom is ignored by the socials predicate (no UI authors it).
  test("T-6: custom-only links → needsSocials stays true", () => {
    const customOnly = freshBrand({
      links: { custom: [{ label: "Shop", url: "https://shop.example.com" }] },
    });
    expect(deriveBrandProfileTodoInput(customOnly).needsSocials).toBe(true);
  });

  test("SOCIAL_TODO_KEYS is exactly the 8 named networks", () => {
    expect([...SOCIAL_TODO_KEYS]).toEqual([
      "website",
      "instagram",
      "tiktok",
      "x",
      "facebook",
      "youtube",
      "linkedin",
      "threads",
    ]);
  });

  // F-7 — single-paragraph description maps to bio only; the tagline row
  // correctly still shows (that IS an empty tagline in the data model).
  test("bio set but tagline undefined → needsTagline true, needsDescription false", () => {
    const bioOnly = freshBrand({ bio: "We host supper clubs." });
    const derived = deriveBrandProfileTodoInput(bioOnly);
    expect(derived.needsTagline).toBe(true);
    expect(derived.needsDescription).toBe(false);
  });
});

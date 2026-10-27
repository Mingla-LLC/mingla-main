// #2829 W7b — turn what a brand's existing Payload seed would have created
// (recorded by lib/payload-seed-recorder/extract.mjs) into Mingla records:
// Core trips, historical trips and reviews, and the site's Studio documents
// (pages, destinations, stories, navigation, footer, settings) on the voyage
// design. PURE: no I/O. The brand's content is read at run time from its own
// source and never lives in this repository; this file holds only the mapping.
//
// Every visible string comes from the brand's records. Where the old site drew
// a string from component code (an empty-list sentence, the header button),
// the caller reads it from the brand's own source and passes it in
// (`componentText`); nothing is typed here.

const ICON_KEYS = ["travel_explore", "festival", "diversity_1", "event_available"];

export const HISTORY_TIMEZONE_DEFAULT = "America/New_York";

function docsOf(recorded, collection) {
  return recorded.documents.filter((doc) => doc.collection === collection);
}

function docById(recorded, collection, id) {
  return recorded.documents.find((doc) => doc.collection === collection && doc.id === id) ?? null;
}

function day(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

function fileName(path) {
  return typeof path === "string" ? path.split("/").pop() : null;
}

/** Lexical (the brand's rich text) to plain paragraphs, for Mingla text fields. */
export function lexicalToText(value) {
  const root = value?.root;
  if (!root || !Array.isArray(root.children)) return "";
  const blocks = [];
  const textOf = (node) => (node.type === "text" ? String(node.text ?? "") : (node.children ?? []).map(textOf).join(""));
  for (const node of root.children) {
    if (node.type === "list") {
      for (const item of node.children ?? []) {
        const line = textOf(item).trim();
        if (line) blocks.push(`• ${line}`);
      }
      continue;
    }
    const line = textOf(node).trim();
    if (line) blocks.push(line);
  }
  return blocks.join("\n\n");
}

/** "15-30" → { minimum: 15, maximum: 30 }; anything else → nulls. */
export function groupSize(value) {
  const match = /^\s*(\d{1,4})\s*[-–]\s*(\d{1,4})\s*$/.exec(String(value ?? ""));
  if (!match) return { minimum: null, maximum: null };
  const minimum = Number(match[1]);
  const maximum = Number(match[2]);
  return minimum >= 1 && maximum >= minimum ? { minimum, maximum } : { minimum: null, maximum: null };
}

function iconKeyFor(recorded, mediaId) {
  const name = fileName(docById(recorded, "media", mediaId)?.file)?.toLowerCase() ?? "";
  return ICON_KEYS.find((key) => name.includes(key)) ?? ICON_KEYS.find((key) => name.includes(key.replace(/_\d+$/, ""))) ?? null;
}

/** Stable, short import key for a historical trip (title + date). */
export function historyImportKey(title, date, hash) {
  return `history:${hash(`${title}|${date}`).slice(0, 16)}`;
}

/**
 * The Core half: the brand's trip documents as Mingla trips, and its archive
 * as historical trip records + reviews (W5 import file shape).
 */
export function corePlan(recorded, { brandId, timezone = HISTORY_TIMEZONE_DEFAULT, archive, hash, sourceNote }) {
  const trips = docsOf(recorded, "trips").map((doc) => {
    const data = doc.data;
    const size = groupSize(data.groupSize);
    const description = lexicalToText(data.overview) || String(data.summary ?? "");
    return {
      recorded_id: doc.id,
      slug: data.slug,
      title: data.title,
      timezone,
      start_date: day(data.startDate),
      end_date: day(data.endDate),
      description,
      destination_text: data.location || null,
      price_minor: Number.isFinite(Number(data.priceFrom)) && Number(data.priceFrom) > 0 ? Math.round(Number(data.priceFrom) * 100) : null,
      capacity: size.maximum,
      group_minimum: size.minimum,
      cover_media: data.featuredImage ?? null,
      gallery_media: (data.gallery ?? []).map((row) => row.image).filter((id) => id !== undefined && id !== null),
      days: (data.itinerary ?? []).map((row, index) => ({ ordinal: index + 1, title: String(row.title ?? "").trim(), narrative: row.body ? String(row.body).trim() : null })),
      guide: {
        highlights: (data.highlights ?? []).map((row) => String(row.text ?? "").trim()).filter(Boolean),
        what_to_prepare: lexicalToText(data.whatToPrepare) || null,
        faqs: (data.faqs ?? []).map((row) => ({ question: String(row.question).trim(), answer: String(row.answer).trim() })),
        group_minimum: size.minimum,
      },
    };
  });
  const history = (archive.PAST_TRIPS ?? []).map((row) => ({
    import_key: historyImportKey(row.title, day(row.date), hash),
    title: row.title,
    start_date: day(row.date),
    timezone,
    location: row.location,
    ...(row.series ? { series: row.series } : {}),
    source_note: sourceNote,
    linked: Boolean(row.trip),
  }));
  /*
   * #2829 W7c (A13.4, A1.3) — a review is attached to its Mingla trip in the
   * data whenever the trip it names is one of the archive's trips: same title
   * (ignoring case and spacing), the latest one that started on or before the
   * review. The review keeps the trip name exactly as the reviewer's page
   * shows it; a name that matches no trip stays text only.
   */
  const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const tripKeyFor = (tripName, reviewDay) => {
    const wanted = norm(tripName);
    if (!wanted) return null;
    const match = history
      .filter((row) => norm(row.title) === wanted && row.start_date && (!reviewDay || row.start_date <= reviewDay))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    return match ? match.import_key : null;
  };
  const reviews = (archive.REVIEWS ?? []).map((row) => {
    const reviewDay = day(row.reviewDate);
    const tripKey = tripKeyFor(row.tripName, reviewDay);
    return {
      quote: row.quote,
      reviewer: row.reviewer,
      review_date: reviewDay,
      ...(row.tripName ? { trip_name: row.tripName } : {}),
      ...(tripKey ? { trip_import_key: tripKey } : {}),
      source_note: sourceNote,
      confirmed_real: true,
    };
  });
  return {
    trips,
    historyFile: {
      brand_id: brandId,
      trips: history.map(({ linked, ...record }) => { void linked; return record; }),
      reviews,
    },
    linkedHistoryKeys: history.filter((row) => row.linked).map((row) => row.import_key),
  };
}

/** Which collection a page is the full index of (its grid has no "see all" link). */
function indexKindOf(page) {
  for (const block of page.layout ?? []) {
    if (block.blockType === "tripsGrid" && block.show === "all") return "trips";
    if (block.blockType === "destinationsGrid" && !block.link) return "destinations";
    if (block.blockType === "storiesGrid" && !block.link) return "stories";
  }
  return null;
}

function pageSlug(page) {
  return page.slug === "home" ? "" : page.slug;
}

/** Every media id the site needs uploaded, with the file it came from. */
export function mediaNeeded(recorded) {
  const ids = new Set();
  const add = (id) => { if (id !== undefined && id !== null) ids.add(id); };
  for (const page of docsOf(recorded, "pages")) {
    for (const block of page.data.layout ?? []) {
      add(block.backgroundImage);
      add(block.coverImage);
      add(block.image);
    }
  }
  for (const doc of docsOf(recorded, "destinations")) add(doc.data.featuredImage);
  for (const doc of docsOf(recorded, "posts")) add(doc.data.featuredImage);
  add(recorded.globals.header?.logo);
  return [...ids].map((id) => {
    const doc = docById(recorded, "media", id);
    return doc?.file ? { id, file: doc.file, alt: String(doc.data?.alt ?? "") } : null;
  }).filter(Boolean);
}

export function videosNeeded(recorded) {
  return docsOf(recorded, "videos").filter((doc) => doc.file).map((doc) => ({ id: doc.id, file: doc.file }));
}

/**
 * The site half. `refs` resolves the brand's record ids to Mingla/Studio ids:
 *   media(id) → Studio media id | null, video(id) → Studio media id | null,
 *   trip(recordedTripId) → { id, public_url } | null,
 *   tripsNewestFirst → Mingla trip ids of the brand's trip documents,
 *   history → Mingla ids of every imported historical trip,
 *   historyByKey(key) → Mingla id, series → [{label, offering_ids}],
 *   linkedHistory → Mingla ids, category(recordedId), destination ids later.
 */
export function sitePlan(recorded, refs, componentText) {
  const media = (id) => (id === undefined || id === null ? null : refs.media(id));
  const altOf = (id) => String(docById(recorded, "media", id)?.data?.alt ?? "");
  const pages = docsOf(recorded, "pages").map((doc) => doc.data);
  const settings = recorded.globals["site-settings"] ?? {};
  const forms = docsOf(recorded, "forms");
  const formFor = (id) => forms.find((form) => form.id === id)?.data ?? null;
  const routes = { stories: "" };
  for (const page of pages) {
    const kind = indexKindOf(page);
    if (kind === "trips" || kind === "destinations") routes[kind] = pageSlug(page);
  }

  const cta = (link) => (link?.label && link?.href ? { cta_label: link.label, cta_href: link.href } : {});
  const blockFor = (block) => {
    switch (block.blockType) {
      case "hero": {
        const lines = (block.headingLines ?? []).map((row) => String(row.text ?? "")).filter(Boolean);
        return {
          blockType: "hero",
          heading: lines.join(" ") || String(block.heading ?? ""),
          heading_lines: lines.map((text) => ({ text })),
          ...(block.eyebrow ? { eyebrow: block.eyebrow } : {}),
          ...(block.subheading ? { subheading: block.subheading } : {}),
          show_search: block.showSearch === true,
          media: media(block.backgroundImage),
          alt: altOf(block.backgroundImage),
          ctas: [],
        };
      }
      case "valueCards":
        return {
          blockType: "feature_cards",
          variant: "tile-bar",
          ...(block.heading ? { heading: block.heading } : {}),
          cards: (block.cards ?? []).map((card) => ({
            title: card.title,
            body: card.body,
            ...(card.icon !== undefined && card.icon !== null && iconKeyFor(recorded, card.icon) ? { icon: iconKeyFor(recorded, card.icon) } : {}),
          })),
        };
      case "statementPair":
        return { blockType: "feature_cards", variant: "statement", cards: (block.statements ?? []).map((row) => ({ title: row.title, body: row.body })) };
      case "tripsGrid": {
        const mode = ["upcoming", "past", "all"].includes(block.show) ? block.show : "upcoming";
        return {
          blockType: "offering_grid",
          variant: "photo-card",
          ...(block.heading ? { heading: block.heading } : {}),
          mode,
          kind: "trip",
          ...(block.showFilters ? { show_filters: true } : {}),
          // The old grid listed the brand's own trip documents (not its
          // archive): a full listing picks exactly those, newest first.
          offering_ids: mode === "all" ? refs.tripsNewestFirst.map((id) => ({ offering_id: id })) : [],
          empty_text: componentText.emptyBody,
          empty_cta_label: componentText.emptyAction.label,
          empty_cta_href: componentText.emptyAction.href,
        };
      }
      case "testimonials":
        return { blockType: "testimonials", heading: block.heading, ...(block.intro ? { intro: block.intro } : {}), from_collection: true, items: [] };
      case "destinationsGrid":
        return { blockType: "destination_grid", ...(block.heading ? { heading: block.heading } : {}), ...cta(block.link) };
      case "storiesGrid":
        return { blockType: "story_grid", ...(block.heading ? { heading: block.heading } : {}), ...(block.limit ? { limit: block.limit } : {}), ...cta(block.link) };
      case "newsletter":
        return {
          blockType: "newsletter_signup",
          heading: block.heading,
          ...(block.body ? { body: block.body } : {}),
          ...(componentText.newsletterPlaceholder ? { placeholder: componentText.newsletterPlaceholder } : {}),
          button_label: block.buttonLabel,
        };
      case "pageHeader":
        return {
          blockType: "page_header",
          heading: block.heading,
          ...(block.subheading ? { subheading: block.subheading } : {}),
          ...(block.backgroundImage ? { media: media(block.backgroundImage) } : {}),
        };
      case "videoFeature":
        return {
          blockType: "video_feature",
          variant: "brand-film",
          ...(block.heading ? { heading: block.heading } : {}),
          video: refs.video(block.video),
          poster: media(block.coverImage),
        };
      case "richText":
        return {
          blockType: "rich_text",
          variant: "prose",
          ...(block.heading ? { heading: block.heading } : {}),
          width: block.width === "narrow" ? "narrow" : "wide",
          content: block.content,
        };
      case "featureSplit":
        return {
          blockType: "media_feature",
          variant: "split-panel",
          heading: block.heading,
          ...(block.body ? { caption: block.body } : {}),
          media: media(block.image),
          alt: altOf(block.image),
          alignment: block.imageSide === "left" ? "left" : "right",
        };
      case "tripHistory":
        return {
          blockType: "offering_history",
          heading: block.heading,
          ...(block.intro ? { intro: block.intro } : {}),
          kind: "trip",
          offering_ids: refs.history.map((id) => ({ offering_id: id })),
          series: refs.series.map((run) => ({ label: run.label, offering_ids: run.offering_ids.map((id) => ({ offering_id: id })) })),
          linked_offering_ids: refs.linkedHistory.map((id) => ({ offering_id: id })),
          ...cta(block.link),
        };
      case "contactDetails":
        return {
          blockType: "contact_details",
          ...(block.heading ? { heading: block.heading } : {}),
          ...(block.body ? { body: block.body } : {}),
          ...(block.email ? { email: block.email } : {}),
          ...(block.location ? { location: block.location } : {}),
        };
      case "contactForm": {
        const form = formFor(block.form);
        const fields = form?.fields ?? [];
        const message = fields.find((field) => field.blockType === "textarea");
        const name = fields.find((field) => field.blockType === "text" && /name/i.test(String(field.name ?? "")));
        const email = fields.find((field) => field.blockType === "email");
        return {
          blockType: "contact_form",
          ...(block.heading ? { heading: block.heading } : {}),
          ...(name?.placeholder ? { name_placeholder: name.placeholder } : {}),
          ...(email?.placeholder ? { email_placeholder: email.placeholder } : {}),
          ...(message?.label ? { message_label: message.label } : {}),
          ...(message?.placeholder ? { message_placeholder: message.placeholder } : {}),
          submit_label: form?.submitButtonLabel || "Send",
          // No standing fallback line: the old form showed the address only
          // after a failed send, never under a working form.
        };
      }
      case "faqs":
        return { blockType: "faq", ...(block.heading ? { heading: block.heading } : {}), items: (block.items ?? []).map((row) => ({ question: row.question, answer: row.answer })) };
      case "cta":
        return { blockType: "cta", heading: block.heading, ...(block.body ? { body: block.body } : {}), label: block.link?.label, href: block.link?.href };
      default:
        throw new Error(`UNMAPPED_BLOCK:${block.blockType}`);
    }
  };

  const sitePages = pages.map((page) => {
    const kind = indexKindOf(page);
    return {
      slug: pageSlug(page),
      title: page.title,
      blocks: (page.layout ?? []).map(blockFor),
      kind: kind ? "collection_index" : "standard",
      ...(kind ? { collection_kind: kind } : {}),
    };
  });

  const header = recorded.globals.header ?? {};
  const footer = recorded.globals.footer ?? {};
  const pathSlug = (href) => (href === "/" ? "" : String(href ?? "").replace(/^\//, ""));
  const navItem = (item) => (item.href
    ? { label: item.label, page_slug: pathSlug(item.href) }
    : { label: item.label, page_slug: pathSlug(item.children?.[0]?.href) });
  const navigation = {
    items: (header.navItems ?? []).map((item) => ({
      ...navItem(item),
      ...(item.children?.length ? { children: item.children.map(navItem) } : {}),
    })),
    header_cta: componentText.headerCta ? { label: componentText.headerCta.label, page_slug: pathSlug(componentText.headerCta.href) } : null,
  };

  const siteFooter = {
    tagline_lines: (footer.taglineLines ?? []).map((row) => ({ text: row.text })),
    ...(footer.location ? { location: footer.location } : {}),
    ...(footer.email ? { email: footer.email } : {}),
    columns: (footer.columns ?? []).map((column) => ({ heading: column.heading, links: (column.links ?? []).map((link) => ({ label: link.label, href: link.href })) })),
    socials: (footer.socials ?? []).map((row) => ({ network: row.network, url: row.href })),
    ...(footer.copyright ? { copyright: footer.copyright } : {}),
    links: [],
  };

  const redirects = [];
  for (const rule of componentText.redirects ?? []) {
    redirects.push({ from: rule.source, to: rule.destination, status: rule.permanent === false ? 307 : 308 });
  }
  for (const trip of docsOf(recorded, "trips")) {
    const target = refs.trip(trip.id);
    if (target?.public_url && routes.trips) redirects.push({ from: `/${routes.trips}/${trip.data.slug}`, to: target.public_url, status: 308 });
  }

  const categories = docsOf(recorded, "categories").map((doc) => ({ recorded_id: doc.id, title: doc.data.title, slug: doc.data.slug }));
  const destinations = docsOf(recorded, "destinations").map((doc) => {
    const data = doc.data;
    return {
      title: data.title,
      slug: data.slug,
      ...(data.country ? { country: data.country } : {}),
      ...(data.featuredImage ? { featured_image: media(data.featuredImage) } : {}),
      ...(data.tagline ? { tagline: data.tagline } : {}),
      ...(data.summary ? { summary: data.summary } : {}),
      ...(data.facts ? { facts: data.facts } : {}),
      ...(data.storyHeading ? { story_heading: data.storyHeading } : {}),
      ...(data.body ? { body: data.body } : {}),
      seasons: (data.seasons ?? []).map((row) => ({ heading: row.heading, body: row.body, activities: (row.activities ?? []).map((item) => ({ text: item.text })) })),
      did_you_know: (data.didYouKnow ?? []).map((row) => ({ text: row.text })),
      related_offerings: (data.relatedTrips ?? []).map((id) => refs.trip(id)?.id).filter(Boolean).map((id) => ({ offering_id: id })),
      enabled: true,
    };
  });
  const stories = docsOf(recorded, "posts").map((doc) => {
    const data = doc.data;
    return {
      title: data.title,
      slug: data.slug,
      // Studio's story date is a calendar day (stored at midday UTC): the
      // brand's own date, not its clock time.
      published_at: data.publishedAt ? `${day(data.publishedAt)}T12:00:00.000Z` : null,
      category_recorded_id: data.category ?? null,
      ...(data.featuredImage ? { featured_image: media(data.featuredImage) } : {}),
      ...(data.excerpt ? { excerpt: data.excerpt } : {}),
      content: data.content,
      enabled: true,
    };
  });

  return {
    settings: {
      design: "voyage",
      tokens: {},
      fonts: {},
      radius: "design",
      button_shape: "design",
      motion: "design",
      ...(settings.siteName ? { display_name: settings.siteName } : {}),
      ...(settings.tagline ? { short_description: settings.tagline } : {}),
      logo: media(header.logo) ?? null,
      routes,
      language: "en",
      timezone: componentText.timezone ?? HISTORY_TIMEZONE_DEFAULT,
      redirects,
    },
    pages: sitePages,
    navigation,
    footer: siteFooter,
    categories,
    destinations,
    stories,
  };
}

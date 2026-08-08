'use strict';

const SHARE_FACTS_VERSION = 1;
const SHARE_ENTITY_KINDS = Object.freeze([
  'place', 'curated', 'event', 'rsvp_event', 'trip', 'experience', 'venue', 'brand',
]);
const SHARE_STATUSES = Object.freeze([
  'sold_out', 'ended', 'cancelled', 'rsvp_closed', 'date_tbd', 'dates_tbd',
]);
const SHARE_CHANNEL_BUDGETS = Object.freeze({
  generic: Object.freeze({ beforeUrl: 180, total: 230 }),
  sms: Object.freeze({ beforeUrl: 180, total: 230 }),
  whatsapp: Object.freeze({ beforeUrl: 180, total: 230 }),
  x: Object.freeze({ beforeUrl: 220, total: 280 }),
  email: Object.freeze({ beforeUrl: 420, total: 480 }),
});
const SHORT_CODE_RE = /^[0-9A-Za-z]{16}$/;
const HTTPS_RE = /^https:\/\//i;
const BIDI_CONTROL_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

const ROUTE_MANIFEST = Object.freeze({
  place: Object.freeze({ web: 'share', native: 'place', required: Object.freeze(['placeId']) }),
  curated: Object.freeze({ web: 'share', native: 'curated', required: Object.freeze([]) }),
  event: Object.freeze({ web: 'event', native: 'event', required: Object.freeze(['eventSlug']) }),
  rsvp_event: Object.freeze({ web: 'event', native: 'rsvp_event', required: Object.freeze(['eventSlug']) }),
  trip: Object.freeze({ web: 'trip', native: 'trip', required: Object.freeze(['eventSlug']) }),
  experience: Object.freeze({ web: 'experience', native: 'experience', required: Object.freeze(['eventSlug']) }),
  venue: Object.freeze({ web: 'venue', native: 'venue', required: Object.freeze(['brandSlug', 'venueSlug']) }),
  brand: Object.freeze({ web: 'brand', native: 'brand', required: Object.freeze(['brandSlug']) }),
});

const KIND_FIELDS = Object.freeze({
  place: ['category', 'area', 'rating', 'priceLevel', 'openState', 'planningPreference', 'description'],
  curated: ['stopCount', 'area', 'duration', 'estimate', 'planningPreference', 'description'],
  event: ['localDate', 'localTime', 'venue', 'area', 'price', 'availability', 'description'],
  rsvp_event: ['localDate', 'localTime', 'venue', 'rsvpDeadline', 'availability', 'description'],
  trip: ['destination', 'dateRange', 'duration', 'startingPrice', 'description'],
  experience: ['area', 'nextDate', 'duration', 'price', 'availability', 'description'],
  venue: ['category', 'area', 'nextPublicOffering', 'openState', 'description'],
  brand: ['category', 'area', 'upcomingPublicOfferingCount', 'description'],
});

const COMMON_FIELDS = Object.freeze(['schemaVersion', 'kind', 'title', 'status', 'timezone', 'media', 'route']);

function cleanText(value, max = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFC').replace(BIDI_CONTROL_RE, '').replace(CONTROL_RE, ' ')
    .replace(/\s+/gu, ' ').trim();
  return Array.from(normalized).slice(0, max).join('').trim();
}

function cleanHttpsUrl(value) {
  const text = cleanText(value, 2048);
  if (!HTTPS_RE.test(text)) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isShortShareCode(value) {
  return typeof value === 'string' && SHORT_CODE_RE.test(value);
}

function buildShortShareUrl(code) {
  if (!isShortShareCode(code)) throw new TypeError('invalid_share_code');
  return `https://usemingla.com/s/${code}`;
}

function cleanMoney(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const minorUnits = value.minorUnits;
  const currency = cleanText(value.currency, 3).toUpperCase();
  const disclosure = value.disclosure == null ? null : cleanText(value.disclosure, 24);
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return { minorUnits, currency, ...(disclosure ? { disclosure } : {}) };
}

function formatMoney(value) {
  const money = cleanMoney(value);
  if (!money) return '';
  try {
    const rendered = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: money.currency,
      minimumFractionDigits: money.minorUnits % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(money.minorUnits / 100);
    return money.disclosure ? `${money.disclosure} ${rendered}` : rendered;
  } catch {
    return '';
  }
}

function cleanMedia(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['photo', 'gif', 'video'].includes(value.kind)) return null;
  const url = cleanHttpsUrl(value.url);
  const posterUrl = cleanHttpsUrl(value.posterUrl);
  if (!url || (value.kind !== 'photo' && !posterUrl)) return null;
  const focalPoint = value.focalPoint && typeof value.focalPoint === 'object'
    && Number.isFinite(value.focalPoint.x) && Number.isFinite(value.focalPoint.y)
    && value.focalPoint.x >= 0 && value.focalPoint.x <= 1
    && value.focalPoint.y >= 0 && value.focalPoint.y <= 1
    ? { x: value.focalPoint.x, y: value.focalPoint.y } : undefined;
  return {
    kind: value.kind, url, posterUrl: posterUrl || url,
    ...(focalPoint ? { focalPoint } : {}),
    ...(cleanText(value.alt, 240) ? { alt: cleanText(value.alt, 240) } : {}),
  };
}

function cleanDestination(kind, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const route = ROUTE_MANIFEST[kind];
  const destination = { kind };
  for (const key of route.required) {
    const text = cleanText(value[key], 256);
    if (!text) return null;
    destination[key] = text;
  }
  return destination;
}

function cleanScalar(key, value) {
  if (['stopCount', 'upcomingPublicOfferingCount'].includes(key)) {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (key === 'rating') return Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
  if (['price', 'startingPrice', 'estimate'].includes(key)) return cleanMoney(value) || undefined;
  const limits = { description: 600, planningPreference: 100, timezone: 80 };
  const text = cleanText(value, limits[key] || 160);
  return text || undefined;
}

function validateShareFactsV1(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['facts_object_required'] };
  const kind = input.kind;
  if (!SHARE_ENTITY_KINDS.includes(kind)) errors.push('invalid_kind');
  if (input.schemaVersion !== SHARE_FACTS_VERSION) errors.push('invalid_schema_version');
  const title = cleanText(input.title, 160);
  if (!title) errors.push('title_required');
  if (input.status != null && !SHARE_STATUSES.includes(input.status)) errors.push('invalid_status');
  if (errors.length) return { ok: false, errors };

  const allowed = new Set([...COMMON_FIELDS, ...KIND_FIELDS[kind]]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) return { ok: false, errors: unexpected.map((key) => `unexpected_field:${key}`) };

  const value = { schemaVersion: 1, kind, title };
  if (input.status) value.status = input.status;
  const timezone = cleanScalar('timezone', input.timezone);
  if (timezone) value.timezone = timezone;
  for (const key of KIND_FIELDS[kind]) {
    const cleaned = cleanScalar(key, input[key]);
    if (cleaned !== undefined && !(key === 'upcomingPublicOfferingCount' && cleaned === 0)) value[key] = cleaned;
  }
  if (input.media != null) {
    const media = cleanMedia(input.media);
    if (!media) return { ok: false, errors: ['invalid_media'] };
    value.media = media;
  }
  if (input.route != null) {
    const destination = cleanDestination(kind, input.route);
    if (!destination) return { ok: false, errors: ['invalid_destination'] };
    value.route = destination;
  }
  return { ok: true, value };
}

function parseShareFactsV1(input) {
  const result = validateShareFactsV1(input);
  if (!result.ok) throw new TypeError(`invalid_share_facts:${result.errors.join(',')}`);
  return result.value;
}

function formatRating(value) {
  return Number.isFinite(value) && value >= 0 && value <= 5 ? `${Number(value.toFixed(1))}/5` : '';
}

function statusLabel(status) {
  return ({ sold_out: 'Sold out', ended: 'Ended', cancelled: 'Cancelled', rsvp_closed: 'RSVP closed', date_tbd: 'Date TBD', dates_tbd: 'Dates TBD' })[status] || '';
}

function selectRecipientFacts(input, context = {}) {
  const facts = parseShareFactsV1(input);
  const add = (items, value) => { const text = cleanText(value, 120); if (text) items.push(text); };
  const items = [];
  switch (facts.kind) {
    case 'place':
      add(items, facts.category); add(items, facts.area); add(items, formatRating(facts.rating)); add(items, facts.priceLevel); add(items, facts.openState);
      if (context.includePlanningPreference !== false) add(items, facts.planningPreference);
      break;
    case 'curated':
      add(items, Number.isInteger(facts.stopCount) ? `${facts.stopCount} stop${facts.stopCount === 1 ? '' : 's'}` : '');
      add(items, facts.area); add(items, facts.duration); add(items, formatMoney(facts.estimate));
      if (context.includePlanningPreference !== false) add(items, facts.planningPreference);
      break;
    case 'event':
      add(items, [facts.localDate, facts.localTime].filter(Boolean).join(' at ')); add(items, facts.venue || facts.area); add(items, formatMoney(facts.price)); add(items, facts.availability); break;
    case 'rsvp_event':
      add(items, [facts.localDate, facts.localTime].filter(Boolean).join(' at ')); add(items, facts.venue); add(items, facts.rsvpDeadline); add(items, facts.availability); break;
    case 'trip':
      add(items, facts.destination); add(items, facts.dateRange); add(items, facts.duration); add(items, formatMoney(facts.startingPrice)); break;
    case 'experience':
      add(items, facts.area); add(items, facts.nextDate); add(items, facts.duration); add(items, formatMoney(facts.price)); add(items, facts.availability); break;
    case 'venue':
      add(items, facts.category); add(items, facts.area); add(items, facts.nextPublicOffering); add(items, facts.openState); break;
    case 'brand':
      add(items, facts.category); add(items, facts.area);
      if (facts.upcomingPublicOfferingCount > 0) add(items, `${facts.upcomingPublicOfferingCount} upcoming`);
      break;
  }
  if (!items.length) add(items, facts.description);
  return items;
}

function leadFor(facts) {
  const area = facts.area || facts.destination;
  switch (facts.kind) {
    case 'place': return area ? `How about ${facts.title} in ${area}?` : `How about ${facts.title}?`;
    case 'curated': return facts.stopCount != null
      ? `${facts.title}: ${facts.stopCount} stop${facts.stopCount === 1 ? '' : 's'}${area ? ` around ${area}` : ''}.`
      : `${facts.title}${area ? ` around ${area}` : ''}.`;
    case 'event': return `${facts.title} is ${[facts.localDate, facts.localTime].filter(Boolean).join(' at ') || 'coming up'}${facts.venue ? ` at ${facts.venue}` : ''}.`;
    case 'rsvp_event': return `Want to join ${facts.title}?${facts.localDate || facts.localTime || facts.venue ? ` ${[facts.localDate, facts.localTime].filter(Boolean).join(' at ')}${facts.venue ? ` at ${facts.venue}` : ''}.` : ''}`;
    case 'trip': return `${facts.title}${facts.destination ? ` in ${facts.destination}` : ''}${facts.dateRange ? `, ${facts.dateRange}` : ''}.`;
    case 'experience': return `${facts.title}${area ? ` in ${area}` : ''}.`;
    case 'venue': return `Check out ${facts.title}${area ? ` in ${area}` : ''}.`;
    case 'brand': return `See what ${facts.title} has coming up${area ? ` in ${area}` : ''}.`;
  }
}

function trimAtWord(value, max) {
  const chars = Array.from(cleanText(value, max + 40));
  if (chars.length <= max) return chars.join('');
  const clipped = chars.slice(0, max + 1).join('');
  const boundary = clipped.search(/\s+\S*$/u);
  return `${(boundary > 0 ? clipped.slice(0, boundary) : chars.slice(0, max).join('')).trim()}…`;
}

function buildShareMessage(input, context) {
  const facts = parseShareFactsV1(input);
  const channel = SHARE_CHANNEL_BUDGETS[context?.channel] ? context.channel : 'generic';
  const budget = SHARE_CHANNEL_BUDGETS[channel];
  const shortUrl = buildShortShareUrl(context?.shortCode);
  const note = cleanText(context?.senderNote, 120);
  const status = statusLabel(facts.status);
  const candidates = selectRecipientFacts(facts).filter((fact) => !leadFor(facts).includes(fact));
  const detail = status || candidates[0] || '';
  const authored = note ? `From the sender: ${note}` : '';
  const sentences = [leadFor(facts), detail ? `${detail}${/[.!?]$/u.test(detail) ? '' : '.'}` : '', authored].filter(Boolean);
  let body = sentences.join(' ');
  if (Array.from(body).length > budget.beforeUrl) {
    body = trimAtWord([leadFor(facts), status].filter(Boolean).join(' '), budget.beforeUrl);
  }
  const maxBodyForTotal = budget.total - Array.from(shortUrl).length - 2;
  if (Array.from(body).length > maxBodyForTotal) body = trimAtWord(body, maxBodyForTotal);
  return `${body}\n\n${shortUrl}`;
}

function selectPreviewFacts(input, limit = 4) {
  const facts = parseShareFactsV1(input);
  const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : 4;
  return selectRecipientFacts(facts, { includePlanningPreference: false }).slice(0, safeLimit);
}

function routeContractFor(kind) {
  if (!SHARE_ENTITY_KINDS.includes(kind)) throw new TypeError('invalid_share_kind');
  return ROUTE_MANIFEST[kind];
}

module.exports = {
  SHARE_FACTS_VERSION, SHARE_ENTITY_KINDS, SHARE_STATUSES, SHARE_CHANNEL_BUDGETS,
  ROUTE_MANIFEST, cleanText, cleanHttpsUrl, cleanMoney, cleanMedia, cleanDestination,
  isShortShareCode, buildShortShareUrl, validateShareFactsV1, parseShareFactsV1,
  formatMoney, formatRating, statusLabel, selectRecipientFacts, selectPreviewFacts,
  buildShareMessage, routeContractFor,
};

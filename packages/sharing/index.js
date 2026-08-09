'use strict';

const SHARE_FACTS_VERSION = 1;
const SHARE_PORTRAIT_REVISION = 2;
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
const REFERRAL_CODE_RE = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;
const HTTPS_RE = /^https:\/\//i;
const BIDI_CONTROL_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const CONTENT_SHARE_NOTE_MAX_GRAPHEMES = 120;
const readinessFlight = createContentShareSingleFlight();

async function checkContentShareReadiness(code, version, fetchImpl = fetch) {
  if (!isShortShareCode(code) || !Number.isSafeInteger(version) || version < 1) throw new TypeError('invalid_share_readiness_identity');
  return readinessFlight(`${code}:${version}`, async () => {
    try {
      const response = await fetchImpl(`https://usemingla.com/api/content-share-readiness/${code}/${version}`, {
        method: 'GET', redirect: 'manual', cache: 'no-store',
      });
      if (response.status === 200) return 'ready';
      if (response.status === 410) return 'terminal';
      if (response.status === 404) return 'terminal';
      if (response.status === 503) return 'waiting';
      return 'transient';
    } catch { return 'transient'; }
  });
}

function segmentGraphemes(value) {
  const normalized = typeof value === 'string' ? value.normalize('NFC') : '';
  if (typeof Intl?.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized), (part) => part.segment);
  }
  // There is no honest code-point fallback for Unicode extended grapheme
  // clusters: Array.from() still splits flags, modifiers, ZWJ families, and
  // combining sequences. Refuse the operation on an unsupported engine so a
  // note is never silently counted or truncated at the wrong boundary.
  throw new TypeError('grapheme_segmenter_unavailable');
}

function normalizeContentShareNote(value) {
  if (typeof value !== 'string') return { note: null, graphemeCount: 0 };
  const normalized = value.normalize('NFC').replace(BIDI_CONTROL_RE, '').replace(CONTROL_RE, ' ')
    .replace(/[\t\r\n ]+/gu, ' ').trim();
  if (!normalized) return { note: null, graphemeCount: 0 };
  const graphemes = segmentGraphemes(normalized);
  if (graphemes.length > CONTENT_SHARE_NOTE_MAX_GRAPHEMES) {
    return { note: graphemes.slice(0, CONTENT_SHARE_NOTE_MAX_GRAPHEMES).join(''), graphemeCount: CONTENT_SHARE_NOTE_MAX_GRAPHEMES };
  }
  return { note: normalized, graphemeCount: graphemes.length };
}

function createContentShareSingleFlight() {
  const pending = new Map();
  return async (key, load) => {
    let promise = pending.get(key);
    if (!promise) {
      promise = Promise.resolve().then(load);
      pending.set(key, promise);
    }
    try {
      return await promise;
    } finally {
      if (pending.get(key) === promise) pending.delete(key);
    }
  };
}

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
  place: ['category', 'area', 'rating', 'priceLevel', 'openState', 'hours', 'description'],
  curated: ['stopCount', 'area', 'duration', 'estimate', 'description'],
  event: ['localDate', 'localTime', 'venue', 'area', 'price', 'availability', 'description'],
  rsvp_event: ['localDate', 'localTime', 'venue', 'rsvpDeadline', 'availability', 'description'],
  trip: ['destination', 'dateRange', 'duration', 'startingPrice', 'description'],
  experience: ['area', 'nextDate', 'duration', 'price', 'availability', 'description'],
  venue: ['category', 'area', 'nextPublicOffering', 'openState', 'hours', 'description'],
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

function sanitizeReferralCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return REFERRAL_CODE_RE.test(normalized) ? normalized : null;
}

function buildShortShareUrl(code) {
  if (!isShortShareCode(code)) throw new TypeError('invalid_share_code');
  // SHARE-CANONICAL-URL-BUILDER
  return `https://usemingla.com/s/${code}`;
}

function buildSharePortraitUrl(code, version) {
  if (!isShortShareCode(code) || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('invalid_share_portrait_identity');
  }
  return `https://usemingla.com/og/s/${code}/v${version}-r${SHARE_PORTRAIT_REVISION}.jpg`;
}

function contentShareRequestFromPublicUrl(value, overrideKind) {
  let parsed; try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.port || !['business.usemingla.com', 'usemingla.com'].includes(parsed.hostname)) return null;
  let parts; try { parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
  if (parts[0] === 'e' && parts[1] && parts[2]) return { kind: overrideKind === 'rsvp_event' ? 'rsvp_event' : 'event', identity:{brandSlug:parts[1],eventSlug:parts[2]} };
  if (parts[0] === 't' && parts[1] && parts[2]) return { kind:'trip', identity:{brandSlug:parts[1],eventSlug:parts[2]} };
  if (parts[0] === 'exp' && parts[1] && parts[2]) return { kind:'experience', identity:{brandSlug:parts[1],eventSlug:parts[2]} };
  if (parts[0] === 'b' && parts[1] && parts[2] === 'v' && parts[3]) return { kind:'venue', identity:{brandSlug:parts[1],venueSlug:parts[3]} };
  if (parts[0] === 'b' && parts[1] && parts.length === 2) return { kind:'brand', identity:{brandSlug:parts[1]} };
  return null;
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
  if (money.minorUnits === 0 && money.disclosure === 'Free') return 'Free';
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

function formatEstimate(value) {
  const money = cleanMoney(value);
  const raw = money ? formatMoney(money) : cleanText(value, 80);
  if (!raw) return '';
  const range = raw.match(/(?:[$£€]\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:-|–|—|to)\s*(?:[$£€]\s*)?(\d[\d,]*(?:\.\d+)?)/iu);
  if (range) {
    const lower = Number(range[1].replace(/,/g, ''));
    const upper = Number(range[2].replace(/,/g, ''));
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) return '';
  }
  return /^(?:estimated|estimate|approx(?:\.|imately)?|about|from|up to)(?=\s|$)/iu.test(raw)
    ? raw : `Estimated ${raw}`;
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

function isPublicShareMediaUrl(value, allowedBunnyHosts = []) {
  const url = cleanHttpsUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  if (parsed.port) return false;
  const host = parsed.hostname.toLowerCase();
  if (['usemingla.com', 'www.usemingla.com', 'business.usemingla.com'].includes(host)) return true;
  if (host === 'images.pexels.com' || host === 'videos.pexels.com') return true;
  if (['i.giphy.com', 'media.giphy.com'].includes(host)) return true;
  if (host === 'vz-a16fce08-6c6.b-cdn.net') return true;
  if (Array.isArray(allowedBunnyHosts) && allowedBunnyHosts.includes(host)) return true;
  return host === 'gqnoajqerqhnvulmnyvv.supabase.co'
    && parsed.pathname.startsWith('/storage/v1/object/public/');
}

function selectPublicMediaIdentity(candidates, options = {}) {
  const allowedBunnyHosts = Array.isArray(options.allowedBunnyHosts) ? options.allowedBunnyHosts : [];
  const source = candidates && typeof candidates === 'object' && !Array.isArray(candidates) ? candidates : {};
  const eligible = (candidate) => candidate && candidate.publicSafe === true
    && isPublicShareMediaUrl(candidate.url, allowedBunnyHosts);
  const poster = (candidate) => candidate && candidate.publicSafe === true
    && isPublicShareMediaUrl(candidate.posterUrl, allowedBunnyHosts) ? candidate.posterUrl : null;
  for (const key of ['video', 'animated', 'photo']) {
    const candidate = source[key];
    if (!eligible(candidate)) continue;
    const kind = key === 'animated' ? 'gif' : key;
    const posterUrl = kind === 'photo' ? candidate.url : poster(candidate);
    if (!posterUrl || (kind === 'video' && candidate.authored !== true)) continue;
    return cleanMedia({ kind, url: candidate.url, posterUrl, focalPoint: candidate.focalPoint, alt: candidate.alt });
  }
  return null;
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
  if (key === 'hours') {
    if (!Array.isArray(value) || value.length !== 7) return undefined;
    const rows = value.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const day = cleanText(row.day, 12); const label = cleanText(row.label, 80); const special = cleanText(row.special, 120);
      return day && label ? { day, label, ...(row.isToday === true ? { isToday: true } : {}), ...(special ? { special } : {}) } : null;
    });
    return rows.every(Boolean) ? rows : undefined;
  }
  if (['stopCount', 'upcomingPublicOfferingCount'].includes(key)) {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (key === 'rating') return Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
  if (key === 'estimate') return formatEstimate(value) || undefined;
  if (['price', 'startingPrice'].includes(key)) return cleanMoney(value) || undefined;
  const limits = { description: 600, timezone: 80 };
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

function shareKindLabel(kind) {
  return ({ place: 'Place', curated: 'Curated plan', event: 'Event', rsvp_event: 'RSVP event', trip: 'Trip', experience: 'Experience', venue: 'Venue', brand: 'Brand' })[kind] || '';
}

const WEEKDAYS = Object.freeze(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']);
function shareClock(timezone, now = new Date()) {
  const zone=cleanText(timezone,80);const fixed=/^UTC_OFFSET:([+-]?\d{1,4})$/.exec(zone);
  if(fixed){const offset=Number(fixed[1]);if(!Number.isInteger(offset)||offset < -840||offset > 840)return null;const local=new Date(now.getTime()+offset*60000);return{day:WEEKDAYS[local.getUTCDay()],minutes:local.getUTCHours()*60+local.getUTCMinutes()};}
  try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const day=parts.find((part)=>part.type==='weekday')?.value;const hour=Number(parts.find((part)=>part.type==='hour')?.value);const minute=Number(parts.find((part)=>part.type==='minute')?.value);return WEEKDAYS.includes(day)&&Number.isInteger(hour)&&Number.isInteger(minute)?{day,minutes:hour*60+minute}:null;}catch{return null;}
}
function weekdayForShareTimezone(timezone, now = new Date()) { return shareClock(timezone,now)?.day || ''; }
function parseHoursIntervals(label) {
  const text=cleanText(label,80);if(/^open 24 hours$/i.test(text))return[[0,1440]];if(/^closed$/i.test(text))return[];
  const matches=[...text.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi)];if(matches.length===0||matches.length%2!==0)return null;
  const value=(match)=>{const hour=Number(match[1]),minute=Number(match[2]||0);if(hour<1||hour>12||minute>59)return null;return (hour%12+(match[3].toUpperCase()==='PM'?12:0))*60+minute;};
  const intervals=[];for(let index=0;index<matches.length;index+=2){const start=value(matches[index]),end=value(matches[index+1]);if(start===null||end===null)return null;intervals.push([start,end]);}return intervals;
}
function openStateForHours(hours, timezone, now = new Date()) {
  if(!Array.isArray(hours)||hours.length!==7)return '';
  const clock=shareClock(timezone,now);if(!clock)return '';
  const todayIndex=WEEKDAYS.indexOf(clock.day),today=hours.find((row)=>row&&row.day===clock.day),previous=hours.find((row)=>row&&row.day===WEEKDAYS[(todayIndex+6)%7]);
  const current=parseHoursIntervals(today?.label),prior=parseHoursIntervals(previous?.label);if(current===null||prior===null)return '';
  if(current.some(([start,end])=>start===0&&end===1440||(end>start?clock.minutes>=start&&clock.minutes<end:clock.minutes>=start)))return 'Open now';
  if(prior.some(([start,end])=>end<=start&&clock.minutes<end))return 'Open now';
  return 'Closed';
}

function selectRecipientFacts(input, context = {}) {
  const facts = parseShareFactsV1(input);
  const add = (items, value) => { const text = cleanText(value, 120); if (text) items.push(text); };
  const items = [];
  switch (facts.kind) {
    case 'place':
      add(items, facts.category); add(items, facts.area); add(items, formatRating(facts.rating)); add(items, facts.priceLevel); add(items, facts.openState);
      break;
    case 'curated':
      add(items, Number.isInteger(facts.stopCount) ? `${facts.stopCount} stop${facts.stopCount === 1 ? '' : 's'}` : '');
      add(items, facts.area); add(items, facts.duration); add(items, formatEstimate(facts.estimate));
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
      ? `${facts.title} is a ${facts.stopCount}-stop plan${area ? ` around ${area}` : ''}.`
      : `${facts.title} is a plan${area ? ` around ${area}` : ''}.`;
    case 'event': {
      const when = [facts.localDate, facts.localTime].filter(Boolean).join(' at ');
      return `${facts.title}${when ? ` is ${when}` : ''}${facts.venue ? `${when ? ' at' : ' at'} ${facts.venue}` : ''}.`;
    }
    case 'rsvp_event': return `Want to join ${facts.title}?${facts.localDate || facts.localTime || facts.venue ? ` ${[facts.localDate, facts.localTime].filter(Boolean).join(' at ')}${facts.venue ? ` at ${facts.venue}` : ''}.` : ''}`;
    case 'trip': return `${facts.title}${facts.dateRange ? ` runs ${facts.dateRange}` : ''}${facts.destination ? ` in ${facts.destination}` : ''}.`;
    case 'experience': return `How about ${facts.title}${area ? ` in ${area}` : ''}?`;
    case 'venue': return `Check out ${facts.title}${area ? ` in ${area}` : ''}.`;
    case 'brand': return `See what ${facts.title} has coming up${area ? ` in ${area}` : ''}.`;
  }
}

function formatPlanningPreference(value) {
  if (typeof value === 'string') return cleanText(value, 80);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const day = cleanText(value.dayOfWeek, 24).toLowerCase();
  const time = cleanText(value.timeOfDay, 24).toLowerCase();
  const timeframe = cleanText(value.planningTimeframe, 40).toLowerCase();
  const prefix = day === 'weekend' ? 'one ' : '';
  return cleanText(`${prefix}${[day, time, timeframe].filter(Boolean).join(' ')}`, 80);
}

function messageDetailCandidates(facts, planningPreference) {
  const add = (items, value) => { const text = cleanText(value, 120); if (text) items.push(text); };
  const items = [];
  switch (facts.kind) {
    case 'place':
      add(items, facts.category);
      add(items, formatRating(facts.rating) ? `Rated ${formatRating(facts.rating)}` : '');
      add(items, facts.priceLevel);
      if (planningPreference) add(items, `Maybe ${planningPreference}`);
      break;
    case 'curated':
      add(items, facts.duration);
      add(items, formatEstimate(facts.estimate));
      if (planningPreference) add(items, `Maybe ${planningPreference}`);
      break;
    case 'event':
      add(items, formatMoney(facts.price)); add(items, facts.availability); break;
    case 'rsvp_event':
      add(items, facts.availability); add(items, facts.rsvpDeadline); break;
    case 'trip':
      add(items, facts.duration); add(items, formatMoney(facts.startingPrice)); break;
    case 'experience':
      add(items, facts.nextDate); add(items, facts.duration); add(items, formatMoney(facts.price)); add(items, facts.availability); break;
    case 'venue':
      add(items, facts.category); add(items, facts.nextPublicOffering); add(items, facts.openState); break;
    case 'brand':
      if (facts.upcomingPublicOfferingCount > 0) add(items, `${facts.upcomingPublicOfferingCount} upcoming`);
      add(items, facts.category); break;
  }
  if (!items.length) add(items, facts.description);
  return items;
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
  const note = normalizeContentShareNote(context?.senderNote).note || '';
  const planningPreference = facts.kind === 'place' || facts.kind === 'curated'
    ? formatPlanningPreference(context?.planningPreference) : '';
  const status = statusLabel(facts.status);
  const candidates = messageDetailCandidates(facts, planningPreference);
  const details = status ? [status] : candidates.slice(0, 1);
  const authored = note ? `From the sender: ${note}` : '';
  const detail = details.join(' · ');
  const deterministic = [leadFor(facts), detail ? `${detail}${/[.!?]$/u.test(detail) ? '' : '.'}` : ''].filter(Boolean).join(' ');
  let body = [authored, deterministic].filter(Boolean).join('\n');
  if (Array.from(body).length > budget.beforeUrl) {
    body = trimAtWord([authored, leadFor(facts), status].filter(Boolean).join('\n'), budget.beforeUrl);
  }
  const maxBodyForTotal = budget.total - Array.from(shortUrl).length - 2;
  if (Array.from(body).length > maxBodyForTotal) body = trimAtWord(body, maxBodyForTotal);
  return `${body}\n\n${shortUrl}`;
}

function selectPreviewFacts(input, limit = 4) {
  const facts = parseShareFactsV1(input);
  const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : 4;
  return selectRecipientFacts(facts).slice(0, safeLimit);
}

function selectCompactPreviewFacts(input, limit = 4) {
  const facts = parseShareFactsV1(input);
  const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : 4;
  const normalizedStatus = cleanText(statusLabel(facts.status), 120).toLocaleLowerCase();
  return selectRecipientFacts(facts)
    .filter((item) => !normalizedStatus || cleanText(item, 120).toLocaleLowerCase() !== normalizedStatus)
    .slice(0, safeLimit);
}

function routeContractFor(kind) {
  if (!SHARE_ENTITY_KINDS.includes(kind)) throw new TypeError('invalid_share_kind');
  return ROUTE_MANIFEST[kind];
}

module.exports = {
  SHARE_FACTS_VERSION, SHARE_PORTRAIT_REVISION, SHARE_ENTITY_KINDS, SHARE_STATUSES, SHARE_CHANNEL_BUDGETS,
  CONTENT_SHARE_NOTE_MAX_GRAPHEMES, segmentGraphemes, normalizeContentShareNote,
  ROUTE_MANIFEST, cleanText, cleanHttpsUrl, cleanMoney, cleanMedia, cleanDestination,
  isPublicShareMediaUrl, selectPublicMediaIdentity,
  isShortShareCode, sanitizeReferralCode, buildShortShareUrl, buildSharePortraitUrl, contentShareRequestFromPublicUrl, validateShareFactsV1, parseShareFactsV1,
  formatMoney, formatEstimate, formatRating, statusLabel, shareKindLabel, formatPlanningPreference, selectRecipientFacts, selectPreviewFacts, selectCompactPreviewFacts,
  buildShareMessage, routeContractFor, createContentShareSingleFlight, checkContentShareReadiness, weekdayForShareTimezone, openStateForHours,
};

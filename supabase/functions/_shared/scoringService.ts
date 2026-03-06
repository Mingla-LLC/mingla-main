/**
 * Scoring Service — 5-factor scoring algorithm for card ranking.
 *
 * Factors and weights:
 *   Category Match:  3.0  (binary: card category in user's selected categories)
 *   Tag Overlap:     1.6  (placeType/placeTypeLabel matched against category keywords)
 *   Popularity:      0.6  (rating + log-scaled review count)
 *   Quality:         0.4  (presence of image, rating, address, opening hours)
 *   Text Relevance:  1.3  (category keyword matches in title/address/placeType)
 *
 * Max raw score = 6.9. Final score = round((raw / 6.9) * 100) → 0–100.
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ScoringFactors {
  categoryMatch: number;      // 0 or 1
  tagOverlap: number;         // 0.0–1.0
  popularity: number;         // 0.0–1.0
  quality: number;            // 0.0–1.0
  textRelevance: number;      // 0.0–1.0
}

export interface ScoringParams {
  categories: string[];       // user's selected categories
  priceTiers: string[];       // user's selected price tiers
}

export interface ScoredCard {
  card: any;
  matchScore: number;         // 0–100
  factors: ScoringFactors;
}

// ── Constants ───────────────────────────────────────────────────────────────

const WEIGHTS = {
  categoryMatch: 3.0,
  tagOverlap: 1.6,
  popularity: 0.6,
  quality: 0.4,
  textRelevance: 1.3,
} as const;

const MAX_SCORE = WEIGHTS.categoryMatch + WEIGHTS.tagOverlap + WEIGHTS.popularity + WEIGHTS.quality + WEIGHTS.textRelevance; // 6.9

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from',
  '&', 'is', 'it', 'as', 'be', 'are', 'was', 'were',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Build keyword set from category display names.
 * "Fine Dining" → ["fine", "dining"]
 * "Creative & Arts" → ["creative", "arts"]
 */
function buildKeywords(categories: string[]): string[] {
  const keywords: string[] = [];
  for (const cat of categories) {
    const words = cat.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (!STOP_WORDS.has(word) && word.length > 0) {
        keywords.push(word);
      }
    }
  }
  return keywords;
}

// ── Factor Calculators ──────────────────────────────────────────────────────

function calcCategoryMatch(card: any, categories: string[]): number {
  if (categories.length === 0) return 0;
  const cardCategory = (card.category || '').toString();
  return categories.includes(cardCategory) ? 1.0 : 0.0;
}

function calcTagOverlap(card: any, keywords: string[]): number {
  const tags: string[] = [];
  if (card.placeType) tags.push(card.placeType.toLowerCase());
  if (card.placeTypeLabel) tags.push(card.placeTypeLabel.toLowerCase());
  // Also handle snake_case variants: split on underscores
  const expandedTags: string[] = [];
  for (const tag of tags) {
    expandedTags.push(tag);
    if (tag.includes('_')) {
      expandedTags.push(...tag.split('_'));
    }
  }

  if (expandedTags.length === 0 || keywords.length === 0) return 0;

  const tagSet = new Set(expandedTags);
  let matchCount = 0;
  for (const keyword of keywords) {
    if (tagSet.has(keyword)) {
      matchCount++;
    }
  }
  return clamp(matchCount / keywords.length, 0, 1);
}

function calcPopularity(card: any): number {
  const rating = typeof card.rating === 'number' ? card.rating : 0;
  const reviewCount = typeof card.reviewCount === 'number' ? card.reviewCount : (typeof card.userRatingCount === 'number' ? card.userRatingCount : 0);

  const ratingScore = rating / 5;
  const reviewScore = Math.min(Math.log10(reviewCount + 1) / 4, 1);
  return clamp((ratingScore + reviewScore) / 2, 0, 1);
}

function calcQuality(card: any): number {
  let score = 0;
  if (card.imageUrl || card.image_url || card.photoUrl) score += 0.25;
  if (typeof card.rating === 'number' && card.rating > 0) score += 0.25;
  if (card.address || card.formattedAddress) score += 0.25;
  if (card.openingHours || card.opening_hours || card.currentOpeningHours) score += 0.25;
  return clamp(score, 0, 1);
}

function calcTextRelevance(card: any, keywords: string[]): number {
  if (keywords.length === 0) return 0;

  const text = [
    card.title || card.name || '',
    card.address || card.formattedAddress || '',
    card.placeType || '',
  ].join(' ').toLowerCase();

  if (!text.trim()) return 0;

  let matchCount = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      matchCount++;
    }
  }
  return clamp(matchCount / keywords.length, 0, 1);
}

// ── Main ────────────────────────────────────────────────────────────────────

export function scoreCards(
  cards: any[],
  params: ScoringParams,
): ScoredCard[] {
  if (cards.length === 0) return [];

  const keywords = buildKeywords(params.categories);

  return cards.map((card) => {
    const factors: ScoringFactors = {
      categoryMatch: calcCategoryMatch(card, params.categories),
      tagOverlap: calcTagOverlap(card, keywords),
      popularity: calcPopularity(card),
      quality: calcQuality(card),
      textRelevance: calcTextRelevance(card, keywords),
    };

    const rawScore =
      factors.categoryMatch * WEIGHTS.categoryMatch +
      factors.tagOverlap * WEIGHTS.tagOverlap +
      factors.popularity * WEIGHTS.popularity +
      factors.quality * WEIGHTS.quality +
      factors.textRelevance * WEIGHTS.textRelevance;

    const matchScore = Math.round((rawScore / MAX_SCORE) * 100);

    return {
      card,
      matchScore: clamp(matchScore, 0, 100),
      factors,
    };
  });
}

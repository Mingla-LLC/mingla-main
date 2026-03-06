/**
 * Copy Enrichment Service — AI-generated one-liner and tip for cards.
 *
 * Uses a SINGLE OpenAI prompt to enrich multiple cards at once.
 * Gracefully degrades: returns empty Map on any error.
 */

import { timeoutFetch } from './timeoutFetch.ts';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface CopyResult {
  oneLiner: string;   // max 14 words
  tip: string;        // max 18 words
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function enrichCardsWithCopy(
  cards: Array<{
    id: string;
    title: string;
    category: string;
    address?: string;
    rating?: number;
    priceTier?: string;
  }>,
  openaiApiKey: string,
  options?: {
    timeoutMs?: number;  // default 10000
    maxCards?: number;    // default 10
  },
): Promise<Map<string, CopyResult>> {
  const result = new Map<string, CopyResult>();

  try {
    if (!cards.length || !openaiApiKey) return result;

    const timeoutMs = options?.timeoutMs ?? 10000;
    const maxCards = options?.maxCards ?? 10;
    const batch = cards.slice(0, maxCards);

    const cardDescriptions = batch.map((c, i) =>
      `${i + 1}. id="${c.id}" title="${c.title}" category="${c.category}"${c.address ? ` address="${c.address}"` : ''}${c.rating != null ? ` rating=${c.rating}` : ''}${c.priceTier ? ` priceTier="${c.priceTier}"` : ''}`
    ).join('\n');

    const prompt = `You are a creative copywriter for a date/experience planning app called Mingla. For each place below, write:
- "oneLiner": A catchy, fun description (max 14 words). Should make someone excited to visit.
- "tip": A practical insider tip (max 18 words). Something useful like best time to go, what to order, etc.

Return a JSON object with card IDs as keys, each containing "oneLiner" and "tip" strings.

Places:
${cardDescriptions}

Respond ONLY with valid JSON. Example format:
{
  "card-id-1": { "oneLiner": "Your catchy one-liner here", "tip": "Your practical tip here" },
  "card-id-2": { "oneLiner": "Another one-liner", "tip": "Another tip" }
}`;

    const response = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
      timeoutMs,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: batch.length * 80,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error(`[copyEnrichment] OpenAI error: ${response.status} ${response.statusText}`);
      return result;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return result;

    const parsed = JSON.parse(content);

    for (const card of batch) {
      const entry = parsed[card.id];
      if (entry && typeof entry.oneLiner === 'string' && typeof entry.tip === 'string') {
        result.set(card.id, {
          oneLiner: entry.oneLiner,
          tip: entry.tip,
        });
      }
    }

    return result;
  } catch (err) {
    console.error('[copyEnrichment] Graceful degradation — returning empty Map:', err);
    return result;
  }
}

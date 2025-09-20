import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CardData {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  priceLevel: number;
  estimatedCostPerPerson: number;
  address: string;
  imageUrl?: string;
}

interface UserPreferences {
  budget: { min: number; max: number; perPerson: boolean };
  categories: string[];
  location?: string;
  travelMode?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cards, preferences } = await req.json() as {
      cards: CardData[];
      preferences: UserPreferences;
    };

    console.log('Enhancing cards with OpenAI:', { cardsCount: cards.length, preferences });

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ enhancedCards: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enhance cards in parallel but limit to avoid rate limits
    const enhancedCards = await Promise.all(
      cards.slice(0, 10).map(async (card) => {
        try {
          const prompt = `You are a dating and experience expert. Create engaging, personalized copy for this date/activity.

Location: ${card.title} - ${card.address}
Category: ${card.category}
Price Range: ${card.priceLevel} (1-4 scale)
Estimated Cost: $${card.estimatedCostPerPerson} per person
User Budget: $${preferences.budget.min}-$${preferences.budget.max}
User Interests: ${preferences.categories.join(', ')}
Travel Mode: ${preferences.travelMode || 'driving'}

Generate:
1. A compelling one-liner (max 14 words) that makes this sound exciting and romantic
2. A practical tip (max 18 words) for making the most of this experience

Requirements:
- Focus on the romantic/dating aspect
- Make it sound premium and special
- No generic phrases
- Be specific to the location/activity type
- Consider the user's budget and interests
- Use actionable language

Format: Return only JSON with "oneLiner" and "tip" fields.`;

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4.1-2025-04-14',
              messages: [
                { 
                  role: 'system', 
                  content: 'You are a dating expert who creates compelling, personalized copy for romantic experiences. Always return valid JSON.' 
                },
                { role: 'user', content: prompt }
              ],
              max_completion_tokens: 150,
            }),
          });

          if (!response.ok) {
            console.error('OpenAI API error:', response.status, await response.text());
            throw new Error(`OpenAI API error: ${response.status}`);
          }

          const data = await response.json();
          const content = data.choices[0].message.content;
          
          console.log('OpenAI response for card:', card.id, content);

          let enhancedCopy;
          try {
            enhancedCopy = JSON.parse(content);
          } catch (parseError) {
            console.log('Failed to parse JSON, extracting manually');
            // Fallback parsing
            const oneLinearMatch = content.match(/"oneLiner":\s*"([^"]+)"/);
            const tipMatch = content.match(/"tip":\s*"([^"]+)"/);
            
            enhancedCopy = {
              oneLiner: oneLinearMatch ? oneLinearMatch[1] : `Amazing ${card.category.toLowerCase()} experience at ${card.title}`,
              tip: tipMatch ? tipMatch[1] : `Perfect for a memorable date, budget around $${card.estimatedCostPerPerson}`
            };
          }

          return {
            ...card,
            copy: {
              oneLiner: enhancedCopy.oneLiner || `Premium ${card.category.toLowerCase()} experience awaits`,
              tip: enhancedCopy.tip || `Ideal for dates, around $${card.estimatedCostPerPerson} per person`
            }
          };

        } catch (error) {
          console.error('Error enhancing card:', card.id, error);
          // Return card with fallback copy
          return {
            ...card,
            copy: {
              oneLiner: `Discover amazing ${card.category.toLowerCase()} at ${card.title}`,
              tip: `Perfect date spot with budget around $${card.estimatedCostPerPerson}`
            }
          };
        }
      })
    );

    console.log('Successfully enhanced cards:', enhancedCards.length);

    return new Response(JSON.stringify({ enhancedCards }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in enhance-cards function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      enhancedCards: [] 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
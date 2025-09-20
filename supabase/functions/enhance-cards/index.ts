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

interface DetailedUserPreferences {
  budget: { min: number; max: number; perPerson: boolean };
  categories: string[];
  experienceTypes?: string[];
  groupSize?: number;
  timeWindow?: {
    kind: string;
    timeOfDay?: string;
  };
  travel?: {
    mode: string;
    constraint: {
      type: string;
      maxMinutes?: number;
      maxDistance?: number;
    };
  };
  location?: {
    name: string;
    isCustom: boolean;
    lat?: number;
    lng?: number;
  };
  measurementSystem?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cards, preferences } = await req.json() as {
      cards: CardData[];
      preferences: DetailedUserPreferences;
    };

    console.log('Enhancing cards with comprehensive preferences:', { 
      cardsCount: cards.length, 
      preferencesKeys: Object.keys(preferences) 
    });

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ enhancedCards: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create detailed context from user preferences
    const createPersonalizationContext = (prefs: DetailedUserPreferences) => {
      let context = [];
      
      // Group context
      if (prefs.groupSize) {
        const groupType = prefs.groupSize === 1 ? 'solo experience' :
                         prefs.groupSize === 2 ? 'intimate date for two' :
                         prefs.groupSize <= 4 ? 'small group outing' : 'large group activity';
        context.push(`Planning for ${prefs.groupSize} ${prefs.groupSize === 1 ? 'person' : 'people'} (${groupType})`);
      }

      // Experience type context
      if (prefs.experienceTypes && prefs.experienceTypes.length > 0) {
        context.push(`Experience mood: ${prefs.experienceTypes.join(', ')}`);
      }

      // Time context
      if (prefs.timeWindow) {
        const timeContext = prefs.timeWindow.kind === 'Now' ? 'happening right now' :
                           prefs.timeWindow.kind === 'Tonight' ? 'perfect for this evening' :
                           prefs.timeWindow.kind === 'ThisWeekend' ? 'great weekend activity' :
                           'flexible timing';
        if (prefs.timeWindow.timeOfDay) {
          context.push(`Timing: ${timeContext} around ${prefs.timeWindow.timeOfDay}`);
        } else {
          context.push(`Timing: ${timeContext}`);
        }
      }

      // Travel context
      if (prefs.travel) {
        const travelMethod = prefs.travel.mode === 'WALKING' ? 'walking distance' :
                            prefs.travel.mode === 'DRIVING' ? 'driving' :
                            prefs.travel.mode === 'TRANSIT' ? 'public transportation' : 'convenient travel';
        
        let travelConstraint = '';
        if (prefs.travel.constraint.maxMinutes) {
          travelConstraint = `within ${prefs.travel.constraint.maxMinutes} minutes`;
        } else if (prefs.travel.constraint.maxDistance) {
          const unit = prefs.measurementSystem === 'imperial' ? 'miles' : 'km';
          travelConstraint = `within ${prefs.travel.constraint.maxDistance} ${unit}`;
        }
        
        context.push(`Travel: ${travelMethod} ${travelConstraint}`.trim());
      }

      // Location context
      if (prefs.location) {
        if (prefs.location.isCustom) {
          context.push(`Location area: ${prefs.location.name}`);
        } else {
          context.push(`Starting from current location`);
        }
      }

      // Budget context
      const budgetRange = `$${prefs.budget.min}-$${prefs.budget.max}`;
      context.push(`Budget: ${budgetRange} per person`);

      // Category interests
      if (prefs.categories && prefs.categories.length > 0) {
        context.push(`Interested in: ${prefs.categories.join(', ')}`);
      }

      return context.join('. ');
    };

    const personalizationContext = createPersonalizationContext(preferences);

    // Enhance cards in parallel but limit to avoid rate limits
    const enhancedCards = await Promise.all(
      cards.slice(0, 10).map(async (card) => {
        try {
          const prompt = `You are an expert dating and experience curator. Create personalized, engaging copy for this activity using the user's specific preferences.

ACTIVITY DETAILS:
- Name: ${card.title}
- Location: ${card.address}
- Category: ${card.category}
- Price Level: ${card.priceLevel}/4 scale
- Cost: $${card.estimatedCostPerPerson} per person

USER PREFERENCES & CONTEXT:
${personalizationContext}

TASK:
Create compelling copy that speaks directly to this user's preferences and situation. Make it feel personally curated for them.

Generate:
1. oneLiner: A magnetic, personalized hook (max 14 words) that makes this feel perfect for their specific situation
2. tip: A tailored insider tip (max 18 words) that considers their preferences, timing, group size, and travel method

REQUIREMENTS:
- Reference their group size, experience type, or timing when relevant
- Make it feel premium and specially selected
- Use specific, actionable language
- Avoid generic phrases like "perfect for" or "great choice"
- Consider their budget range and travel preferences
- Make it sound like a personal recommendation from a friend

Format: Return only valid JSON with "oneLiner" and "tip" fields.`;

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
                  content: 'You are a premium dating and experience curator who creates highly personalized recommendations. Always return valid JSON with compelling, specific copy.' 
                },
                { role: 'user', content: prompt }
              ],
              max_completion_tokens: 200,
            }),
          });

          if (!response.ok) {
            console.error('OpenAI API error:', response.status, await response.text());
            throw new Error(`OpenAI API error: ${response.status}`);
          }

          const data = await response.json();
          const content = data.choices[0].message.content;
          
          console.log('OpenAI personalized response for card:', card.id, content);

          let enhancedCopy;
          try {
            enhancedCopy = JSON.parse(content);
          } catch (parseError) {
            console.log('Failed to parse JSON, extracting manually');
            // Fallback parsing
            const oneLinearMatch = content.match(/"oneLiner":\s*"([^"]+)"/);
            const tipMatch = content.match(/"tip":\s*"([^"]+)"/);
            
            enhancedCopy = {
              oneLiner: oneLinearMatch ? oneLinearMatch[1] : `Curated ${card.category.toLowerCase()} experience at ${card.title}`,
              tip: tipMatch ? tipMatch[1] : `Tailored for your group, budget around $${card.estimatedCostPerPerson} per person`
            };
          }

          return {
            ...card,
            copy: {
              oneLiner: enhancedCopy.oneLiner || `Premium ${card.category.toLowerCase()} experience awaits`,
              tip: enhancedCopy.tip || `Perfect for your preferences, around $${card.estimatedCostPerPerson} per person`
            }
          };

        } catch (error) {
          console.error('Error enhancing card:', card.id, error);
          // Return card with personalized fallback copy
          const groupContext = preferences.groupSize === 2 ? 'date' : 
                              preferences.groupSize === 1 ? 'solo adventure' : 'group experience';
          
          return {
            ...card,
            copy: {
              oneLiner: `Handpicked ${card.category.toLowerCase()} ${groupContext} at ${card.title}`,
              tip: `Curated for your ${preferences.budget.min}-${preferences.budget.max} budget and preferences`
            }
          };
        }
      })
    );

    console.log('Successfully enhanced cards with full personalization:', enhancedCards.length);

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
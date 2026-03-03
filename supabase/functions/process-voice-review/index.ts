import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS Headers ────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Environment Variables ───────────────────────────────────────────────────
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Helper: Infer Sentiment from Rating ─────────────────────────────────────
function inferSentimentFromRating(rating: number): "positive" | "negative" | "mixed" | "neutral" {
  if (rating >= 4) return "positive";
  if (rating <= 2) return "negative";
  return "neutral";
}

// ── Helper: Fetch Audio and Convert to Base64 ───────────────────────────────
async function fetchAudioAsBase64(audioUrl: string): Promise<string> {
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Convert Uint8Array to base64 in Deno
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

// ── Helper: Recalculate Place Pool Analytics ────────────────────────────────
async function recalculatePlacePoolAnalytics(placePoolId: string): Promise<void> {
  const { data: reviews, error: reviewsError } = await supabaseAdmin
    .from("place_reviews")
    .select("rating, sentiment, themes")
    .eq("place_pool_id", placePoolId)
    .eq("did_attend", true)
    .eq("processing_status", "completed");

  if (reviewsError) {
    console.error("[process-voice-review] Error fetching reviews for analytics:", reviewsError.message);
    return;
  }

  if (!reviews || reviews.length === 0) return;

  const minglaReviewCount = reviews.length;

  const totalRating = reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0);
  const minglaAvgRating = Math.round((totalRating / minglaReviewCount) * 10) / 10;

  const minglaPositiveCount = reviews.filter((r: any) => r.sentiment === "positive").length;
  const minglaNegativeCount = reviews.filter((r: any) => r.sentiment === "negative").length;

  // Aggregate top themes: count frequency across all reviews, take top 5
  const themeCountMap: Record<string, number> = {};
  for (const review of reviews) {
    const themes = review.themes;
    if (Array.isArray(themes)) {
      for (const theme of themes) {
        if (typeof theme === "string" && theme.trim()) {
          const normalized = theme.trim().toLowerCase();
          themeCountMap[normalized] = (themeCountMap[normalized] || 0) + 1;
        }
      }
    }
  }

  const topThemes = Object.entries(themeCountMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme]) => theme);

  const { error: updateError } = await supabaseAdmin
    .from("place_pool")
    .update({
      mingla_review_count: minglaReviewCount,
      mingla_avg_rating: minglaAvgRating,
      mingla_positive_count: minglaPositiveCount,
      mingla_negative_count: minglaNegativeCount,
      mingla_top_themes: topThemes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", placePoolId);

  if (updateError) {
    console.error("[process-voice-review] Error updating place_pool analytics:", updateError.message);
  }
}

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let reviewId: string;

  try {
    const body = await req.json();
    reviewId = body.reviewId;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!reviewId || typeof reviewId !== "string") {
    return new Response(
      JSON.stringify({ error: "reviewId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // ── Fetch the review ──────────────────────────────────────────────────
    const { data: review, error: fetchError } = await supabaseAdmin
      .from("place_reviews")
      .select("*")
      .eq("id", reviewId)
      .single();

    if (fetchError || !review) {
      return new Response(
        JSON.stringify({ error: "Review not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Already processed — idempotent
    if (review.processing_status === "completed") {
      return new Response(
        JSON.stringify({ message: "Already processed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Mark as processing immediately ────────────────────────────────────
    await supabaseAdmin
      .from("place_reviews")
      .update({ processing_status: "processing" })
      .eq("id", reviewId);

    // ── Process audio with GPT ────────────────────────────────────────────
    const audioPaths: string[] = review.audio_urls || [];
    let transcription = "";
    let sentiment: "positive" | "negative" | "mixed" | "neutral" = inferSentimentFromRating(review.rating);
    let themes: string[] = [];
    let summary = "";

    if (audioPaths.length > 0 && OPENAI_API_KEY) {
      try {
        // Generate signed URLs from Storage paths (audio_urls stores paths like "{user_id}/review.m4a")
        const signedUrls: string[] = [];
        for (const path of audioPaths) {
          const { data, error: signError } = await supabaseAdmin.storage
            .from("voice-reviews")
            .createSignedUrl(path, 3600);
          if (signError || !data?.signedUrl) {
            throw new Error(`Failed to create signed URL for ${path}: ${signError?.message || "no URL returned"}`);
          }
          signedUrls.push(data.signedUrl);
        }

        // Fetch all audio clips and convert to base64
        const audioBase64Promises = signedUrls.map((url: string) => fetchAudioAsBase64(url));
        const audioBase64Results = await Promise.all(audioBase64Promises);

        // Build GPT messages
        const systemMessage = {
          role: "system",
          content: "You are a review analysis assistant. You will receive voice recordings from a user reviewing a place. Transcribe the audio verbatim, then analyze the review. Return ONLY valid JSON, no markdown.",
        };

        const placeName = review.place_name || "a place";
        const rating = review.rating || 0;

        const userTextContent = `The user visited '${placeName}' and gave it ${rating}/5 stars. Listen to their voice review and return: { "transcription": "full verbatim text", "sentiment": "positive" | "negative" | "mixed" | "neutral", "themes": ["theme1", "theme2", ...], "summary": "one sentence summary" }. Rules: sentiment is 'positive' if mostly good, 'negative' if mostly bad, 'mixed' if truly balanced, 'neutral' if no clear lean. Themes: extract 2-5 short lowercase phrases like 'great ambiance', 'slow service'. Summary: one concise sentence.`;

        const userContentParts: any[] = [
          { type: "text", text: userTextContent },
        ];

        for (const base64String of audioBase64Results) {
          userContentParts.push({
            type: "input_audio",
            input_audio: {
              data: base64String,
              format: "mp4",
            },
          });
        }

        const userMessage = {
          role: "user",
          content: userContentParts,
        };

        // Call OpenAI GPT-4o-mini-audio-preview with audio input
        const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-audio-preview",
            messages: [systemMessage, userMessage],
            temperature: 0.3,
            max_tokens: 1000,
            response_format: { type: "json_object" },
          }),
        });

        if (!openaiResponse.ok) {
          const errText = await openaiResponse.text();
          console.error("[process-voice-review] OpenAI error:", openaiResponse.status, errText);
          throw new Error(`OpenAI API error: ${openaiResponse.status}`);
        }

        const openaiData = await openaiResponse.json();
        const content = openaiData.choices?.[0]?.message?.content;

        if (!content) {
          throw new Error("Empty response from OpenAI");
        }

        const parsed = JSON.parse(content);

        transcription = typeof parsed.transcription === "string" ? parsed.transcription : "";
        sentiment = ["positive", "negative", "mixed", "neutral"].includes(parsed.sentiment)
          ? parsed.sentiment
          : inferSentimentFromRating(review.rating);
        themes = Array.isArray(parsed.themes)
          ? parsed.themes.filter((t: any) => typeof t === "string").slice(0, 5)
          : [];
        summary = typeof parsed.summary === "string" ? parsed.summary : "";

      } catch (gptError: any) {
        console.error("[process-voice-review] GPT processing failed, using fallback:", gptError.message);
        // Fallback: infer sentiment from rating, leave everything else empty
        transcription = "";
        sentiment = inferSentimentFromRating(review.rating);
        themes = [];
        summary = "";
      }
    }
    // If audioUrls.length === 0, defaults are already set above

    // ── Update the review with processed data ─────────────────────────────
    const { error: updateError } = await supabaseAdmin
      .from("place_reviews")
      .update({
        transcription,
        sentiment,
        themes,
        ai_summary: summary,
        processing_status: "completed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", reviewId);

    if (updateError) {
      console.error("[process-voice-review] Error updating review:", updateError.message);
      throw new Error(`Failed to update review: ${updateError.message}`);
    }

    // ── Recalculate place_pool analytics ───────────────────────────────────
    if (review.place_pool_id) {
      await recalculatePlacePoolAnalytics(review.place_pool_id);
    }

    // ── Increment user engagement stats ───────────────────────────────────
    try {
      await supabaseAdmin.rpc("increment_user_engagement", {
        p_user_id: review.user_id,
        p_field: "total_reviews_given",
        p_amount: 1,
      });
    } catch (engagementError: any) {
      console.error("[process-voice-review] Failed to increment engagement:", engagementError.message);
    }

    // ── Return success ────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        reviewId,
        sentiment,
        themes,
        transcriptionLength: transcription.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: any) {
    console.error("[process-voice-review] Unhandled error:", err);

    // Try to mark the review as failed
    try {
      await supabaseAdmin
        .from("place_reviews")
        .update({
          processing_status: "failed",
          processing_error: err.message || "Unknown error",
        })
        .eq("id", reviewId);
    } catch (updateErr: any) {
      console.error("[process-voice-review] Failed to mark review as failed:", updateErr.message);
    }

    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Parse & validate request body ──────────────────────────────────────
    const { personId, audioStoragePath, location, occasions } = await req.json();

    if (!personId || typeof personId !== "string" || !UUID_REGEX.test(personId)) {
      return new Response(
        JSON.stringify({ error: "personId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!audioStoragePath || typeof audioStoragePath !== "string") {
      return new Response(
        JSON.stringify({ error: "audioStoragePath is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (
      !location ||
      typeof location.latitude !== "number" ||
      typeof location.longitude !== "number" ||
      location.latitude < -90 ||
      location.latitude > 90 ||
      location.longitude < -180 ||
      location.longitude > 180
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid location" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!occasions || !Array.isArray(occasions) || occasions.length === 0) {
      return new Response(
        JSON.stringify({ error: "At least one occasion is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Verify person ownership ────────────────────────────────────────────
    const { data: person, error: personError } = await supabase
      .from("saved_people")
      .select("id, user_id, birthday, gender, name")
      .eq("id", personId)
      .single();

    if (personError || !person) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (person.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 4. Download audio file from storage ───────────────────────────────────
    const { data: audioBlob, error: downloadError } = await supabase.storage
      .from("voice-reviews")
      .download(audioStoragePath);

    if (downloadError || !audioBlob) {
      console.error("Audio download error:", downloadError);
      return new Response(
        JSON.stringify({ error: "Audio file not found" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5. Convert Blob to File for OpenAI ────────────────────────────────────
    const audioFile = new File([audioBlob], "audio.m4a", {
      type: audioBlob.type || "audio/m4a",
    });

    // ── 6. Transcribe with Whisper ────────────────────────────────────────────
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Audio processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let transcription: string;

    try {
      const whisperForm = new FormData();
      whisperForm.append("file", audioFile);
      whisperForm.append("model", "whisper-1");

      const whisperResponse = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: whisperForm,
        }
      );

      if (!whisperResponse.ok) {
        throw new Error("Whisper transcription failed");
      }

      const whisperData = await whisperResponse.json();
      transcription = whisperData.text;
    } catch (whisperError) {
      console.error("Whisper error:", whisperError);
      return new Response(
        JSON.stringify({ error: "Audio processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 7. Extract interests via GPT-4o-mini ──────────────────────────────────
    let gptDescription: string;
    let extractedInterests: string[];
    let categories: string[];

    try {
      const gptResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'You are analyzing a voice note where someone describes a friend or loved one. Extract:\n1. A natural language description of what this person likes, their personality, interests, and preferences (2-3 sentences)\n2. A list of specific interests/hobbies/preferences mentioned\n3. Suggested experience categories from this list: [Fine Dining, Casual Eats, Bars & Nightlife, Coffee & Cafe, Outdoor Adventures, Arts & Culture, Wellness & Spa, Shopping, Entertainment, Live Music, Sports & Recreation, Date Night]\n\nReturn JSON: { "description": "string", "interests": ["string"], "categories": ["string"] }',
              },
              {
                role: "user",
                content: `Transcription of voice note: "${transcription}"`,
              },
            ],
            temperature: 0.7,
            max_tokens: 800,
          }),
        }
      );

      if (!gptResponse.ok) {
        throw new Error("GPT-4o-mini request failed");
      }

      const gptData = await gptResponse.json();
      const parsed = JSON.parse(gptData.choices[0].message.content);
      gptDescription = parsed.description || transcription;
      extractedInterests = parsed.interests || [];
      categories = parsed.categories || [];
    } catch (gptError) {
      console.error("GPT error:", gptError);
      return new Response(
        JSON.stringify({ error: "Audio processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 9. Update saved_people with description ───────────────────────────────
    const { error: updateError } = await supabase
      .from("saved_people")
      .update({
        description: gptDescription,
        description_processed_at: new Date().toISOString(),
      })
      .eq("id", personId);

    if (updateError) {
      console.error("DB update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 10. Build occasions array (ensure Birthday is included) ───────────────
    const finalOccasions = [...occasions];

    if (person.birthday) {
      const hasBirthday = finalOccasions.some(
        (o: { name: string }) => o.name === "Birthday"
      );
      if (!hasBirthday) {
        finalOccasions.push({ name: "Birthday", date: person.birthday });
      }
    }

    // ── 11. Call generate-person-experiences internally ────────────────────────
    let experiencesGenerated = false;

    try {
      const genResponse = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-person-experiences`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personId,
            description: gptDescription,
            location: {
              lat: location.latitude,
              lng: location.longitude,
            },
            occasions: finalOccasions,
          }),
        }
      );

      if (genResponse.ok) {
        experiencesGenerated = true;
      } else {
        const errBody = await genResponse.text();
        console.error(
          "generate-person-experiences failed:",
          genResponse.status,
          errBody
        );
      }
    } catch (genError) {
      console.error("generate-person-experiences call error:", genError);
    }

    // ── 12. Return success ────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        personId,
        transcription,
        extractedInterests,
        description: gptDescription,
        experiencesGenerated,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("process-person-audio error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

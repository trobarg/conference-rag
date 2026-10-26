// embed-question: turn a user's question into a 1,536-dimension embedding.
// The browser can't call OpenAI directly without exposing the API key, so it
// calls this function instead, which holds the key as a server-side secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

// Caps what any one request can cost us; real questions are far shorter.
const MAX_QUESTION_CHARS = 1000;

Deno.serve(async (req) => {
  // Browsers send an OPTIONS "preflight" before the real cross-origin POST
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const { question } = await req.json();
    if (typeof question !== "string" || !question.trim()) {
      return jsonResponse({ error: "Missing or invalid 'question' field" }, 400);
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return jsonResponse({ error: `Question must be at most ${MAX_QUESTION_CHARS} characters` }, 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
    }

    // Must be the same model used to embed the talks, or the vectors aren't comparable
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: question }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return jsonResponse({ error: err.error?.message ?? "OpenAI API error" }, 502);
    }

    const data = await response.json();
    return jsonResponse({ embedding: data.data[0].embedding });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

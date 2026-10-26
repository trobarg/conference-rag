// generate-answer: the "generation" step of RAG. Given a question and the
// top-matching talks, ask GPT-4o to answer using only those talks.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

const MAX_QUESTION_CHARS = 1000;
const MAX_TALKS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM_PROMPT = `You answer questions about General Conference talks of The Church of Jesus Christ of Latter-day Saints.
Use ONLY the talks provided. If they don't answer the question, say so rather than guessing.
Cite the title and speaker of each talk you draw from.`;

Deno.serve(async (req) => {
  // Browsers send an OPTIONS "preflight" before the real cross-origin POST
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const { question, context_talks } = await req.json();
    if (typeof question !== "string" || !question.trim()) {
      return jsonResponse({ error: "Missing or invalid 'question' field" }, 400);
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return jsonResponse({ error: `Question must be at most ${MAX_QUESTION_CHARS} characters` }, 400);
    }
    if (!Array.isArray(context_talks)) {
      return jsonResponse({ error: "Missing or invalid 'context_talks' field" }, 400);
    }

    // Only the talk IDs are taken from the browser. The talk text is re-read from
    // the database, so a caller can't supply arbitrary "context" and use this
    // function as a general-purpose (and expensive) GPT-4o proxy.
    const talkIds = [...new Set(context_talks.map((t: { talk_id?: unknown }) => t?.talk_id))]
      .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
      .slice(0, MAX_TALKS);
    if (talkIds.length === 0) {
      return jsonResponse({ error: "No valid context talks provided" }, 400);
    }

    // Queries run as the signed-in user, so RLS still decides what they can read
    const { data: rows, error: dbError } = await auth.supabase
      .from("sentence_embeddings")
      .select("talk_id, title, speaker, text")
      .in("talk_id", talkIds)
      .order("talk_id")
      .order("sentence_num");
    if (dbError) {
      return jsonResponse({ error: `Database error: ${dbError.message}` }, 500);
    }

    // Rebuild each talk's full text from its chunks
    const talks = new Map<string, { title: string; speaker: string; chunks: string[] }>();
    for (const row of rows) {
      if (!talks.has(row.talk_id)) {
        talks.set(row.talk_id, { title: row.title, speaker: row.speaker, chunks: [] });
      }
      talks.get(row.talk_id)!.chunks.push(row.text);
    }
    if (talks.size === 0) {
      return jsonResponse({ error: "Context talks not found" }, 400);
    }

    // Keep the browser's relevance ranking order
    const contextText = talkIds
      .filter((id) => talks.has(id))
      .map((id) => {
        const talk = talks.get(id)!;
        return `Talk: "${talk.title}" (${talk.speaker})\n${talk.chunks.join(" ")}`;
      })
      .join("\n\n---\n\n");

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `${contextText}\n\n---\n\nQuestion: ${question}` },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return jsonResponse({ error: err.error?.message ?? "OpenAI API error" }, 502);
    }

    const data = await response.json();
    return jsonResponse({ answer: data.choices[0].message.content });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

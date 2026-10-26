// CORS headers so the browser (GitHub Pages or localhost) may call these functions.
// Allowing any origin is safe here: callers authenticate with an explicit
// Authorization header, not cookies, so other sites can't borrow a user's session.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

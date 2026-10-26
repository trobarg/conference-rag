import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

/**
 * Verify the caller is a signed-in user.
 *
 * Functions are deployed with verify_jwt = false (see supabase/config.toml), because
 * the Edge Function gateway can reject valid user tokens signed with Supabase Auth's
 * newer asymmetric keys. Instead, we ask Supabase Auth itself whether the token in
 * the Authorization header belongs to a real, unexpired session.
 *
 * Returns the user plus a Supabase client that acts as them (so RLS applies to
 * its queries), or a 401 Response to send back.
 */
export async function requireAuth(
  req: Request,
): Promise<{ user: User; supabase: SupabaseClient } | { error: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: jsonResponse({ error: "Missing Authorization header" }, 401) };
  }

  // SUPABASE_URL and SUPABASE_ANON_KEY are provided to every Edge Function automatically.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  // The anon key is a valid JWT too, but it has no user, so getUser() rejects it.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: jsonResponse({ error: "Invalid or expired session" }, 401) };
  }

  return { user, supabase };
}

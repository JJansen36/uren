// auth.js
export function makeSupabaseClient(){
  // Supabase JS v2 via CDN in HTML
  return supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

export async function requireSession(sb){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.href = "index.html";
    return null;
  }
  return session;
}

export async function getMyProfile(sb){
  const { data, error } = await sb
    .from("profiles")
    .select("id, user_id, name, role")
    .eq("user_id", (await sb.auth.getUser()).data.user.id)
    .single();

  if (error) throw error;
  return data;
}

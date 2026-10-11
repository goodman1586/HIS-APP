/* Supabase client: the public URL/key are served by the backend environment.
   Never put SUPABASE_SERVICE_ROLE_KEY in this file or in the browser. */
let supabaseClientPromise;

async function getSupabaseClient() {
  if (supabaseClientPromise) return supabaseClientPromise;
  supabaseClientPromise = (async () => {
    if (!window.supabase) throw new Error("No se cargó la librería de Supabase.");
    const response = await fetch("/api/public-config", { cache: "no-store" });
    const config = await response.json().catch(() => ({}));
    if (!response.ok || !config.url || !config.publishableKey) {
      throw new Error(config.error || "Falta configurar Supabase en Render.");
    }
    return window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  })();
  try { return await supabaseClientPromise; }
  catch (error) { supabaseClientPromise = null; throw error; }
}

async function signIn(email, password) {
  const client = await getSupabaseClient();
  return client.auth.signInWithPassword({ email, password });
}
async function signUp(fullName, email, password) {
  const client = await getSupabaseClient();
  return client.auth.signUp({ email, password, options: { data: { full_name: fullName.trim() } } });
}
async function signOut() {
  const client = await getSupabaseClient();
  return client.auth.signOut();
}
async function getSession() {
  const client = await getSupabaseClient();
  return client.auth.getSession();
}
async function getAccessToken() {
  const { data } = await (await getSupabaseClient()).auth.getSession();
  return data?.session?.access_token || null;
}
async function apiFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...options, headers });
}


const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
const SUPABASE_ANON_KEY = "TU_SUPABASE_ANON_O_PUBLISHABLE_KEY";

if (!window.supabase) {
  throw new Error("No se cargó la librería de Supabase.");
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function signIn(email, password) {
  return supabaseClient.auth.signInWithPassword({
    email,
    password
  });
}

async function signUp(fullName, email, password) {
  return supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName.trim()
      }
    }
  });
}

async function signOut() {
  return supabaseClient.auth.signOut();
}

async function getSession() {
  return supabaseClient.auth.getSession();
}

async function getAccessToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session?.access_token || null;
}

async function apiFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...options,
    headers
  });
}

const SESSION_STORAGE_KEY = "his_app_access_session";
function getAccessToken() { return localStorage.getItem(SESSION_STORAGE_KEY) || ""; }
async function loginWithCode(mode, code, name, email = "") {
  const route = mode === "admin" ? "/api/access/bootstrap-admin" : "/api/access/claim";
  const response = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, email })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo validar el código.");
  if (!body.token) throw new Error("El servidor no entregó una sesión válida.");
  localStorage.setItem(SESSION_STORAGE_KEY, body.token);
  return body;
}
async function signOut() { localStorage.removeItem(SESSION_STORAGE_KEY); }
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...options, headers });
}

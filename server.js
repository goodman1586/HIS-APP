import express from "express";
import cors from "cors";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 10000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.APP_SESSION_SECRET || "";
const ADMIN_SETUP_CODE = process.env.ADMIN_SETUP_CODE || "";
const allowedOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json({ limit: "2mb" }));

// Límite sencillo por proceso. Para varias instancias, usar un almacén compartido.
const apiRequests = new Map();
app.use("/api", (req, res, next) => {
  const now = Date.now(), key = req.ip;
  const bucket = apiRequests.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    apiRequests.set(key, { startedAt: now, count: 1 });
    return next();
  }
  if (++bucket.count > 180) {
    res.setHeader("Retry-After", "60");
    return fail(res, 429, "Demasiadas solicitudes. Inténtalo de nuevo en un minuto.");
  }
  next();
});
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, bucket] of apiRequests) if (bucket.startedAt < cutoff) apiRequests.delete(ip);
}, 60_000).unref();

const db = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
}) : null;
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/auth.js", (_req, res) => res.sendFile(path.join(__dirname, "auth.js")));
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/health", (_req, res) => res.json({
  ok: true, service: "HIS-APP Gestor de Calificaciones", version: "2.5.0",
  supabaseConfigured: Boolean(db), sessionConfigured: SESSION_SECRET.length >= 32,
  adminCodeConfigured: ADMIN_SETUP_CODE.length >= 20
}));

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function normalizeCode(value) { return String(value || "").replace(/\s/g, ""); }
function normalizeName(value) { return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es"); }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function hashCode(value) { return crypto.createHash("sha256").update(normalizeCode(value)).digest("hex"); }
function issueSession(profile) {
  if (SESSION_SECRET.length < 32) throw new Error("APP_SESSION_SECRET must contain at least 32 characters.");
  const payload = Buffer.from(JSON.stringify({ sub: profile.id, exp: Date.now() + 90 * 24 * 60 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifySession(token) {
  if (!SESSION_SECRET || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload.sub || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
async function authenticate(req, res, next) {
  if (!db) return fail(res, 503, "Falta la configuración de Supabase en Render.");
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = verifySession(token);
  if (!session) return fail(res, 401, "La sesión no es válida o expiró. Pide un nuevo código a administración.");
  try {
    const { data: profile, error } = await db.from("app_users").select("id,auth_user_id,full_name,email,role,active,favorite_color,created_at").eq("id", session.sub).maybeSingle();
    if (error || !profile) return fail(res, 401, "La cuenta no existe. Pide un nuevo código a administración.");
    if (!profile.active) return fail(res, 403, "Tu cuenta está desactivada. Contacta con administración.");
    req.profile = profile;
    req.authUser = { id: profile.auth_user_id, email: profile.email };
    next();
  } catch (e) { console.error("Session:", e.message); return fail(res, 500, "No se pudo verificar la sesión."); }
}
async function profileRequired(req, res, next) {
  if (!req.profile?.active) return fail(res, 401, "Inicia sesión para continuar.");
  next();
}
const roles = (...allowed) => (req, res, next) => allowed.includes(req.profile?.role)
  ? next() : fail(res, 403, "No tienes permisos para realizar esta acción.");
// Entradas públicas: administración usa un secreto privado de Render;
// el profesor inicia sesión con un código numérico ligado a su cuenta precreada.
const accessAttempts = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [ip, bucket] of accessAttempts) if (bucket.startedAt < cutoff) accessAttempts.delete(ip);
}, 10 * 60_000).unref();
app.use("/api/access", (req, res, next) => {
  const now = Date.now(), key = req.ip, bucket = accessAttempts.get(key);
  if (!bucket || now - bucket.startedAt >= 10 * 60_000) {
    accessAttempts.set(key, { startedAt: now, count: 1 });
    return next();
  }
  if (++bucket.count > 10) {
    res.setHeader("Retry-After", "600");
    return fail(res, 429, "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.");
  }
  next();
});

app.post("/api/access/bootstrap-admin", async (req, res) => {
  if (!db || SESSION_SECRET.length < 32) return fail(res, 503, "Falta configurar Supabase y APP_SESSION_SECRET en Render.");
  if (ADMIN_SETUP_CODE.length < 20) return fail(res, 503, "Configura ADMIN_SETUP_CODE con al menos 20 caracteres en Render.");
  if (!safeEqual(req.body?.code, ADMIN_SETUP_CODE)) return fail(res, 401, "Código de administración incorrecto.");
  const fullName = String(req.body?.name || "").trim().slice(0, 120);
  if (fullName.length < 2) return fail(res, 400, "Escribe tu nombre para la cuenta de administración.");
  const existing = await db.from("app_users").select("*").eq("role", "admin").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (existing.error) return fail(res, 500, "No se pudo comprobar la cuenta de administración. Ejecuta schema.sql.");
  let profile = existing.data;
  if (profile) {
    if (!profile.active) {
      const reactivated = await db.from("app_users").update({ active: true }).eq("id", profile.id).select("*").single();
      if (reactivated.error) return fail(res, 500, "No se pudo activar la cuenta de administración.");
      profile = reactivated.data;
    }
  } else {
    const lock = await db.from("app_meta").insert({ key: "first_admin_created", value: "claimed" }).select("key").maybeSingle();
    if (lock.error) return fail(res, 409, "La creación inicial ya fue usada o schema.sql aún no está actualizado.");
    const created = await db.from("app_users").insert({ full_name: fullName, role: "admin", active: true }).select("*").single();
    if (created.error) {
      await db.from("app_meta").delete().eq("key", "first_admin_created");
      console.error("Admin bootstrap:", created.error.message);
      return fail(res, 500, "No se pudo crear administración.");
    }
    profile = created.data;
  }
  try { return res.json({ ok: true, token: issueSession(profile), profile }); }
  catch (e) { console.error(e.message); return fail(res, 503, "Configura APP_SESSION_SECRET con al menos 32 caracteres en Render."); }
});

app.post("/api/access/claim", async (req, res) => {
  if (!db || SESSION_SECRET.length < 32) return fail(res, 503, "Falta configurar Supabase y APP_SESSION_SECRET en Render.");
  const code = normalizeCode(req.body?.code);
  const fullName = String(req.body?.name || "").trim().slice(0, 120);
  const email = normalizeEmail(req.body?.email);
  if (!/^\d{8}$/.test(code)) return fail(res, 401, "El código debe tener 8 números.");
  if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 401, "El nombre, correo o código no coincide con la cuenta creada por administración.");
  const now = new Date().toISOString();
  const invite = await db.from("access_codes").select("id,profile_id")
    .eq("code_hash", hashCode(code)).eq("status", "available")
    .or(`expires_at.is.null,expires_at.gt.${now}`).maybeSingle();
  if (invite.error || !invite.data?.profile_id) return fail(res, 401, "Nombre, correo o código incorrecto. Pide ayuda a administración.");
  const { data: profile, error } = await db.from("app_users").select("*").eq("id", invite.data.profile_id).maybeSingle();
  if (error || !profile || !profile.active || normalizeEmail(profile.email) !== email || normalizeName(profile.full_name) !== normalizeName(fullName))
    return fail(res, 401, "Nombre, correo o código incorrecto. Pide ayuda a administración.");
  try { return res.json({ ok: true, token: issueSession(profile), profile }); }
  catch (e) { console.error(e.message); return fail(res, 503, "Configura APP_SESSION_SECRET con al menos 32 caracteres en Render."); }
});

app.get("/api/public-branding", async (_req, res) => {
  if (!db) return fail(res, 503, "La base de datos no está configurada.");
  const { data, error } = await db.from("app_meta").select("key,value")
    .in("key", ["app_name", "institution_name", "institution_logo", "home_photo"]);
  if (error) return fail(res, 500, "No se pudo cargar la página institucional.");
  const meta = Object.fromEntries((data || []).map(item => [item.key, item.value]));
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, branding: {
    app_name: meta.app_name || "HIS-APP · Gestor de Calificaciones",
    institution_name: meta.institution_name || "",
    institution_logo: meta.institution_logo || "",
    home_photo: meta.home_photo || ""
  } });
});

app.use("/api", authenticate);

app.get("/api/auth/session", (req, res) => res.json({ ok: true, user: { id: req.authUser.id, email: req.authUser.email } }));
app.get("/api/me", profileRequired, async (req, res) => {
  const { data, error } = await db.from("app_users").select("id,full_name,email,role,active,favorite_color,photo_data_url,background_image_data_url")
    .eq("id", req.profile.id).single();
  if (error) return fail(res, 500, "No se pudo cargar el perfil.");
  res.json({ ok: true, profile: data });
});

app.get("/api/config", profileRequired, async (req, res) => {
  try {
    const [g, s, a, meta] = await Promise.all([
      db.from("grades").select("id,name,sort_order").order("sort_order"),
      db.from("subjects").select("id,name,active").eq("active", true).order("name"),
      db.from("academic_settings").select("school_year,period_count,months_per_period").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("app_meta").select("key,value").in("key", ["app_name", "institution_name", "institution_logo", "home_photo", "month_value"])
    ]);
    const err = g.error || s.error || a.error || meta.error;
    if (err) throw err;
    const branding = Object.fromEntries((meta.data || []).map(item => [item.key, item.value]));
    res.json({ grades: g.data || [], subjects: s.data || [], settings: a.data || { school_year: "2026-2027", period_count: 3, months_per_period: 3 }, branding: { app_name: branding.app_name || "HIS-APP · Gestor de Calificaciones", institution_name: branding.institution_name || "", institution_logo: branding.institution_logo || "", home_photo: branding.home_photo || "" }, month_value: branding.month_value || "" });
  } catch (e) { console.error("Config:", e.message); fail(res, 500, "No se pudo cargar la configuración. Ejecuta schema.sql y crea al menos una materia."); }
});

app.patch("/api/admin/month-value", profileRequired, roles("admin"), async (req, res) => {
  const monthValue = String(req.body?.month_value || "").trim().slice(0, 1200);
  const { error } = await db.from("app_meta").upsert({ key: "month_value", value: monthValue }, { onConflict: "key" });
  if (error) return fail(res, 500, "No se pudo guardar el valor del mes.");
  res.json({ ok: true, month_value: monthValue });
});

app.get("/api/announcements", profileRequired, async (_req, res) => {
  const { data, error } = await db.from("announcements").select("id,kind,title,message,author_name,created_at")
    .eq("published", true).order("created_at", { ascending: false }).limit(50);
  if (error) { console.error("Announcements:", error.message); return fail(res, 500, "No se pudieron cargar los comunicados. Ejecuta el schema.sql actualizado."); }
  res.json({ ok: true, announcements: data || [] });
});

app.post("/api/announcements", profileRequired, roles("admin", "coordinacion"), async (req, res) => {
  const kind = req.body?.kind === "publicacion" ? "publicacion" : "comunicado";
  const title = String(req.body?.title || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const message = String(req.body?.message || "").trim().slice(0, 5000);
  if (title.length < 3 || message.length < 3) return fail(res, 400, "Escribe un título y un mensaje de al menos 3 caracteres.");
  const { data, error } = await db.from("announcements").insert({ kind, title, message, author_id: req.profile.id, author_name: req.profile.full_name })
    .select("id,kind,title,message,author_name,created_at").single();
  if (error) { console.error("Publish announcement:", error.message); return fail(res, 500, "No se pudo publicar. Ejecuta el schema.sql actualizado."); }
  res.status(201).json({ ok: true, announcement: data });
});

app.post("/api/results", profileRequired, async (req, res) => {
  const input = Array.isArray(req.body?.results) ? req.body.results : [];
  if (!input.length || input.length > 500) return fail(res, 400, "Envía entre 1 y 500 estudiantes por operación.");
  const [gradesResult, subjectsResult, settingsResult] = await Promise.all([
    db.from("grades").select("id,name"),
    db.from("subjects").select("id,name").eq("active", true),
    db.from("academic_settings").select("school_year,period_count").order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (gradesResult.error || subjectsResult.error || settingsResult.error) {
    console.error("Validation config:", gradesResult.error?.message || subjectsResult.error?.message || settingsResult.error?.message);
    return fail(res, 500, "No se pudo validar la configuración académica.");
  }
  const grades = new Map((gradesResult.data || []).map(item => [item.id, item]));
  const subjects = new Map((subjectsResult.data || []).map(item => [item.id, item]));
  const settings = settingsResult.data || { school_year: "2026-2027", period_count: 3 };
  const precision = req.body?.output_precision === "integer" ? "integer" : "decimal";
  const factor = precision === "integer" ? 1 : 100;
  const round = value => Math.round(value * factor) / factor;
  const calculate = values => {
    const average = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
    const offsets = [-6, -2, 3, 5];
    let scale = 1;
    for (const offset of offsets) {
      if (offset < 0) scale = Math.min(scale, average / Math.abs(offset));
      if (offset > 0) scale = Math.min(scale, (100 - average) / offset);
    }
    scale = Math.max(0, Math.min(1, scale));
    const generated = offsets.map(offset => round(average + offset * scale));
    generated[3] = round(average * 4 - generated[0] - generated[1] - generated[2]);
    const generatedAverage = Math.round((generated.reduce((sum, value) => sum + value, 0) / 4) * 100) / 100;
    return { average, generated, generatedAverage };
  };
  const records = [];
  for (const [i, r] of input.entries()) {
    if (!r || typeof r !== "object" || !String(r.student_name || "").trim() || !r.grade_id || !r.subject_id || !Array.isArray(r.source_values) || !r.source_values.length || r.source_values.length > 12)
      return fail(res, 400, `La fila ${i + 1} está incompleta.`);
    const source = r.source_values.map(Number);
    if (source.some(n => !Number.isFinite(n) || n < 0 || n > 100)) return fail(res, 400, `La fila ${i + 1} contiene notas fuera del rango 0–100.`);
    const grade = grades.get(r.grade_id), subject = subjects.get(r.subject_id);
    const period = Number(r.period_no), schoolYear = String(r.school_year || "").trim();
    if (!grade || !subject) return fail(res, 400, `La fila ${i + 1} tiene un grado o materia no válido/inactivo.`);
    if (!Number.isInteger(period) || period < 1 || period > Number(settings.period_count)) return fail(res, 400, `La fila ${i + 1} tiene un período fuera de la configuración académica.`);
    if (!/^\d{4}-\d{4}$/.test(schoolYear)) return fail(res, 400, `La fila ${i + 1} tiene un año escolar no válido.`);
    const calculated = calculate(source);
    records.push({ teacher_id: req.profile.id, teacher_name: req.profile.full_name,
      grade_id: grade.id, grade_name: grade.name,
      subject_id: subject.id, subject_name: subject.name,
      school_year: schoolYear, period_no: period,
      student_name: String(r.student_name).trim().slice(0,200), source_values: source,
      average_b: calculated.average, generated_values: calculated.generated, generated_average: calculated.generatedAverage, output_precision: precision, status: "draft" });
  }
  const { data, error } = await db.from("grade_results").insert(records).select("id,student_name,status");
  if (error) { console.error("Save:", error.message); return fail(res, 500, "No se pudieron guardar las notas. Comprueba que ejecutaste el schema SQL y que el grado y la materia existen."); }
  res.status(201).json({ ok: true, saved: data.length, results: data });
});

app.get("/api/results", profileRequired, async (req, res) => {
  let query = db.from("grade_results").select("*").order("created_at", { ascending: false }).limit(1000);
  if (!["admin", "coordinacion"].includes(req.profile.role)) query = query.eq("teacher_id", req.profile.id);
  const { data, error } = await query;
  if (error) return fail(res, 500, "No se pudieron recuperar las calificaciones guardadas.");
  res.json({ ok: true, results: data || [] });
});

app.post("/api/results/submit", profileRequired, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids)].slice(0, 500) : [];
  if (!ids.length) return fail(res, 400, "Selecciona las calificaciones que deseas enviar.");
  let q = db.from("grade_results").update({ status: "submitted" }).in("id", ids).in("status", ["draft", "returned"]).select("id,status");
  if (!["admin", "coordinacion"].includes(req.profile.role)) q = q.eq("teacher_id", req.profile.id);
  const { data, error } = await q;
  if (error) { console.error("Submit:", error.message); return fail(res, 500, "No se pudieron enviar las calificaciones a coordinación."); }
  if (!data?.length) return fail(res, 400, "No se enviaron registros. Verifica que sean tuyos y estén en borrador o devueltos.");
  res.json({ ok: true, submitted: data.length });
});

app.post("/api/admin/access-codes", profileRequired, roles("admin"), async (req, res) => {
  const fullName = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const email = normalizeEmail(req.body?.email);
  const favorite_color = req.body?.favorite_color || "#2563eb";
  const photo_data_url = req.body?.photo_data_url || null;
  if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return fail(res, 400, "Escribe el nombre completo y un correo válido del profesor.");
  if (!validColor(favorite_color) || !validPhoto(photo_data_url)) return fail(res, 400, "El color o la imagen no son válidos. Usa una imagen pequeña PNG, JPG o WebP (máximo 300 KB).");
  const existing = await db.from("app_users").select("*").ilike("email", email).maybeSingle();
  if (existing.error) return fail(res, 500, "No se pudo comprobar si el profesor ya tiene una cuenta.");
  
  let profile = existing.data;
  if (profile) {
    const updated = await db.from("app_users").update({ full_name: fullName, active: true, favorite_color, photo_data_url }).eq("id", profile.id).select("*").single();
    if (updated.error) return fail(res, 500, "No se pudo actualizar la cuenta del profesor.");
    profile = updated.data;
  } else {
    const created = await db.from("app_users").insert({ full_name: fullName, email, role: "profesor", active: true, favorite_color, photo_data_url }).select("*").single();
    if (created.error) return fail(res, 409, "No se pudo crear la cuenta. Comprueba que el correo no esté ya registrado.");
    profile = created.data;
  }
  const code = Array.from({ length: 8 }, () => crypto.randomInt(0, 10)).join("");
  const { error: revokeError } = await db.from("access_codes").update({ status: "revoked" }).eq("profile_id", profile.id).eq("status", "available");
  if (revokeError) return fail(res, 500, "No se pudo renovar el código anterior.");
  const { error } = await db.from("access_codes").insert({ code_hash: hashCode(code), status: "available", profile_id: profile.id, created_by: req.profile.id, expires_at: null });
  if (error) { console.error("Access code:", error.message); return fail(res, 500, "No se pudo crear el código. Ejecuta el schema.sql actualizado."); }
  res.status(201).json({ ok: true, code, profile: { id: profile.id, full_name: profile.full_name, email: profile.email } });
});
app.get("/api/admin/users", profileRequired, roles("admin"), async (_req, res) => {
  const { data, error } = await db.from("app_users").select("id,auth_user_id,full_name,email,role,active,favorite_color,created_at").order("created_at", { ascending: false });
  if (error) return fail(res, 500, "No se pudieron cargar los usuarios.");
  res.json({ ok: true, users: data || [] });
});
app.patch("/api/admin/users/:id", profileRequired, roles("admin"), async (req, res) => {
  const { role, active, favorite_color, photo_data_url } = req.body || {}; const update = {};
  if (role !== undefined) { if (!["admin", "coordinacion", "profesor"].includes(role)) return fail(res, 400, "Rol no válido."); update.role = role; }
  if (active !== undefined) { if (typeof active !== "boolean") return fail(res, 400, "active debe ser verdadero o falso."); update.active = active; }
  if (favorite_color !== undefined) { if (!validColor(favorite_color)) return fail(res, 400, "Color no válido."); update.favorite_color = favorite_color; }
  if (photo_data_url !== undefined) { if (!validPhoto(photo_data_url)) return fail(res, 400, "La imagen no es válida o supera 300 KB."); update.photo_data_url = photo_data_url || null; }
  if (!Object.keys(update).length) return fail(res, 400, "No hay cambios válidos.");
  if (req.params.id === req.profile.id && update.active === false) return fail(res, 400, "No puedes desactivar tu propia cuenta desde esta sesión.");
  if (req.params.id === req.profile.id && update.role && update.role !== "admin") return fail(res, 400, "No puedes quitarte tu propio rol de administrador.");
  const { data, error } = await db.from("app_users").update(update).eq("id", req.params.id).select("id,full_name,email,role,active,favorite_color,photo_data_url").single();
  if (error) return fail(res, 500, "No se pudo actualizar el usuario.");
  res.json({ ok: true, user: data });
});
app.delete("/api/admin/users/:id", profileRequired, roles("admin"), async (req, res) => {
  if (req.params.id === req.profile.id) return fail(res, 400, "No puedes borrar tu propia cuenta de administración.");
  const { data: target, error: lookupError } = await db.from("app_users").select("id,role,full_name")
    .eq("id", req.params.id).maybeSingle();
  if (lookupError) return fail(res, 500, "No se pudo comprobar la cuenta.");
  if (!target) return fail(res, 404, "La cuenta no existe.");
  if (target.role !== "profesor") return fail(res, 400, "Desde aquí solo puedes borrar cuentas de profesores.");
  const { error: codeError } = await db.from("access_codes").update({ status: "revoked" })
    .eq("profile_id", target.id).eq("status", "available");
  if (codeError) return fail(res, 500, "No se pudo anular el código del profesor.");
  const { error } = await db.from("app_users").update({ active: false }).eq("id", target.id);
  if (error) return fail(res, 500, "No se pudo desactivar la cuenta.");
  res.json({ ok: true, message: "Acceso eliminado. Las calificaciones históricas se conservaron." });
});
app.get("/api/admin/results", profileRequired, roles("admin", "coordinacion"), async (_req, res) => {
  const { data, error } = await db.from("grade_results").select("*").order("created_at", { ascending: false }).limit(1000);
  if (error) return fail(res, 500, "No se pudieron cargar las calificaciones guardadas.");
  res.json({ ok: true, results: data || [] });
});
app.patch("/api/review/results/:id", profileRequired, roles("admin", "coordinacion"), async (req, res) => {
  const status = req.body?.status;
  if (!["approved", "returned"].includes(status)) return fail(res, 400, "El estado debe ser approved o returned.");
  const note = String(req.body?.review_note || "").trim().slice(0,1000);
  if (status === "returned" && !note) return fail(res, 400, "Escribe el motivo de la devolución.");
  const { data, error } = await db.from("grade_results").update({ status, reviewed_at: new Date().toISOString(), review_note: note, reviewed_by: req.profile.id })
    .eq("id", req.params.id).eq("status", "submitted").select("id,student_name,status,review_note").maybeSingle();
  if (error) { console.error("Review:", error.message); return fail(res, 500, "No se pudo actualizar el estado. Asegúrate de haber actualizado schema.sql."); }
  if (!data) return fail(res, 409, "Solo se pueden aprobar o devolver calificaciones que estén enviadas a coordinación.");
  res.json({ ok: true, result: data });
});

app.post("/api/admin/subjects", profileRequired, roles("admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0,150);
  if (name.length < 2) return fail(res, 400, "Escribe un nombre de materia válido.");
  const { data, error } = await db.from("subjects").insert({ name, active: true }).select("id,name,active").single();
  if (error) return fail(res, 409, "No se pudo crear la materia. Puede que ya exista.");
  res.status(201).json({ ok: true, subject: data });
});
app.patch("/api/admin/settings", profileRequired, roles("admin"), async (req, res) => {
  const school_year = String(req.body?.school_year || "").trim();
  const period_count = Number(req.body?.period_count), months_per_period = Number(req.body?.months_per_period);
  if (!/^\d{4}-\d{4}$/.test(school_year) || !Number.isInteger(period_count) || period_count < 1 || period_count > 12 || !Number.isInteger(months_per_period) || months_per_period < 1 || months_per_period > 12)
    return fail(res, 400, "Año escolar debe ser AAAA-AAAA y los períodos/meses deben estar entre 1 y 12.");
  const { data, error } = await db.from("academic_settings").insert({ school_year, period_count, months_per_period }).select("school_year,period_count,months_per_period").single();
  if (error) return fail(res, 500, "No se pudo guardar la configuración académica.");
  res.json({ ok: true, settings: data });
});

function validColor(value) { return /^#[0-9a-f]{6}$/i.test(String(value || "")); }
function validPhoto(value) {
  if (value == null || value === "") return true;
  return typeof value === "string" && value.length <= 450_000 && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value);
}
function validImage(value) { return value == null || value === "" || (typeof value === "string" && value.length <= 450_000 && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value)); }
app.patch("/api/admin/branding", profileRequired, roles("admin"), async (req, res) => {
  const institution_name = String(req.body?.institution_name || "").trim().replace(/\s+/g, " ").slice(0, 100);
  const institution_logo = req.body?.institution_logo || "";
  const home_photo = req.body?.home_photo || "";
  if (institution_name.length < 2) return fail(res, 400, "El nombre de la institución debe tener al menos 2 caracteres.");
  if (!validImage(institution_logo) || !validImage(home_photo)) return fail(res, 400, "Logo o foto no válidos. Usa PNG, JPG o WebP de máximo 300 KB cada uno.");
  const { error } = await db.from("app_meta").upsert([
    { key: "institution_name", value: institution_name },
    { key: "institution_logo", value: institution_logo },
    { key: "home_photo", value: home_photo }
  ], { onConflict: "key" });
  if (error) return fail(res, 500, "No se pudo guardar la portada institucional.");
  res.json({ ok: true, branding: { institution_name, institution_logo, home_photo } });
});
app.patch("/api/profile/preferences", profileRequired, async (req, res) => {
  const color = req.body?.favorite_color;
  if (!validColor(color)) return fail(res, 400, "Elige un color válido.");
  const update = { favorite_color: color };
  if (Object.hasOwn(req.body || {}, "background_image_data_url")) {
    if (!validImage(req.body.background_image_data_url)) return fail(res, 400, "La imagen de fondo no es válida o supera 300 KB.");
    update.background_image_data_url = req.body.background_image_data_url || null;
  }
  const { data, error } = await db.from("app_users").update(update).eq("id", req.profile.id)
    .select("id,full_name,role,favorite_color,photo_data_url,background_image_data_url").single();
  if (error) return fail(res, 500, "No se pudo guardar tu apariencia. Ejecuta schema.sql actualizado.");
  res.json({ ok: true, profile: data });
});

app.use((req, res) => fail(res, 404, `Ruta no encontrada: ${req.path}`));
app.listen(PORT, "0.0.0.0", () => console.log(`HIS-APP Gestor de Calificaciones escuchando en ${PORT}`));

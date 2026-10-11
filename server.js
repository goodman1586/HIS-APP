import express from "express";
import cors from "cors";
import path from "node:path";
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
const PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
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
  ok: true, service: "HIS-APP Gestor de Calificaciones", version: "2.1.0",
  supabaseConfigured: Boolean(db), publicKeyConfigured: Boolean(SUPABASE_URL && PUBLIC_KEY)
}));
app.get("/api/public-config", (_req, res) => {
  if (!SUPABASE_URL || !PUBLIC_KEY) return fail(res, 503, "Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en Render.");
  res.json({ url: SUPABASE_URL, publishableKey: PUBLIC_KEY });
});

async function authenticate(req, res, next) {
  if (!db) return fail(res, 503, "Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Render.");
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return fail(res, 401, "Inicia sesión para continuar.");
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return fail(res, 401, "La sesión no es válida. Inicia sesión de nuevo.");
    req.authUser = data.user;
    next();
  } catch (e) { console.error("Auth:", e.message); return fail(res, 500, "No se pudo verificar la sesión."); }
}
async function getOrCreateProfile(user, suppliedName = "") {
  const { data: found, error } = await db.from("app_users").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (error) throw error;
  if (found) return found;
  const fullName = String(suppliedName || user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuario").trim().slice(0, 120);
  const { data, error: insertError } = await db.from("app_users").insert({
    auth_user_id: user.id, full_name: fullName || "Usuario", email: user.email, role: "profesor", active: true
  }).select("*").single();
  if (insertError) {
    // Safe retry handles two simultaneous first requests without granting privileges.
    const retry = await db.from("app_users").select("*").eq("auth_user_id", user.id).maybeSingle();
    if (!retry.error && retry.data) return retry.data;
    throw insertError;
  }
  return data;
}
async function profileRequired(req, res, next) {
  try {
    req.profile = await getOrCreateProfile(req.authUser, req.body?.full_name);
    if (!req.profile.active) return fail(res, 403, "Tu cuenta está desactivada. Contacta con administración.");
    next();
  } catch (e) {
    console.error("Perfil:", e.message);
    return fail(res, 500, "No se pudo crear o leer tu perfil. Ejecuta schema.sql en Supabase y revisa las variables de Render.");
  }
}
const roles = (...allowed) => (req, res, next) => allowed.includes(req.profile?.role)
  ? next() : fail(res, 403, "No tienes permisos para realizar esta acción.");
app.use("/api", authenticate);

app.get("/api/auth/session", (req, res) => res.json({ ok: true, user: { id: req.authUser.id, email: req.authUser.email } }));
app.post("/api/register-profile", profileRequired, (req, res) => res.status(201).json({ ok: true, profile: req.profile }));
app.get("/api/me", profileRequired, (req, res) => res.json({ ok: true, profile: req.profile }));

app.get("/api/config", profileRequired, async (req, res) => {
  try {
    const [g, s, a] = await Promise.all([
      db.from("grades").select("id,name,sort_order").order("sort_order"),
      db.from("subjects").select("id,name,active").eq("active", true).order("name"),
      db.from("academic_settings").select("school_year,period_count,months_per_period").order("created_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    const err = g.error || s.error || a.error;
    if (err) throw err;
    res.json({ grades: g.data || [], subjects: s.data || [], settings: a.data || { school_year: "2026-2027", period_count: 3, months_per_period: 3 } });
  } catch (e) { console.error("Config:", e.message); fail(res, 500, "No se pudo cargar la configuración. Ejecuta schema.sql y crea al menos una materia."); }
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
  const calculate = values => {
    const average = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
    const offsets = [-6, -2, 3, 5];
    let scale = 1;
    for (const offset of offsets) {
      if (offset < 0) scale = Math.min(scale, average / Math.abs(offset));
      if (offset > 0) scale = Math.min(scale, (100 - average) / offset);
    }
    scale = Math.max(0, Math.min(1, scale));
    const generated = offsets.map(offset => Math.round((average + offset * scale) * 100) / 100);
    generated[3] = Math.round((average * 4 - generated[0] - generated[1] - generated[2]) * 100) / 100;
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
      average_b: calculated.average, generated_values: calculated.generated, generated_average: calculated.generatedAverage, status: "draft" });
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

app.get("/api/admin/users", profileRequired, roles("admin"), async (_req, res) => {
  const { data, error } = await db.from("app_users").select("id,auth_user_id,full_name,email,role,active,created_at").order("created_at", { ascending: false });
  if (error) return fail(res, 500, "No se pudieron cargar los usuarios.");
  res.json({ ok: true, users: data || [] });
});
app.patch("/api/admin/users/:id", profileRequired, roles("admin"), async (req, res) => {
  const { role, active } = req.body || {}; const update = {};
  if (role !== undefined) { if (!["admin", "coordinacion", "profesor"].includes(role)) return fail(res, 400, "Rol no válido."); update.role = role; }
  if (active !== undefined) { if (typeof active !== "boolean") return fail(res, 400, "active debe ser verdadero o falso."); update.active = active; }
  if (!Object.keys(update).length) return fail(res, 400, "No hay cambios válidos.");
  if (req.params.id === req.profile.id && update.active === false) return fail(res, 400, "No puedes desactivar tu propia cuenta desde esta sesión.");
  if (req.params.id === req.profile.id && update.role && update.role !== "admin") return fail(res, 400, "No puedes quitarte tu propio rol de administrador.");
  const { data, error } = await db.from("app_users").update(update).eq("id", req.params.id).select("id,full_name,email,role,active").single();
  if (error) return fail(res, 500, "No se pudo actualizar el usuario.");
  res.json({ ok: true, user: data });
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

app.use((req, res) => fail(res, 404, `Ruta no encontrada: ${req.path}`));
app.listen(PORT, "0.0.0.0", () => console.log(`HIS-APP Gestor de Calificaciones escuchando en ${PORT}`));

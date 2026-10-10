import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function requireUser(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Autenticación requerida" });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: "Sesión inválida o expirada" });
  const { data: profile, error: pErr } = await supabase.from("app_users")
    .select("id,auth_user_id,full_name,email,role,active")
    .eq("auth_user_id", data.user.id).eq("active", true).single();
  if (pErr || !profile) return res.status(403).json({ error: "Usuario sin perfil activo" });
  req.authUser = data.user;
  req.profile = profile;
  next();
}

function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.profile.role)
    ? next()
    : res.status(403).json({ error: "No tienes permiso para esta operación" });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gestor-calificaciones-api", version: "1.0.0" });
});

app.get("/api/config", requireUser, async (_req, res) => {
  const [{ data: grades, error: gErr }, { data: subjects, error: sErr }, { data: settings, error: stErr }] =
    await Promise.all([
      supabase.from("grades").select("*").order("sort_order"),
      supabase.from("subjects").select("*").eq("active", true).order("name"),
      supabase.from("academic_settings").select("*").order("created_at", { ascending: false }).limit(1)
    ]);

  if (gErr || sErr || stErr) {
    return res.status(500).json({ error: "No se pudo cargar la configuración" });
  }
  res.json({
    grades,
    subjects,
    settings: settings?.[0] || null
  });
});

app.post("/api/results", requireUser, async (req, res) => {
  const {
    teacher_id, teacher_name, grade_id, grade_name, subject_id, subject_name,
    school_year, period_no, student_name, source_values
  } = req.body;

  if (!student_name || !grade_id || !subject_id || !school_year || !period_no) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  const values = Array.isArray(source_values)
    ? source_values.map(Number).filter(Number.isFinite)
    : [];

  if (!values.length) return res.status(400).json({ error: "No hay valores para calcular" });

  const B = values.reduce((a, b) => a + b, 0) / values.length;

  // Valores variados y balanceados alrededor de B.
  let generated = [B - 6, B - 2, B + 3, B + 5];
  const correction = B - generated.reduce((a, b) => a + b, 0) / 4;
  generated[3] += correction * 4;
  generated = generated.map(x => Math.max(0, Math.min(100, Number(x.toFixed(4)))));
  const finalAverage = generated.reduce((a, b) => a + b, 0) / 4;

  const row = {
    teacher_id: req.profile.id,
    teacher_name: req.profile.full_name,
    grade_id,
    grade_name,
    subject_id,
    subject_name,
    school_year,
    period_no: Number(period_no),
    student_name,
    source_values: values,
    average_b: Number(B.toFixed(4)),
    generated_values: generated,
    generated_average: Number(finalAverage.toFixed(4)),
    status: "draft"
  };

  const { data, error } = await supabase.from("grade_results").insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/results", requireUser, async (req, res) => {
  let query = supabase.from("grade_results").select("*").order("created_at", { ascending: false });

  const filters = ["school_year", "grade_id", "subject_id", "period_no", "status"];
  for (const key of filters) {
    if (req.query[key] !== undefined && req.query[key] !== "") query = query.eq(key, req.query[key]);
  }
  if (req.profile.role === "profesor") query = query.eq("teacher_id", req.profile.id);

  const { data, error } = await query.limit(5000);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch("/api/results/:id/status", requireUser, requireRoles("admin","coordinacion"), async (req, res) => {
  const allowed = ["draft", "submitted", "approved", "returned"];
  if (!allowed.includes(req.body.status)) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  const { data, error } = await supabase
    .from("grade_results")
    .update({ status: req.body.status, reviewed_at: req.body.status === "approved" ? new Date().toISOString() : null })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/me", requireUser, (req, res) => res.json({ user: req.authUser, profile: req.profile }));

app.listen(process.env.PORT || 10000, () => {
  console.log(`API running on port ${process.env.PORT || 10000}`);
});
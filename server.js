import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Configuración de Supabase.
// Acepta la clave nueva SUPABASE_SECRET_KEY
// o la variable anterior SUPABASE_SERVICE_ROLE_KEY.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "ERROR: faltan SUPABASE_URL o una clave de Supabase " +
    "(SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY)."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Verifica que el usuario tenga una sesión válida
// y un perfil activo en la tabla app_users.
async function requireUser(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        error: "Autenticación requerida"
      });
    }

    const { data, error } =
      await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: "Sesión inválida o expirada"
      });
    }

    const { data: profile, error: profileError } =
      await supabase
        .from("app_users")
        .select(
          "id,auth_user_id,full_name,email,role,active"
        )
        .eq("auth_user_id", data.user.id)
        .eq("active", true)
        .single();

    if (profileError || !profile) {
      return res.status(403).json({
        error: "Usuario sin perfil activo"
      });
    }

    req.authUser = data.user;
    req.profile = profile;

    next();
  } catch (error) {
    console.error("Error de autenticación:", error.message);

    return res.status(500).json({
      error: "Error al verificar la sesión"
    });
  }
}

// Control de permisos por rol.
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.profile || !roles.includes(req.profile.role)) {
      return res.status(403).json({
        error: "No tienes permiso para esta operación"
      });
    }

    next();
  };
}

// Comprobación de salud del servidor.
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "gestor-calificaciones-api",
    version: "1.0.1"
  });
});

// Devuelve los grados, materias y configuración académica.
app.get("/api/config", requireUser, async (_req, res) => {
  try {
    const [
      { data: grades, error: gradesError },
      { data: subjects, error: subjectsError },
      { data: settings, error: settingsError }
    ] = await Promise.all([
      supabase
        .from("grades")
        .select("*")
        .order("sort_order"),

      supabase
        .from("subjects")
        .select("*")
        .eq("active", true)
        .order("name"),

      supabase
        .from("academic_settings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
    ]);

    if (gradesError || subjectsError || settingsError) {
      console.error(
        "Error al cargar configuración:",
        gradesError?.message,
        subjectsError?.message,
        settingsError?.message
      );

      return res.status(500).json({
        error: "No se pudo cargar la configuración"
      });
    }

    return res.json({
      grades,
      subjects,
      settings: settings?.[0] || null
    });
  } catch (error) {
    console.error("Error en /api/config:", error.message);

    return res.status(500).json({
      error: "Error interno al cargar la configuración"
    });
  }
});

// Crea un resultado académico.
app.post("/api/results", requireUser, async (req, res) => {
  try {
    const {
      grade_id,
      grade_name,
      subject_id,
      subject_name,
      school_year,
      period_no,
      student_name,
      source_values
    } = req.body;

    if (
      !student_name ||
      !grade_id ||
      !subject_id ||
      !school_year ||
      period_no === undefined ||
      period_no === null ||
      period_no === ""
    ) {
      return res.status(400).json({
        error: "Faltan campos obligatorios"
      });
    }

    const period = Number(period_no);

    if (!Number.isInteger(period) || period < 1) {
      return res.status(400).json({
        error: "El período académico no es válido"
      });
    }

    if (
      !Array.isArray(source_values) ||
      source_values.length === 0
    ) {
      return res.status(400).json({
        error: "No hay valores para calcular"
      });
    }

    const values = source_values.map(Number);

    if (
      values.some(
        value =>
          !Number.isFinite(value) ||
          value < 0 ||
          value > 100
      )
    ) {
      return res.status(400).json({
        error: "Las calificaciones deben estar entre 0 y 100"
      });
    }

    const average =
      values.reduce((sum, value) => sum + value, 0) /
      values.length;

    // Genera cuatro valores alrededor del promedio.
    // Se mantienen dentro del rango de 0 a 100.
    let generated = [
      average - 6,
      average - 2,
      average + 3,
      average + 5
    ];

    // Ajuste para centrar los valores en el promedio.
    const generatedAverage =
      generated.reduce((sum, value) => sum + value, 0) /
      generated.length;

    const correction = average - generatedAverage;

    generated = generated.map(value =>
      Number(
        Math.max(
          0,
          Math.min(100, value + correction)
        ).toFixed(4)
      )
    );

    const finalAverage =
      generated.reduce((sum, value) => sum + value, 0) /
      generated.length;

    const row = {
      teacher_id: req.profile.id,
      teacher_name: req.profile.full_name,
      grade_id,
      grade_name,
      subject_id,
      subject_name,
      school_year,
      period_no: period,
      student_name,
      source_values: values,
      average_b: Number(average.toFixed(4)),
      generated_values: generated,
      generated_average: Number(finalAverage.toFixed(4)),
      status: "draft"
    };

    const { data, error } = await supabase
      .from("grade_results")
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error("Error al guardar resultado:", error.message);

      return res.status(500).json({
        error: "No se pudo guardar el resultado"
      });
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error("Error en POST /api/results:", error.message);

    return res.status(500).json({
      error: "Error interno al procesar el resultado"
    });
  }
});

// Consulta resultados académicos.
app.get("/api/results", requireUser, async (req, res) => {
  try {
    let query = supabase
      .from("grade_results")
      .select("*")
      .order("created_at", { ascending: false });

    const filters = [
      "school_year",
      "grade_id",
      "subject_id",
      "period_no",
      "status"
    ];

    for (const key of filters) {
      if (
        req.query[key] !== undefined &&
        req.query[key] !== ""
      ) {
        query = query.eq(key, req.query[key]);
      }
    }

    if (req.profile.role === "profesor") {
      query = query.eq("teacher_id", req.profile.id);
    }

    const { data, error } = await query.limit(5000);

    if (error) {
      console.error("Error al consultar resultados:", error.message);

      return res.status(500).json({
        error: "No se pudieron consultar los resultados"
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("Error en GET /api/results:", error.message);

    return res.status(500).json({
      error: "Error interno al consultar resultados"
    });
  }
});

// Cambia el estado de un resultado.
// Solo administradores y coordinación pueden hacerlo.
app.patch(
  "/api/results/:id/status",
  requireUser,
  requireRoles("admin", "coordinacion"),
  async (req, res) => {
    try {
      const allowed = [
        "draft",
        "submitted",
        "approved",
        "returned"
      ];

      if (!allowed.includes(req.body.status)) {
        return res.status(400).json({
          error: "Estado inválido"
        });
      }

      const update = {
        status: req.body.status,
        reviewed_at:
          req.body.status === "approved"
            ? new Date().toISOString()
            : null
      };

      const { data, error } = await supabase
        .from("grade_results")
        .update(update)
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) {
        console.error("Error al actualizar estado:", error.message);

        return res.status(500).json({
          error: "No se pudo actualizar el estado"
        });
      }

      return res.json(data);
    } catch (error) {
      console.error("Error en PATCH /api/results:", error.message);

      return res.status(500).json({
        error: "Error interno al actualizar el resultado"
      });
    }
  }
);

// Devuelve la sesión y el perfil del usuario actual.
app.get("/api/me", requireUser, (req, res) => {
  res.json({
    user: req.authUser,
    profile: req.profile
  });
});

// Arranque del servidor.
const PORT = Number(process.env.PORT) || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gestor de Calificaciones API iniciado en puerto ${PORT}`);
});

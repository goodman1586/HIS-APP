
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "HIS-APP Gestor de Calificaciones",
    message: "Servidor funcionando"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "HIS-APP",
    supabaseConfigured: Boolean(supabase)
  });
});

app.get("/api/auth/session", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({
        ok: false,
        error: "Supabase no está configurado en Render"
      });
    }

    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Falta el token de acceso"
      });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        ok: false,
        error: "Sesión no válida"
      });
    }

    return res.json({
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email
      }
    });
  } catch (error) {
    console.error("Error verificando sesión:", error.message);

    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor"
    });
  }
});

app.listen(PORT, () => {
  console.log(`HIS-APP ejecutándose en el puerto ${PORT}`);
});


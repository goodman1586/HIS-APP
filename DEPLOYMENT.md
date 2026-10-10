# Despliegue V3

## Supabase
1. Ejecuta `supabase/schema.sql` en SQL Editor.
2. En Authentication > Users crea los usuarios de profesores/coordinación/admin.
3. Inserta cada perfil en `app_users` usando el UUID de Auth.
4. En `frontend/auth.js` sustituye `SUPABASE_URL` y `SUPABASE_ANON_KEY` por los valores públicos del proyecto.

## Backend en Render
Variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (solo backend; nunca en frontend)
- `PORT`

Build: `npm install`
Start: `npm start`

## Frontend
Publica `frontend/` en un hosting estático. Define `window.API_URL` antes de `auth.js` si el backend no está en localhost, por ejemplo:
`window.API_URL = "https://TU-SERVICIO.onrender.com";`

## Seguridad
El frontend usa la clave pública/anon de Supabase. La service role key solo se usa en Render. Las operaciones de resultados pasan por autenticación y el backend valida el usuario y su rol.

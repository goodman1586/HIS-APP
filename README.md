# Gestor de Calificaciones

Sistema web para profesores, coordinación y administración.

## Funciones
- Roles: admin, coordinacion, profesor.
- Grados 7th a 12th.
- Materias configurables.
- Año escolar configurable.
- Períodos configurables.
- Duración configurable en meses.
- Importación por copiar/pegar desde Excel.
- Cálculo de promedio B.
- Generación de 4 valores con promedio igual a B.
- Envío a coordinación y aprobación.
- Exportación CSV compatible con Excel.

## Desarrollo local
1. Crear proyecto en Supabase.
2. Ejecutar `supabase/schema.sql`.
3. En backend copiar `.env.example` a `.env`.
4. `cd backend && npm install && npm start`.
5. Abrir `frontend/index.html` mediante un servidor estático.

## Render
Crear un Web Service para `backend`, Node.js.
Build: `npm install`
Start: `npm start`

Variables:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- PORT (Render la proporciona)


## Autenticación Supabase
1. En Supabase, activar Email/Password en Authentication > Providers.
2. Crear los usuarios desde Authentication > Users.
3. Copiar el UUID de cada usuario.
4. Registrar el perfil en `app_users` con role `profesor`, `coordinacion` o `admin`.
5. Para producción, el frontend debe usar Supabase Auth y enviar el access token al backend.
6. No colocar `SUPABASE_SERVICE_ROLE_KEY` en el frontend.

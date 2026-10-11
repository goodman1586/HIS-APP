# Despliegue en Render + Supabase

## 1. Supabase
1. Crea/abre el proyecto Supabase.
2. En SQL Editor ejecuta el archivo completo `schema.sql`. Se puede volver a ejecutar para aplicar las columnas de revisión que faltaran.
3. En Authentication > Providers, activa Email. Decide si quieres exigir confirmación de correo; si está activa, cada usuario debe confirmar su dirección antes de iniciar sesión.
4. Copia la Project URL y la clave pública/publishable (o anon legacy). No uses la clave secreta en el navegador.

## 2. Render
Crea un Web Service desde el repositorio/carpeta que contiene `server.js`, `index.html`, `auth.js` y `package.json`.
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Variables de entorno en Render:
- `SUPABASE_URL`: URL del proyecto
- `SUPABASE_PUBLISHABLE_KEY`: clave pública/publishable (o define `SUPABASE_ANON_KEY` para clave anon legacy)
- `SUPABASE_SERVICE_ROLE_KEY`: clave secreta de servidor, solo en Render
- `PORT`: Render normalmente lo define automáticamente; opcional local `10000`
- `CORS_ALLOWED_ORIGINS`: opcional; lista de orígenes exactos separados por coma solo si la interfaz vive en otro dominio (por ejemplo `https://app.ejemplo.com`). Déjalo vacío si interfaz y API se sirven desde el mismo servicio.

No copies el contenido de `.env.example` literalmente: reemplaza los valores de ejemplo por los de tu proyecto.

## 3. Primer acceso y administrador
1. Abre la URL raíz del servicio Render, no `/health`.
2. Crea tu cuenta con tu nombre y correo.
3. Si se exige confirmación, confirma el correo y luego inicia sesión una vez para que el servidor cree el perfil.
4. Abre `make-admin.sql`, reemplaza `admin@tu-dominio.com` por el correo exacto registrado y ejecuta el SQL en Supabase.
5. Comprueba que el resultado muestra tu perfil con `role = admin`, y vuelve a iniciar sesión.

## 4. Pruebas después del despliegue
- `https://TU-SERVICIO.onrender.com/` debe mostrar la interfaz web.
- `https://TU-SERVICIO.onrender.com/health` debe devolver JSON de estado (esta ruta sí debe mostrar JSON).
- Registra una cuenta de prueba, confirma correo si aplica e inicia sesión.
- Como administrador, crea al menos una materia.
- Importa un grupo pequeño de notas, revisa el promedio, guarda borradores y envíalos a coordinación.
- Crea/asigna una cuenta de coordinación, entra con ella y prueba aprobar y devolver.

## Seguridad
- La API limita solicitudes por IP a 180 por minuto por instancia; en despliegues con varias instancias se recomienda un limitador con almacén compartido.
- La API recalcula promedios en el servidor y verifica grado, materia activa y período contra la configuración de Supabase.
- Nunca pongas `SUPABASE_SERVICE_ROLE_KEY` en `auth.js`, `index.html`, GitHub público ni variables del frontend.
- Los registros nuevos reciben siempre rol `profesor`; solo un administrador existente puede cambiar roles.
- Mantén copias de seguridad antes de aplicar cambios en una base de datos en uso.

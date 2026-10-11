# Despliegue en Render + Supabase

## 1. Supabase

1. Crea/abre el proyecto Supabase.
2. En SQL Editor ejecuta el archivo completo `schema.sql`. Se puede volver a ejecutar para aplicar tablas y columnas que falten.
3. Copia la Project URL y la clave secreta `service_role` para el backend. Esta clave solo va en Render; nunca en GitHub, `index.html` o el navegador.

## 2. Render

Crea un Web Service desde el repositorio/carpeta que contiene `server.js`, `index.html`, `auth.js` y `package.json`.

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Configura estas variables en Render:

- `SUPABASE_URL`: Project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: clave secreta `service_role`, solo en el servidor.
- `APP_SESSION_SECRET`: secreto aleatorio de al menos 32 caracteres para firmar las sesiones. No lo cambies después de desplegar o todas las sesiones activas dejarán de funcionar.
- `ADMIN_SETUP_CODE`: clave privada de administración, de al menos 20 caracteres. No se comparte con profesores; úsala para entrar como administradora.
- `PORT`: Render lo asigna automáticamente; localmente puedes usar `10000`.
- `CORS_ALLOWED_ORIGINS`: opcional; lista de orígenes exactos, separados por coma, solo si el frontend vive en otro dominio.

Cuando se actualice a esta versión, despliega primero el código y ejecuta de nuevo el `schema.sql` actualizado desde SQL Editor. Añade preferencias de perfil, precisión numérica y la tabla de publicaciones sin borrar calificaciones existentes.

Genera valores aleatorios largos para `APP_SESSION_SECRET` y `ADMIN_SETUP_CODE`; guárdalos en Render y no los subas al repositorio. `.env.example` contiene marcadores, no valores utilizables.

## 3. Crear la cuenta de administración

1. Abre la URL raíz del servicio Render, no `/health`.
2. Elige **Acceso administración**, escribe tu nombre y la clave privada `ADMIN_SETUP_CODE` configurada en Render.
3. La aplicación crea tu perfil de administración la primera vez. En accesos posteriores, la misma clave abre ese perfil.

## 4. Crear cuentas de profesores

1. Desde el panel de administración, pulsa **Crear código para profesor**.
2. Escribe el nombre completo y el correo del profesor. Esto crea su cuenta antes de que intente entrar.
3. Entrega al profesor el código numérico de 8 dígitos que aparece. El código se muestra una sola vez en el panel.
4. El profesor elige **Acceso profesor** y escribe el mismo nombre, correo y código.
5. Los códigos siguen activos hasta que el administrador desactive la cuenta o genere un código nuevo para ella. Un código nuevo invalida el anterior.
6. Al crear la cuenta, administración puede elegir foto de perfil y color favorito. Cada usuario puede cambiar el fondo de su propia vista.
7. En **Cargar usuarios**, el botón **Borrar** desactiva el acceso del profesor y anula su código. Las calificaciones históricas se mantienen para poder consultarlas en administración.

## 5. Apariencia, impresión y calificaciones

- Administración configura nombre institucional, logo y foto de portada desde **Institución y página principal**.
- Cada profesor elige un fondo claro (#EAF4FF, #E6F7F5, #F0EDFF o #E4F3F8) y puede subir una imagen personal de fondo.
- El encabezado muestra automáticamente el mes y año actuales.
- Las fotos deben ser PNG, JPG o WebP y pesar como máximo 300 KB.
- El profesor ve reportes compactos por materia; puede abrir su vista previa, desplazarse horizontalmente sin perder de vista al estudiante y descargar o imprimir el reporte.
- Administración/coordinación ve reportes compactos agrupados por profesor, materia, grado y mes (con año escolar y período). Dentro de cada vista previa puede aprobar o devolver envíos, descargar e imprimir ese reporte.
- El nombre, logo y foto de portada institucional se muestran tanto en la pantalla de acceso como en la página principal después de iniciar sesión.
- Antes de calcular, elige si los cuatro valores generados se muestran como decimales o como enteros. El promedio se conserva y puede no ser entero al promediar cuatro valores enteros.

## 6. Valor del mes y comunicados

- Administración escribe y guarda el **Valor del mes** desde su panel. Queda visible para todos los usuarios conectados.
- Administración y coordinación pueden publicar comunicados o publicaciones con título y mensaje; el tablón es visible para todos los profesores.
- Se muestran las 50 publicaciones más recientes.

Para dar acceso a coordinación, crea la cuenta como profesor y luego cambia su rol a `coordinacion` desde **Cargar usuarios**. Los profesores solo ven sus propios resultados; administración y coordinación pueden revisar los resultados de todos.

Cada sesión dura 90 días y queda guardada en el navegador. Si se vence o el profesor cambia de dispositivo, usa el mismo código mientras siga activo. Si perdió el código, el administrador genera uno nuevo para ese correo; esto invalida el anterior.

## 7. Comprobación

- `https://TU-SERVICIO.onrender.com/` debe mostrar las opciones de administración y profesor.
- `https://TU-SERVICIO.onrender.com/health` debe devolver JSON de estado.
- Confirma que un código incorrecto no permita entrar.
- Crea una cuenta desde administración y confirma que el profesor entra usando sus datos exactos.
- Como profesor, guarda notas; comprueba que otra cuenta de profesor no puede verlas.
- Prueba guardar borradores, enviar a coordinación, aprobar y devolver.

## Seguridad

- No existe registro público: las cuentas de profesor las crea administración antes de entregar el código.
- Los códigos numéricos se guardan solo como hash y el servidor limita los intentos de acceso por IP.
- No compartas `ADMIN_SETUP_CODE` ni `SUPABASE_SERVICE_ROLE_KEY`.
- `APP_SESSION_SECRET` firma las sesiones y debe mantenerse estable y privado.
- El servidor usa `SUPABASE_SERVICE_ROLE_KEY`, que omite RLS; por eso todas las rutas privadas verifican sesión, rol y propiedad en `server.js`.
- Mantén copias de seguridad antes de aplicar cambios en una base de datos en uso.

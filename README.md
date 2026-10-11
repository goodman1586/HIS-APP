# HIS-APP Gestor de Calificaciones

Aplicación web para profesores, coordinación y administración escolar. Incluye acceso privado por código numérico, importación desde Excel, cálculo y validación de notas, guardado de borradores, envío a coordinación, aprobación/devolución, exportación CSV y administración de usuarios, materias y configuración.

## Acceso

- Solo la administradora conoce `ADMIN_SETUP_CODE`, configurado como secreto en Render.
- Desde su panel, la administradora crea cada cuenta de profesor con nombre y correo y recibe un código numérico personal de 8 dígitos.
- El profesor entra con el código, el mismo nombre y el mismo correo que registró administración. Sin una cuenta y código precreados, no puede entrar.
- Para revocar o reemplazar un código, desactiva al profesor o genera uno nuevo desde administración.

## Funciones

- Roles `admin`, `coordinacion` y `profesor`, con controles aplicados en el servidor.
- Grados 7th a 12th, materias activas y configuración académica.
- Importación de filas copiadas desde Excel y validación de notas de 0 a 100.
- Cálculo de promedio B y cuatro valores generados cuyo promedio coincide con B a dos decimales.
- Guardado de borradores, envío, aprobación o devolución con motivo.
- Exportación CSV y panel para administrar usuarios y calificaciones.

## Despliegue

Sigue `DEPLOYMENT.md`. Configura `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_SESSION_SECRET` y `ADMIN_SETUP_CODE` como variables privadas en Render. No subas valores reales al repositorio.

Las sesiones duran 90 días. Los datos de cada profesor se filtran por su perfil y rol.

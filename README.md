# HIS-APP Gestor de Calificaciones

Aplicación web para profesores, coordinación y administración escolar. Esta versión incluye registro e inicio de sesión con Supabase Auth, importación pegando datos de Excel, cálculo y validación de notas, guardado de borradores, envío a coordinación, aprobación/devolución, exportación CSV y administración básica de usuarios/materias/configuración.

## Funciones
- Registro público con rol inicial fijo `profesor`; el navegador no puede escoger su propio rol.
- Inicio de sesión con Supabase Auth y creación del perfil `app_users` al autenticarse.
- Roles `admin`, `coordinacion` y `profesor`.
- Grados 7th a 12th.
- Materias activas configurables por administrador.
- Año escolar, cantidad de períodos y meses por período configurables.
- Importación de filas copiadas de Excel (nombre seguido de notas separadas por tabulaciones).
- Validación de notas de 0 a 100.
- Cálculo de promedio B y cuatro valores generados cuyo promedio coincide con B redondeado a dos decimales.
- Guardado en Supabase, envío a coordinación, aprobación o devolución con motivo.
- Exportación de resultados a CSV compatible con Excel.
- Panel administrativo para gestionar roles/estado de usuarios y consultar notas.

## Despliegue
Sigue `DEPLOYMENT.md`. No pongas la clave `SUPABASE_SERVICE_ROLE_KEY` en el navegador ni la compartas públicamente.

## Seguridad y configuración
- La clave `SUPABASE_SERVICE_ROLE_KEY` solo se configura en el servidor. El servidor aplica autenticación y roles; las consultas con esa clave omiten las políticas RLS de Supabase.
- Los promedios y valores generados se recalculan en el servidor; grado, materia activa y período se validan contra la configuración académica.
- Configura `CORS_ALLOWED_ORIGINS` únicamente cuando publiques el frontend en un dominio distinto.
- `.gitignore` excluye secretos locales, dependencias y archivos ZIP. Conserva `package-lock.json` para instalaciones repetibles.

## Importante
El proyecto debe probarse con las credenciales y el proyecto Supabase reales antes de considerarse operativo en producción. El ZIP no puede crear por sí solo un usuario real de administrador: registra primero tu usuario y sigue `make-admin.sql`.

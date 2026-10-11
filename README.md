# HIS-APP Gestor de Calificaciones

Aplicación web para profesores, coordinación y administración escolar. Incluye acceso privado por código numérico, importación desde Excel, cálculo y validación de notas, guardado de borradores, envío a coordinación, aprobación/devolución, exportación CSV, impresión de reportes, personalización institucional y preferencias visuales.

## Acceso

- Solo la administradora conoce `ADMIN_SETUP_CODE`, configurado como secreto en Render.
- Desde su panel, la administradora crea cada cuenta de profesor con nombre y correo y recibe un código numérico personal de 8 dígitos.
- El profesor entra con el código, el mismo nombre y el mismo correo que registró administración. Sin una cuenta y código precreados, no puede entrar.
- Para revocar o reemplazar un código, desactiva al profesor o genera uno nuevo desde administración.

## Funciones

- Roles `admin`, `coordinacion` y `profesor`, con controles aplicados en el servidor.
- Grados 7th a 12th, materias activas y configuración académica.
- Importación de filas copiadas desde Excel y validación de notas de 0 a 100.
- Cálculo de promedio B y cuatro valores generados en formato decimal o entero.
- Guardado de borradores, envío, aprobación o devolución con motivo.
- Exportación CSV e impresión de resultados del profesor y registros de coordinación.
- Archivos resumidos por materia; vista previa con la columna del estudiante fija al desplazarse, y descarga o impresión por archivo.
- Revisión administrativa compacta, con reportes agrupados por profesor, materia, grado, mes, año escolar y período; desde la vista previa se revisa, descarga e imprime cada grupo.
- Administración puede borrar el acceso de una cuenta de profesor. Se anula su código y sus notas históricas se conservan.
- Selector de archivos con estilo renovado para subir fotos, logos y portadas.
- Nombre, logo y foto de portada institucional configurables por administración.
- El nombre, logo y portada aparecen en la página de acceso y en la página principal de la aplicación.
- Valor del mes editable por administración y visible para todo el personal.
- Tablón para comunicados y publicaciones, que administración o coordinación pueden compartir con todos los profesores.
- Foto de perfil para profesores; cada persona puede elegir una foto de fondo y uno de cuatro temas suaves (#EAF4FF, #E6F7F5, #F0EDFF y #E4F3F8).
- Indicador con el mes y año actuales junto al encabezado.
- Interfaz adaptable, limpia y con marca de agua discreta.

## Despliegue

Sigue `DEPLOYMENT.md`. Configura `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_SESSION_SECRET` y `ADMIN_SETUP_CODE` como variables privadas en Render. No subas valores reales al repositorio.

Las sesiones duran 90 días. Los datos de cada profesor se filtran por su perfil y rol. La versión 2.5.0 no requiere cambios nuevos en la base de datos; si aún no has aplicado las funciones anteriores, ejecuta el `schema.sql` incluido, que conserva los datos existentes.

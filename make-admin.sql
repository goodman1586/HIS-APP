-- La primera cuenta administrativa se crea al iniciar sesión en la aplicación
-- con ADMIN_SETUP_CODE, configurado como secreto privado en Render.
-- Este archivo solo permite revisar las cuentas existentes:
select id, full_name, email, role, active, created_at
from public.app_users
order by created_at desc;

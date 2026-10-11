-- Ejecuta después de registrar la cuenta en la aplicación e iniciar sesión al menos una vez.
-- Sustituye admin@tu-dominio.com por el correo EXACTO de tu cuenta.
update public.app_users
set role = 'admin', active = true
where lower(email) = lower('admin@tu-dominio.com');

-- Debe devolver 1 fila actualizada. Si devuelve 0, inicia sesión una vez y vuelve a ejecutar.
select id, auth_user_id, full_name, email, role, active
from public.app_users
where lower(email) = lower('admin@tu-dominio.com');

create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  full_name text not null,
  email text unique,
  role text not null check (role in ('admin','coordinacion','profesor')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists grades (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  sort_order int not null
);

insert into grades(name, sort_order) values
('7th Grade',7),('8th Grade',8),('9th Grade',9),
('10th Grade',10),('11th Grade',11),('12th Grade',12)
on conflict (name) do nothing;

create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists academic_settings (
  id uuid primary key default gen_random_uuid(),
  school_year text not null,
  period_count int not null default 3 check (period_count between 1 and 12),
  months_per_period int not null default 3 check (months_per_period between 1 and 12),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into academic_settings(school_year, period_count, months_per_period)
select '2026-2027', 3, 3
where not exists (select 1 from academic_settings);

create table if not exists grade_results (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid,
  teacher_name text,
  grade_id uuid not null references grades(id),
  grade_name text not null,
  subject_id uuid not null references subjects(id),
  subject_name text not null,
  school_year text not null,
  period_no int not null,
  student_name text not null,
  source_values jsonb not null,
  average_b numeric(10,4) not null,
  generated_values jsonb not null,
  generated_average numeric(10,4) not null,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','returned')),
  reviewed_at timestamptz,
  reviewed_by uuid references app_users(id),
  review_note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_results_school_year on grade_results(school_year);
create index if not exists idx_results_grade on grade_results(grade_id);
create index if not exists idx_results_subject on grade_results(subject_id);
create index if not exists idx_results_period on grade_results(period_no);
create index if not exists idx_results_status on grade_results(status);

-- RLS protege las conexiones directas hechas con claves anon/publishable.
-- El servidor usa SUPABASE_SERVICE_ROLE_KEY, que omite RLS; por eso server.js
-- debe autenticar cada petición y aplicar allí todos los controles de rol y propiedad.
-- No expongas esa clave en el navegador ni en el repositorio.


-- ============================
-- AUTENTICACIÓN Y RLS
-- ============================
-- Los usuarios se crean en Supabase Authentication > Users.
-- Después se registra su perfil en app_users usando el mismo UUID de Auth.
-- Ejemplo:
-- insert into app_users(auth_user_id, full_name, email, role)
-- values ('UUID_DE_AUTH', 'Nombre', 'correo@escuela.com', 'profesor');

alter table app_users enable row level security;
alter table grade_results enable row level security;
alter table grades enable row level security;
alter table subjects enable row level security;
alter table academic_settings enable row level security;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.app_users
  where auth_user_id = auth.uid() and active = true
  limit 1;
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.app_users
  where auth_user_id = auth.uid() and active = true
  limit 1;
$$;

drop policy if exists "authenticated users read grades" on grades;
create policy "authenticated users read grades" on grades
for select to authenticated using (true);

drop policy if exists "authenticated users read subjects" on subjects;
create policy "authenticated users read subjects" on subjects
for select to authenticated using (true);

drop policy if exists "authenticated users read settings" on academic_settings;
create policy "authenticated users read settings" on academic_settings
for select to authenticated using (true);

drop policy if exists "users read own profile" on app_users;
create policy "users read own profile" on app_users
for select to authenticated
using (auth_user_id = auth.uid() or public.current_app_role() in ('admin','coordinacion'));

drop policy if exists "professor insert own results" on grade_results;
create policy "professor insert own results" on grade_results
for insert to authenticated
with check (
  teacher_id = public.current_app_user_id()
  or public.current_app_role() in ('admin','coordinacion')
);

drop policy if exists "professor read own results" on grade_results;
create policy "professor read own results" on grade_results
for select to authenticated
using (
  teacher_id = public.current_app_user_id()
  or public.current_app_role() in ('admin','coordinacion')
);

drop policy if exists "coordination update results" on grade_results;
create policy "coordination update results" on grade_results
for update to authenticated
using (public.current_app_role() in ('admin','coordinacion'))
with check (public.current_app_role() in ('admin','coordinacion'));


-- Safe migration for projects that already created grade_results before review workflow.
alter table public.grade_results add column if not exists reviewed_by uuid references public.app_users(id);
alter table public.grade_results add column if not exists review_note text not null default '';

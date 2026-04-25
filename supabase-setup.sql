-- ============================================================
-- BREHL VISUALS OS v2 – Komplettes Supabase Setup
-- SQL Editor → New Query → Alles reinkopieren → Run
-- ============================================================

-- PROFILES
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  full_name text,
  role text default 'mitarbeiter' check (role in ('admin','mitarbeiter')),
  permissions text[] default '{}',
  created_at timestamp with time zone default timezone('utc', now())
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'mitarbeiter')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- CRM
create table if not exists public.crm_leads (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  firma text,
  email text,
  telefon text,
  website text,
  status text default 'neu',
  quelle text,
  utm_source text,
  utm_medium text,
  created_at timestamp with time zone default timezone('utc', now())
);

create table if not exists public.crm_darsteller (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  email text,
  telefon text,
  alter_jahre integer,
  erfahrung text,
  status text default 'neu',
  instagram text,
  created_at timestamp with time zone default timezone('utc', now())
);

create table if not exists public.crm_notizen (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  darsteller_id uuid references public.crm_darsteller(id) on delete cascade,
  text text not null,
  created_at timestamp with time zone default timezone('utc', now())
);

create table if not exists public.crm_tasks (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  darsteller_id uuid references public.crm_darsteller(id) on delete cascade,
  titel text not null,
  faellig_am timestamp with time zone,
  erledigt boolean default false,
  created_at timestamp with time zone default timezone('utc', now())
);

-- PROJEKTE
create table if not exists public.proj_kunden (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  kontakt text,
  email text,
  created_at timestamp with time zone default timezone('utc', now())
);

create table if not exists public.proj_drehs (
  id uuid default gen_random_uuid() primary key,
  datum date,
  kunde_id uuid references public.proj_kunden(id) on delete set null,
  kunde_name text,
  status text default 'planung' check (status in ('planung','abnahme_kunde','dreh','cutting','posting','abgeschlossen')),
  zustaendig_id uuid references public.profiles(id) on delete set null,
  darsteller_id uuid,
  darsteller_name text,
  nas_gesichert boolean default false,
  abnahme_bestaetigt boolean default false,
  video_count integer default 0,
  videos jsonb default '[]',
  erlaeuterungen_cutter text,
  requisiten text,
  recruiting text,
  dauer text,
  created_at timestamp with time zone default timezone('utc', now())
);

create table if not exists public.proj_intern (
  id uuid default gen_random_uuid() primary key,
  titel text not null,
  drehtag date,
  status text default 'planung' check (status in ('planung','dreh','cutting','posting')),
  zustaendig text,
  video_planung text,
  requisiten text,
  created_at timestamp with time zone default timezone('utc', now())
);

create table if not exists public.proj_notizen (
  id uuid default gen_random_uuid() primary key,
  dreh_id uuid references public.proj_drehs(id) on delete cascade,
  text text not null,
  created_at timestamp with time zone default timezone('utc', now())
);

-- FUNNELS & LPs
create table if not exists public.funnel_lps (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  url text,
  kunde text,
  status text default 'aktiv' check (status in ('aktiv','pausiert','in_bau')),
  notizen text,
  created_at timestamp with time zone default timezone('utc', now())
);

create table if not exists public.funnel_intern (
  id uuid default gen_random_uuid() primary key,
  kanal text not null,
  leads_monat integer default 0,
  conversion numeric(5,2) default 0,
  notizen text,
  created_at timestamp with time zone default timezone('utc', now())
);

-- PORTAL NEWS
create table if not exists public.portal_news (
  id uuid default gen_random_uuid() primary key,
  titel text not null,
  inhalt text,
  created_at timestamp with time zone default timezone('utc', now())
);

-- RLS (Row Level Security)
do $$ 
declare t text;
begin
  foreach t in array array['profiles','crm_leads','crm_darsteller','crm_notizen','crm_tasks','proj_kunden','proj_drehs','proj_intern','proj_notizen','funnel_lps','funnel_intern','portal_news']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('create policy auth_all on public.%I for all using (auth.role() = ''authenticated'')', t);
  end loop;
end $$;

-- Supabase Storage Bucket für Video-Uploads
insert into storage.buckets (id, name, public) values ('drehs', 'drehs', false) on conflict do nothing;
create policy "auth upload drehs" on storage.objects for insert with check (auth.role() = 'authenticated' and bucket_id = 'drehs');
create policy "auth read drehs" on storage.objects for select using (auth.role() = 'authenticated' and bucket_id = 'drehs');

-- ============================================================
-- NACH ERSTEM LOGIN: Admin-Rechte vergeben
-- (Email anpassen!)
-- ============================================================
-- UPDATE public.profiles 
-- SET role = 'admin', full_name = 'Felix Brehl', permissions = '{}'
-- WHERE email = 'felix.brehl@brehlvisuals.de';

create extension if not exists pgcrypto;

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  teacher_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.group_settings (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  group_number integer not null check (group_number between 1 and 5),
  expected_students integer not null check (expected_students > 0),
  created_at timestamptz not null default now(),
  unique(round_id, group_number)
);

create table if not exists public.student_submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  group_number integer not null check (group_number between 1 and 5),
  initials text not null,
  now_scores jsonb not null default '{}'::jsonb,
  target_scores jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique(round_id, group_number, initials)
);

create table if not exists public.group_choices (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  group_number integer not null check (group_number between 1 and 5),
  aspect_key text not null,
  chosen_option text not null check (chosen_option in ('A','B','C')),
  created_at timestamptz not null default now(),
  unique(round_id, group_number, aspect_key)
);

create table if not exists public.action_plans (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  group_number integer not null check (group_number between 1 and 5),
  aspect_key text not null,
  what_text text not null,
  how_text text not null,
  where_text text not null,
  when_text text not null,
  scrum_owner text not null,
  who_text text not null,
  updated_at timestamptz not null default now(),
  unique(round_id, group_number, aspect_key)
);

alter table public.rounds enable row level security;
alter table public.group_settings enable row level security;
alter table public.student_submissions enable row level security;
alter table public.group_choices enable row level security;
alter table public.action_plans enable row level security;

drop policy if exists "anon full access rounds" on public.rounds;
drop policy if exists "anon full access group_settings" on public.group_settings;
drop policy if exists "anon full access student_submissions" on public.student_submissions;
drop policy if exists "anon full access group_choices" on public.group_choices;
drop policy if exists "anon full access action_plans" on public.action_plans;

create policy "anon full access rounds" on public.rounds for all to anon using (true) with check (true);
create policy "anon full access group_settings" on public.group_settings for all to anon using (true) with check (true);
create policy "anon full access student_submissions" on public.student_submissions for all to anon using (true) with check (true);
create policy "anon full access group_choices" on public.group_choices for all to anon using (true) with check (true);
create policy "anon full access action_plans" on public.action_plans for all to anon using (true) with check (true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_action_plans_updated_at on public.action_plans;
create trigger trg_action_plans_updated_at
before update on public.action_plans
for each row
execute function public.set_updated_at();

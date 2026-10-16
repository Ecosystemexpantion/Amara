-- Web version of Amara: a private link key per student and a live log of each SRE bot build.
alter table public.amara_students
  add column if not exists web_key text unique default replace(gen_random_uuid()::text, '-', '');
update public.amara_students set web_key = replace(gen_random_uuid()::text, '-', '') where web_key is null;

create table if not exists public.sre_runs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.amara_students(id) on delete cascade,
  source text not null,
  status text not null default 'running',
  bot_username text,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sre_runs_student_created on public.sre_runs (student_id, created_at desc);

alter table public.sre_runs enable row level security;
revoke all on public.sre_runs from anon, authenticated;

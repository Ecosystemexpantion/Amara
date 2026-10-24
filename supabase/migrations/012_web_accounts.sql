-- Standalone web app: email + password accounts, sessions, an inbox for students who use
-- the web only (their telegram_chat_id is a "w…" placeholder), and the web chat SRE.
alter table public.amara_students
  add column if not exists password_hash text,
  add column if not exists sre_slug text unique,
  add column if not exists sre_name text;

create table if not exists public.web_sessions (
  token_hash text primary key,
  student_id uuid not null references public.amara_students(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists web_sessions_student on public.web_sessions (student_id);

-- One-time codes Amara sends on Telegram when an existing student links their web account.
create table if not exists public.web_link_codes (
  student_id uuid primary key references public.amara_students(id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null
);

-- Messages for web-only students (what Amara would have sent on Telegram).
create table if not exists public.web_inbox (
  id bigint generated always as identity primary key,
  chat_id text not null,
  kind text not null default 'text',
  text text,
  filename text,
  data text,
  created_at timestamptz not null default now()
);
create index if not exists web_inbox_chat on public.web_inbox (chat_id, id);

alter table public.web_sessions enable row level security;
alter table public.web_link_codes enable row level security;
alter table public.web_inbox enable row level security;
revoke all on public.web_sessions, public.web_link_codes, public.web_inbox from anon, authenticated;

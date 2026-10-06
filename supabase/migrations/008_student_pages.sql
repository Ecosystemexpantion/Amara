-- Tracks each student's GitHub Pages sales pages so the cron can repair 404s
-- and re-publish everyone's pages when the design version changes.
create table if not exists public.student_pages (
  student_id uuid primary key references public.amara_students(id) on delete cascade,
  version integer not null default 0,
  status text not null default 'pending',
  detail text,
  synced_at timestamptz
);

alter table public.student_pages enable row level security;
revoke all on public.student_pages from anon, authenticated;

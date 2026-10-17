-- Agent runs now cover every day: the SRE bot build, the Day 2 sales pages,
-- Day 3/4 screenshot checks and the Day 4 certificate.
alter table public.sre_runs add column if not exists kind text not null default 'sre';
alter table public.sre_runs add column if not exists title text;

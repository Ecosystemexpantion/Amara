-- Telegram "it's done" messages for builds a student is watching on the web are held
-- until the page finishes its animation (or the cron sends them as a fallback).
alter table public.sre_runs add column if not exists announce jsonb;
alter table public.sre_runs add column if not exists announced_at timestamptz;

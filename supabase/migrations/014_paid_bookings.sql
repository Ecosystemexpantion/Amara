-- Free and paid calls. Free intro calls only in the free window (Wednesday 9–10 AM by default);
-- paid calls Monday–Saturday; "Talk now" priority calls at a premium. Paid bookings hold their slot
-- while the visitor pays by transfer through Paystack ("pending"); payments the admin confirms
-- wait in "review".
alter table public.booking_settings
  add column if not exists call_types jsonb not null default '[
    {"id":"intro","name":"Free intro call","minutes":15,"price":0,"blurb":"A quick hello: tell us where you are and we point you to your next step. Only on Wednesday mornings."},
    {"id":"strategy","name":"Strategy call","minutes":30,"price":10000,"blurb":"A focused 1-on-1 on your business: your setup, your offer and your plan to your first sales."},
    {"id":"setup","name":"Done-with-you session","minutes":60,"price":25000,"blurb":"We work on your setup with you, live on the call, until it is done."},
    {"id":"now","name":"Talk now — priority call","minutes":30,"price":30000,"blurb":"Skip the calendar. Pay and the EEM26 team calls you on WhatsApp within 30 minutes."}
  ]'::jsonb,
  add column if not exists free_days int[] not null default '{3}',
  add column if not exists free_start_hour int not null default 9,
  add column if not exists free_end_hour int not null default 10,
  add column if not exists now_enabled boolean not null default true,
  add column if not exists now_start_hour int not null default 8,
  add column if not exists now_end_hour int not null default 21;

alter table public.bookings
  add column if not exists call_type text not null default 'intro',
  add column if not exists amount_naira int not null default 0,
  add column if not exists pay_ref text unique,
  add column if not exists hold_until timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists done_at timestamptz,
  add column if not exists nudges int not null default 0;

-- Calls have different lengths, so the rule is "no two scheduled calls overlap".
-- Priority "now" calls sit outside the calendar.
drop index if exists public.bookings_one_per_slot;
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (tstzrange(slot_start, slot_end) with &&)
  where (status in ('booked', 'pending', 'review') and call_type <> 'now');

-- EEM26 call booking (replaces Calendly): open hours, booked calls and a private manage link per booking.
create table if not exists public.booking_settings (
  id int primary key default 1 check (id = 1),
  days int[] not null default '{1,2,3,4,5,6}',      -- 0 = Sunday … 6 = Saturday, Nigeria time
  start_hour int not null default 10,
  end_hour int not null default 18,
  slot_minutes int not null default 30,
  notice_hours int not null default 2,
  horizon_days int not null default 21,
  blocked_dates date[] not null default '{}'
);
insert into public.booking_settings (id) values (1) on conflict do nothing;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  name text not null,
  phone text not null,
  email text,
  topic text,
  via_student_id uuid references public.amara_students(id) on delete set null,
  status text not null default 'booked',
  manage_token_hash text not null unique,
  reminded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
-- Two people can never hold the same slot.
create unique index if not exists bookings_one_per_slot on public.bookings (slot_start) where status = 'booked';
create index if not exists bookings_upcoming on public.bookings (status, slot_start);

alter table public.booking_settings enable row level security;
alter table public.bookings enable row level security;
revoke all on public.booking_settings, public.bookings from anon, authenticated;

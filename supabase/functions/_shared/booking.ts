// EEM26 call booking (our replacement for Calendly). Slots are in Nigeria time (UTC+1, no
// daylight saving); everything is stored in UTC. Used by the booking API, the admin commands
// and the cron's call reminders.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export const BOOKING_URL = "https://ecosystemexpantion.github.io/eem26-book/";
export const BOOKING_REPO = "eem26-book";
const NIGERIA_OFFSET_MS = 3600_000;

export interface BookingSettings {
  days: number[];
  start_hour: number;
  end_hour: number;
  slot_minutes: number;
  notice_hours: number;
  horizon_days: number;
  blocked_dates: string[];
}

export interface Booking {
  id: string;
  slot_start: string;
  slot_end: string;
  name: string;
  phone: string;
  email: string | null;
  topic: string | null;
  via_student_id: string | null;
  status: string;
}

export async function getSettings(): Promise<BookingSettings> {
  const { data } = await db.from("booking_settings").select("*").eq("id", 1).maybeSingle();
  return (data as BookingSettings) ?? { days: [1, 2, 3, 4, 5, 6], start_hour: 10, end_hour: 18, slot_minutes: 30, notice_hours: 2, horizon_days: 21, blocked_dates: [] };
}

export async function updateSettings(patch: Partial<BookingSettings>): Promise<void> {
  const { error } = await db.from("booking_settings").update(patch).eq("id", 1);
  if (error) throw new Error(`updateSettings: ${error.message}`);
}

// Nigeria calendar date (YYYY-MM-DD) of a moment.
export function nigeriaDate(ms: number): string {
  return new Date(ms + NIGERIA_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatNigeria(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

// Every open slot start (UTC ISO) from now until the horizon, before removing booked ones.
export function openSlots(s: BookingSettings, nowMs = Date.now()): string[] {
  const out: string[] = [];
  const earliest = nowMs + s.notice_hours * 3600_000;
  const blocked = new Set(s.blocked_dates);
  const today = Date.parse(`${nigeriaDate(nowMs)}T00:00:00Z`);
  for (let d = 0; d <= s.horizon_days; d++) {
    const dayUtc = today + d * 86_400_000;
    const date = new Date(dayUtc).toISOString().slice(0, 10);
    if (blocked.has(date) || !s.days.includes(new Date(dayUtc).getUTCDay())) continue;
    for (let m = s.start_hour * 60; m + s.slot_minutes <= s.end_hour * 60; m += s.slot_minutes) {
      const start = dayUtc + m * 60_000 - NIGERIA_OFFSET_MS;
      if (start >= earliest) out.push(new Date(start).toISOString());
    }
  }
  return out;
}

export async function takenSlots(fromIso: string): Promise<Set<string>> {
  const { data } = await db.from("bookings").select("slot_start").eq("status", "booked").gte("slot_start", fromIso);
  return new Set((data ?? []).map((b) => new Date(b.slot_start as string).toISOString()));
}

export async function freeSlots(): Promise<{ settings: BookingSettings; slots: string[] }> {
  const settings = await getSettings();
  const all = openSlots(settings);
  const taken = await takenSlots(all[0] ?? new Date().toISOString());
  return { settings, slots: all.filter((s) => !taken.has(s)) };
}

export async function upcomingBookings(limit = 30): Promise<Booking[]> {
  const { data } = await db
    .from("bookings")
    .select("*")
    .eq("status", "booked")
    .gte("slot_start", new Date(Date.now() - 3600_000).toISOString())
    .order("slot_start")
    .limit(limit);
  return (data ?? []) as Booking[];
}

export async function cancelBooking(id: string): Promise<Booking | null> {
  const { data } = await db
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "booked")
    .select("*");
  return (data?.[0] as Booking) ?? null;
}

export function waLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0/, "234");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

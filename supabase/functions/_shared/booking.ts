// EEM26 call booking (our replacement for Calendly). Times are in Nigeria time (UTC+1, no
// daylight saving); everything is stored in UTC. Free intro calls only in the free window,
// paid calls in the open hours, and paid "Talk now" priority calls outside the calendar.
// Used by the booking API, the admin commands and the cron.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export const BOOKING_URL = "https://ecosystemexpantion.github.io/eem26-book/";
export const BOOKING_REPO = "eem26-book";
export const PAYSTACK_PUBLIC_KEY = Deno.env.get("PAYSTACK_PUBLIC_KEY") ?? "pk_live_d4b401792b62d34e6664a0180eb4e0eb036ebe16";
export const PAY_HOLD_MINUTES = 30;
const NIGERIA_OFFSET_MS = 3600_000;

export interface CallType {
  id: string;
  name: string;
  minutes: number;
  price: number;
  blurb: string;
}

export interface BookingSettings {
  days: number[];
  start_hour: number;
  end_hour: number;
  notice_hours: number;
  horizon_days: number;
  blocked_dates: string[];
  call_types: CallType[];
  free_days: number[];
  free_start_hour: number;
  free_end_hour: number;
  now_enabled: boolean;
  now_start_hour: number;
  now_end_hour: number;
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
  call_type: string;
  amount_naira: number;
  pay_ref: string | null;
  hold_until: string | null;
  paid_at: string | null;
  done_at: string | null;
}

export const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export async function getSettings(): Promise<BookingSettings> {
  const { data, error } = await db.from("booking_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`booking settings: ${error?.message}`);
  return data as BookingSettings;
}

export async function updateSettings(patch: Partial<BookingSettings>): Promise<void> {
  const { error } = await db.from("booking_settings").update(patch).eq("id", 1);
  if (error) throw new Error(`updateSettings: ${error.message}`);
}

export function callType(s: BookingSettings, id: string): CallType | null {
  return s.call_types.find((t) => t.id === id) ?? null;
}

export function naira(n: number): string {
  return `₦${n.toLocaleString("en-NG")}`;
}

export function nigeriaDate(ms: number): string {
  return new Date(ms + NIGERIA_OFFSET_MS).toISOString().slice(0, 10);
}

function nigeriaNow(ms = Date.now()): { day: number; hour: number } {
  const d = new Date(ms + NIGERIA_OFFSET_MS);
  return { day: d.getUTCDay(), hour: d.getUTCHours() + d.getUTCMinutes() / 60 };
}

export function formatNigeria(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

// Is "Talk now" open at this moment?
export function nowOpen(s: BookingSettings, ms = Date.now()): boolean {
  const n = nigeriaNow(ms);
  return s.now_enabled && s.days.includes(n.day) && n.hour >= s.now_start_hour && n.hour < s.now_end_hour;
}

// Candidate start times (UTC ISO) for a scheduled call type, before removing busy times.
export function candidateSlots(s: BookingSettings, t: CallType, nowMs = Date.now()): string[] {
  const free = t.price === 0;
  const days = free ? s.free_days : s.days;
  const [from, to] = free ? [s.free_start_hour, s.free_end_hour] : [s.start_hour, s.end_hour];
  const earliest = nowMs + s.notice_hours * 3600_000;
  const blocked = new Set(s.blocked_dates);
  const today = Date.parse(`${nigeriaDate(nowMs)}T00:00:00Z`);
  const out: string[] = [];
  for (let d = 0; d <= s.horizon_days; d++) {
    const dayUtc = today + d * 86_400_000;
    if (blocked.has(new Date(dayUtc).toISOString().slice(0, 10)) || !days.includes(new Date(dayUtc).getUTCDay())) continue;
    for (let m = from * 60; m + t.minutes <= to * 60; m += t.minutes) {
      const start = dayUtc + m * 60_000 - NIGERIA_OFFSET_MS;
      if (start >= earliest) out.push(new Date(start).toISOString());
    }
  }
  return out;
}

// Payment holds that ran out free their time again.
export async function expireHolds(): Promise<void> {
  await db.from("bookings").update({ status: "expired" }).eq("status", "pending").lt("hold_until", new Date().toISOString());
}

async function busyRanges(): Promise<[number, number][]> {
  const { data } = await db
    .from("bookings")
    .select("slot_start, slot_end")
    .in("status", ["booked", "pending", "review"])
    .neq("call_type", "now")
    .gte("slot_end", new Date().toISOString());
  return (data ?? []).map((b) => [Date.parse(b.slot_start as string), Date.parse(b.slot_end as string)]);
}

export async function availability(): Promise<{ settings: BookingSettings; types: (CallType & { slots: string[]; available: boolean })[] }> {
  await expireHolds();
  const [settings, busy] = await Promise.all([getSettings(), busyRanges()]);
  const types = settings.call_types.map((t) => {
    if (t.id === "now") return { ...t, slots: [], available: nowOpen(settings) };
    const slots = candidateSlots(settings, t).filter((iso) => {
      const a = Date.parse(iso), b = a + t.minutes * 60_000;
      return !busy.some(([s, e]) => a < e && s < b);
    });
    return { ...t, slots, available: slots.length > 0 };
  });
  return { settings, types };
}

export async function upcomingBookings(limit = 30): Promise<Booking[]> {
  const { data } = await db
    .from("bookings")
    .select("*")
    .in("status", ["booked", "review"])
    .gte("slot_end", new Date(Date.now() - 3600_000).toISOString())
    .order("slot_start")
    .limit(limit);
  return (data ?? []) as Booking[];
}

export async function earnings(sinceIso: string): Promise<{ total: number; count: number }> {
  const { data } = await db.from("bookings").select("amount_naira").not("paid_at", "is", null).gte("paid_at", sinceIso);
  return { total: (data ?? []).reduce((n, b) => n + (b.amount_naira as number), 0), count: data?.length ?? 0 };
}

export async function getBooking(id: string): Promise<Booking | null> {
  const { data } = await db.from("bookings").select("*").eq("id", id).maybeSingle();
  return (data as Booking) ?? null;
}

// Moves a booking from one of `from` to `to`; returns it only if this call made the change.
export async function setStatus(id: string, from: string[], to: string, extra: Record<string, unknown> = {}): Promise<Booking | null> {
  const { data } = await db.from("bookings").update({ status: to, ...extra }).eq("id", id).in("status", from).select("*");
  return (data?.[0] as Booking) ?? null;
}

export function cancelBooking(id: string): Promise<Booking | null> {
  return setStatus(id, ["booked", "review", "pending"], "cancelled", { cancelled_at: new Date().toISOString() });
}

export function waLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0/, "234");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

// Paystack secret key: from the function secrets or the database vault. Without it, transfers are
// confirmed by the admin with Accept / Reject.
let secretKey: string | null | undefined;
export async function paystackSecret(): Promise<string | null> {
  if (secretKey !== undefined) return secretKey;
  secretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? null;
  if (!secretKey) {
    const { data } = await db.rpc("get_app_secret", { secret_name: "paystack_secret_key" });
    secretKey = typeof data === "string" && data ? data : null;
  }
  return secretKey;
}

export async function verifyPaystack(reference: string, amountNaira: number): Promise<"paid" | "unpaid" | "unknown"> {
  const key = await paystackSecret();
  if (!key) return "unknown";
  try {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return res.status === 404 || res.status === 400 ? "unpaid" : "unknown";
    const d = (await res.json())?.data;
    return d?.status === "success" && d?.currency === "NGN" && Number(d?.amount) >= amountNaira * 100 ? "paid" : "unpaid";
  } catch {
    return "unknown";
  }
}

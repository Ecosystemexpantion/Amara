// JSON API behind the EEM26 booking page (our replacement for Calendly).
// GET               → call types with their free times, and whether "Talk now" is open
// GET  ?m=<token>   → one booking, for its private manage link
// POST book         → free calls are booked at once; paid calls hold the time while the visitor pays
// POST paid         → the visitor finished the Paystack transfer
// POST repay        → a fresh payment reference for a booking still waiting for payment
// POST cancel       → cancel with the manage token
// POST reschedule   → move a scheduled call to another free time
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage, sendWithKeyboard } from "../amara-bot/telegram.ts";
import { describe, announceConfirmed, viaStudent } from "../_shared/booking-alerts.ts";
import { sha256 } from "../_shared/web-auth.ts";
import {
  availability, nowOpen, formatNigeria, naira, verifyPaystack, paystackSecret, setStatus, expireHolds,
  PAYSTACK_PUBLIC_KEY, PAY_HOLD_MINUTES, type Booking,
} from "../_shared/booking.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_UPCOMING_PER_PHONE = 3;
const FREE_CALL_EVERY_DAYS = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function publicView(b: Booking) {
  return {
    type: b.call_type, start: b.slot_start, end: b.slot_end, name: b.name, phone: b.phone, topic: b.topic,
    status: b.status, amount: b.amount_naira, holdUntil: b.hold_until,
  };
}

function newRef(): string {
  return `EEM26CALL_${Date.now().toString(36).toUpperCase()}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

async function byToken(token: unknown): Promise<Booking | null> {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) return null;
  const { data } = await supabase.from("bookings").select("*").eq("manage_token_hash", await sha256(token)).maybeSingle();
  return (data as Booking) ?? null;
}

function cleanText(v: unknown, max: number): string {
  return String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function book(body: Record<string, unknown>): Promise<Response> {
  const name = cleanText(body.name, 80);
  const phone = cleanText(body.phone, 25);
  const email = cleanText(body.email, 120).toLowerCase() || null;
  const topic = String(body.topic ?? "").replace(/[<>]/g, "").trim().slice(0, 600) || null;
  if (name.length < 2) return json({ error: "Please enter your name." }, 400);
  if (phone.replace(/\D/g, "").length < 7) return json({ error: "Please enter your WhatsApp number with the country code, e.g. +2348012345678." }, 400);
  if (email && !EMAIL_RE.test(email)) return json({ error: "That email doesn't look right." }, 400);

  const { settings, types } = await availability();
  const t = types.find((x) => x.id === body.type);
  if (!t) return json({ error: "Please choose a type of call." }, 400);
  const paid = t.price > 0;
  if (paid && !email) return json({ error: "Please add your email — Paystack sends your payment receipt there." }, 400);

  let start: Date;
  if (t.id === "now") {
    if (!nowOpen(settings)) return json({ error: "Talk now is closed at the moment — please book a time instead." }, 409);
    start = new Date();
  } else {
    start = typeof body.start === "string" ? new Date(body.start) : new Date(NaN);
    if (isNaN(start.getTime())) return json({ error: "Please choose a time." }, 400);
    if (!t.slots.includes(start.toISOString())) return json({ error: "That time was just taken — please pick another one.", taken: true }, 409);
  }

  const digits = phone.replace(/\D/g, "");
  const { data: mine } = await supabase
    .from("bookings")
    .select("phone, call_type, status, created_at")
    .in("status", ["booked", "review", "pending"])
    .gte("created_at", new Date(Date.now() - FREE_CALL_EVERY_DAYS * 86_400_000).toISOString());
  const same = (mine ?? []).filter((b) => String(b.phone).replace(/\D/g, "") === digits);
  if (!paid && same.some((b) => b.call_type === t.id)) {
    return json({ error: "You've already had your free intro call. Book a paid call and we'll go deeper 🙌", freeUsed: true }, 409);
  }
  if (same.filter((b) => b.status !== "pending").length >= MAX_UPCOMING_PER_PHONE) {
    return json({ error: "You already have calls booked with us — use the link from your booking to change one." }, 429);
  }

  const via = typeof body.via === "string" && /^[0-9a-f-]{36}$/.test(body.via) ? body.via : null;
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      call_type: t.id,
      slot_start: start.toISOString(),
      slot_end: new Date(start.getTime() + t.minutes * 60_000).toISOString(),
      name, phone, email, topic,
      via_student_id: via && (await viaStudent(via)) ? via : null,
      manage_token_hash: await sha256(token),
      status: paid ? "pending" : "booked",
      amount_naira: t.price,
      pay_ref: paid ? newRef() : null,
      hold_until: paid ? new Date(Date.now() + PAY_HOLD_MINUTES * 60_000).toISOString() : null,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505" || error.code === "23P01") return json({ error: "Someone just booked that time — please pick another one.", taken: true }, 409);
    throw new Error(`book insert: ${error.message}`);
  }
  const b = data as Booking;
  if (!paid) await announceConfirmed(b, "📅 <b>New free intro call</b>");
  return json({ token, booking: publicView(b), pay: paid ? payInfo(b) : null });
}

function payInfo(b: Booking) {
  return { key: PAYSTACK_PUBLIC_KEY, ref: b.pay_ref, amountKobo: b.amount_naira * 100, email: b.email };
}

async function repay(body: Record<string, unknown>): Promise<Response> {
  await expireHolds();
  const b = await byToken(body.token);
  if (!b) return json({ error: "This booking link isn't valid." }, 404);
  if (b.status !== "pending") return json({ booking: publicView(b) });
  const { data } = await supabase
    .from("bookings")
    .update({ pay_ref: newRef(), hold_until: new Date(Date.now() + PAY_HOLD_MINUTES * 60_000).toISOString() })
    .eq("id", b.id)
    .eq("status", "pending")
    .select("*");
  const fresh = (data?.[0] as Booking) ?? b;
  return json({ booking: publicView(fresh), pay: payInfo(fresh) });
}

async function paidNow(body: Record<string, unknown>): Promise<Response> {
  const b = await byToken(body.token);
  if (!b) return json({ error: "This booking link isn't valid." }, 404);
  if (b.status === "booked" || b.status === "review") return json({ booking: publicView(b) });
  if (!["pending", "expired"].includes(b.status) || body.reference !== b.pay_ref) return json({ error: "That payment doesn't match this booking." }, 400);

  const check = await verifyPaystack(b.pay_ref!, b.amount_naira);
  if (check === "unpaid") return json({ error: "Paystack hasn't received this payment yet. If you've just transferred, wait a minute and tap “I've paid” again." }, 402);
  if (check === "paid") {
    const done = await setStatus(b.id, ["pending", "expired"], "booked", { paid_at: new Date().toISOString(), hold_until: null });
    if (done) await announceConfirmed(done, `💰 <b>Paid call booked — ${naira(done.amount_naira)}</b> (verified with Paystack)`);
    return json({ booking: publicView(done ?? b) });
  }
  // No Paystack secret key here: the admin confirms the transfer.
  const waiting = await setStatus(b.id, ["pending", "expired"], "review", { hold_until: null });
  if (waiting) {
    await sendWithKeyboard(
      ADMIN_CHAT_ID,
      `🧾 <b>Call payment to confirm — ${naira(waiting.amount_naira)}</b>\nCheck this reference in your Paystack dashboard, then tap Accept or Reject.\n\n${await describe(waiting)}`,
      [[{ text: "✅ Accept", callback_data: `bka:${waiting.id}` }, { text: "❌ Reject", callback_data: `bkr:${waiting.id}` }]]
    );
  }
  return json({ booking: publicView(waiting ?? b) });
}

async function cancel(body: Record<string, unknown>): Promise<Response> {
  const b = await byToken(body.token);
  if (!b) return json({ error: "This booking link isn't valid." }, 404);
  const done = await setStatus(b.id, ["booked", "review", "pending"], "cancelled", { cancelled_at: new Date().toISOString() });
  if (done && done.status !== "pending" && (b.status === "booked" || b.status === "review")) {
    await sendMessage(
      ADMIN_CHAT_ID,
      `🚫 <b>Call cancelled by the guest</b>${b.amount_naira && b.paid_at ? `\n💸 They paid ${naira(b.amount_naira)} — refund in Paystack if you agree.` : ""}\n\n${await describe(done)}`
    );
  }
  return json({ booking: publicView(done ?? b) });
}

async function reschedule(body: Record<string, unknown>): Promise<Response> {
  const b = await byToken(body.token);
  if (!b) return json({ error: "This booking link isn't valid." }, 404);
  if (b.status !== "booked" || b.call_type === "now") return json({ error: "This call can't be moved." }, 409);
  const { types } = await availability();
  const t = types.find((x) => x.id === b.call_type);
  const start = typeof body.start === "string" ? new Date(body.start) : null;
  if (!t || !start || isNaN(start.getTime()) || !t.slots.includes(start.toISOString())) {
    return json({ error: "That time was just taken — please pick another one.", taken: true }, 409);
  }
  const was = b.slot_start;
  const { data, error } = await supabase
    .from("bookings")
    .update({ slot_start: start.toISOString(), slot_end: new Date(start.getTime() + t.minutes * 60_000).toISOString(), reminded_at: null })
    .eq("id", b.id)
    .eq("status", "booked")
    .select("*");
  if (error) {
    if (error.code === "23505" || error.code === "23P01") return json({ error: "Someone just booked that time — please pick another one.", taken: true }, 409);
    throw new Error(`reschedule: ${error.message}`);
  }
  const moved = (data?.[0] as Booking) ?? b;
  await sendWithKeyboard(ADMIN_CHAT_ID, `🔁 <b>Call moved by the guest</b>\nWas: ${formatNigeria(was)}\n\n${await describe(moved)}`, [[{ text: "❌ Cancel this call", callback_data: `bkc:${moved.id}` }]]);
  return json({ booking: publicView(moved) });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const m = url.searchParams.get("m");
      if (m) {
        await expireHolds();
        const b = await byToken(m);
        return b ? json({ booking: publicView(b), pay: b.status === "pending" ? payInfo(b) : null }) : json({ error: "This booking link isn't valid." }, 404);
      }
      const { settings, types } = await availability();
      return json({
        timezone: "Africa/Lagos",
        autoConfirm: !!(await paystackSecret()),
        free: { days: settings.free_days, from: settings.free_start_hour, to: settings.free_end_hour },
        types: types.map((t) => ({ id: t.id, name: t.name, minutes: t.minutes, price: t.price, blurb: t.blurb, available: t.available, slots: t.slots })),
      });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "book") return await book(body);
      if (body.action === "paid") return await paidNow(body);
      if (body.action === "repay") return await repay(body);
      if (body.action === "cancel") return await cancel(body);
      if (body.action === "reschedule") return await reschedule(body);
      return json({ error: "Unknown action" }, 400);
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("booking error:", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});

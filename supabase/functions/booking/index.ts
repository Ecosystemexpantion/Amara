// JSON API behind the EEM26 booking page (our replacement for Calendly).
// GET               → open slots for the next weeks
// GET  ?m=<token>   → one booking, for its private manage link
// POST book         → book a slot (the database guarantees one booking per slot)
// POST cancel       → cancel with the manage token
// POST reschedule   → move to another free slot with the manage token
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage, sendWithKeyboard, escapeHtml } from "../amara-bot/telegram.ts";
import { sha256 } from "../_shared/web-auth.ts";
import { freeSlots, formatNigeria, waLink, type Booking } from "../_shared/booking.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_UPCOMING_PER_PHONE = 2;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function publicView(b: Booking) {
  return { start: b.slot_start, end: b.slot_end, name: b.name, phone: b.phone, topic: b.topic, status: b.status };
}

async function byToken(token: unknown): Promise<Booking | null> {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) return null;
  const { data } = await supabase.from("bookings").select("*").eq("manage_token_hash", await sha256(token)).maybeSingle();
  return (data as Booking) ?? null;
}

async function viaStudent(id: string | null): Promise<{ id: string; full_name: string | null; telegram_chat_id: string } | null> {
  if (!id) return null;
  const { data } = await supabase.from("amara_students").select("id, full_name, telegram_chat_id").eq("id", id).maybeSingle();
  return data ?? null;
}

async function alertAdmin(b: Booking, headline: string, withButtons: boolean): Promise<void> {
  const student = await viaStudent(b.via_student_id);
  const text =
    `${headline}\n\n` +
    `🗓 <b>${formatNigeria(b.slot_start)}</b> (Nigeria time)\n` +
    `👤 ${escapeHtml(b.name)}\n` +
    `📞 <a href="${waLink(b.phone)}">${escapeHtml(b.phone)}</a> (WhatsApp)` +
    (b.email ? `\n📧 ${escapeHtml(b.email)}` : "") +
    (b.topic ? `\n💬 "${escapeHtml(b.topic.slice(0, 500))}"` : "") +
    (student ? `\n🤖 Came from ${escapeHtml(student.full_name ?? "a student")}'s assistant (🆔 <code>${student.telegram_chat_id}</code>)` : "");
  if (withButtons) await sendWithKeyboard(ADMIN_CHAT_ID, text, [[{ text: "❌ Cancel this call", callback_data: `bkc:${b.id}` }]]);
  else await sendMessage(ADMIN_CHAT_ID, text);
}

function cleanText(v: unknown, max: number): string {
  return String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function book(body: Record<string, unknown>): Promise<Response> {
  const name = cleanText(body.name, 80);
  const phone = cleanText(body.phone, 25);
  const email = cleanText(body.email, 120).toLowerCase() || null;
  const topic = String(body.topic ?? "").replace(/[<>]/g, "").trim().slice(0, 600) || null;
  const start = typeof body.start === "string" ? new Date(body.start) : null;
  if (name.length < 2) return json({ error: "Please enter your name." }, 400);
  if (phone.replace(/\D/g, "").length < 7) return json({ error: "Please enter your WhatsApp number with the country code, e.g. +2348012345678." }, 400);
  if (email && !EMAIL_RE.test(email)) return json({ error: "That email doesn't look right — fix it or leave it empty." }, 400);
  if (!start || isNaN(start.getTime())) return json({ error: "Please choose a time." }, 400);

  const { settings, slots } = await freeSlots();
  const startIso = start.toISOString();
  if (!slots.includes(startIso)) return json({ error: "That time was just taken or isn't available anymore — please pick another one.", taken: true }, 409);

  const digits = phone.replace(/\D/g, "");
  const { data: mine } = await supabase.from("bookings").select("id, phone").eq("status", "booked").gte("slot_start", new Date().toISOString());
  if ((mine ?? []).filter((b) => String(b.phone).replace(/\D/g, "") === digits).length >= MAX_UPCOMING_PER_PHONE) {
    return json({ error: "You already have calls booked with us — use the link from your booking to change one." }, 429);
  }

  const via = typeof body.via === "string" && /^[0-9a-f-]{36}$/.test(body.via) ? body.via : null;
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      slot_start: startIso,
      slot_end: new Date(start.getTime() + settings.slot_minutes * 60_000).toISOString(),
      name,
      phone,
      email,
      topic,
      via_student_id: via && (await viaStudent(via)) ? via : null,
      manage_token_hash: await sha256(token),
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return json({ error: "Someone just booked that exact time — please pick another one.", taken: true }, 409);
    throw new Error(`book insert: ${error.message}`);
  }
  const b = data as Booking;
  await alertAdmin(b, "📅 <b>New call booked</b>", true);

  const student = await viaStudent(b.via_student_id);
  if (student) {
    await sendMessage(student.telegram_chat_id, `📅 <b>A lead from your assistant booked a call with the EEM26 team!</b>\n\n👤 ${escapeHtml(b.name)}\n🗓 ${formatNigeria(b.slot_start)} (Nigeria time)\n\nThe team will take it from here 🙌`);
  }
  return json({ token, booking: publicView(b) });
}

async function cancel(body: Record<string, unknown>): Promise<Response> {
  const b = await byToken(body.token);
  if (!b) return json({ error: "This booking link isn't valid." }, 404);
  if (b.status !== "booked") return json({ booking: publicView(b) });
  const { data } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", b.id)
    .eq("status", "booked")
    .select("*");
  const done = (data?.[0] as Booking) ?? b;
  await alertAdmin(done, "🚫 <b>Call cancelled by the guest</b>", false);
  return json({ booking: publicView(done) });
}

async function reschedule(body: Record<string, unknown>): Promise<Response> {
  const b = await byToken(body.token);
  if (!b) return json({ error: "This booking link isn't valid." }, 404);
  if (b.status !== "booked") return json({ error: "This call was cancelled — book a new time instead." }, 409);
  const start = typeof body.start === "string" ? new Date(body.start) : null;
  if (!start || isNaN(start.getTime())) return json({ error: "Please choose a new time." }, 400);
  const { settings, slots } = await freeSlots();
  if (!slots.includes(start.toISOString())) return json({ error: "That time was just taken — please pick another one.", taken: true }, 409);
  const was = b.slot_start;
  const { data, error } = await supabase
    .from("bookings")
    .update({ slot_start: start.toISOString(), slot_end: new Date(start.getTime() + settings.slot_minutes * 60_000).toISOString(), reminded_at: null })
    .eq("id", b.id)
    .eq("status", "booked")
    .select("*");
  if (error) {
    if (error.code === "23505") return json({ error: "Someone just booked that exact time — please pick another one.", taken: true }, 409);
    throw new Error(`reschedule: ${error.message}`);
  }
  const moved = (data?.[0] as Booking) ?? b;
  await alertAdmin(moved, `🔁 <b>Call moved by the guest</b>\nWas: ${formatNigeria(was)}`, true);
  return json({ booking: publicView(moved) });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const m = url.searchParams.get("m");
      if (m) {
        const b = await byToken(m);
        return b ? json({ booking: publicView(b) }) : json({ error: "This booking link isn't valid." }, 404);
      }
      const { settings, slots } = await freeSlots();
      return json({ minutes: settings.slot_minutes, timezone: "Africa/Lagos", slots });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "book") return await book(body);
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

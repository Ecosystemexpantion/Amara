// Telegram alerts about bookings, for the admin and for the student whose assistant sent the lead.
// Shared by the booking API and Amara's admin buttons.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage, sendWithKeyboard, escapeHtml } from "../amara-bot/telegram.ts";
import { callType, getSettings, formatNigeria, naira, waLink, type Booking } from "./booking.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";

export async function viaStudent(id: string | null): Promise<{ id: string; full_name: string | null; telegram_chat_id: string } | null> {
  if (!id) return null;
  const { data } = await supabase.from("amara_students").select("id, full_name, telegram_chat_id").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function describe(b: Booking): Promise<string> {
  const s = await getSettings();
  const t = callType(s, b.call_type);
  const student = await viaStudent(b.via_student_id);
  return (
    `📞 <b>${escapeHtml(t?.name ?? b.call_type)}</b>${b.amount_naira ? ` · ${naira(b.amount_naira)}` : " · free"}\n` +
    (b.call_type === "now" ? `⏱ Wants a call <b>within 30 minutes</b>\n` : `🗓 <b>${formatNigeria(b.slot_start)}</b> (Nigeria time)\n`) +
    `👤 ${escapeHtml(b.name)}\n` +
    `💬 <a href="${waLink(b.phone)}">${escapeHtml(b.phone)}</a> (WhatsApp)` +
    (b.email ? `\n📧 ${escapeHtml(b.email)}` : "") +
    (b.topic ? `\n📝 "${escapeHtml(b.topic.slice(0, 500))}"` : "") +
    (b.pay_ref && b.amount_naira ? `\n🧾 Paystack ref: <code>${b.pay_ref}</code>` : "") +
    (student ? `\n🤖 Came from ${escapeHtml(student.full_name ?? "a student")}'s assistant (🆔 <code>${student.telegram_chat_id}</code>)` : "")
  );
}

// Tells the admin a call is confirmed (free, or paid and verified / accepted).
export async function announceConfirmed(b: Booking, headline: string): Promise<void> {
  if (b.call_type === "now") {
    await sendWithKeyboard(ADMIN_CHAT_ID, `🚨 <b>CALL NOW — paid priority call</b>\n\n${await describe(b)}\n\nTap their number to call on WhatsApp, then tap ✅ Called.`, [
      [{ text: "✅ Called", callback_data: `bkd:${b.id}` }],
    ]);
  } else {
    await sendWithKeyboard(ADMIN_CHAT_ID, `${headline}\n\n${await describe(b)}`, [[{ text: "❌ Cancel this call", callback_data: `bkc:${b.id}` }]]);
  }
  const student = await viaStudent(b.via_student_id);
  if (student) {
    await sendMessage(student.telegram_chat_id, `📅 <b>A lead from your assistant booked a call with the EEM26 team!</b>\n\n👤 ${escapeHtml(b.name)}\n${b.call_type === "now" ? "⏱ Priority call — right now" : `🗓 ${formatNigeria(b.slot_start)} (Nigeria time)`}\n\nThe team will take it from here 🙌`);
  }
}


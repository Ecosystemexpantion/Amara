import { sendMessage, escapeHtml } from "./telegram.ts";
import { GATE_STEP, SRE_STEP } from "./day1-content.ts";

const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";

export async function notifyAdmin(message: string): Promise<void> {
  try {
    await sendMessage(ADMIN_CHAT_ID, message);
  } catch (e) {
    console.error("notifyAdmin error:", e);
  }
}

// The 🆔 marker is what admin swipe-replies are parsed from — keep it in every student card.
export function studentLabel(fullName: string | null, chatId: string | number): string {
  return `👤 <b>${escapeHtml(fullName ?? "Unknown")}</b>\n🆔 <code>${chatId}</code>`;
}

export function describePosition(s: { current_day: number; current_step: number; status: string }): string {
  if (s.status === "COMPLETED") return "Graduate 🎓";
  if (s.current_day === 0) return "Onboarding";
  if (s.current_day === 1 && s.current_step === GATE_STEP) return "Day 1 done — Day 2 locked (no Tech Stack yet)";
  if (s.current_day === 1 && s.current_step === SRE_STEP) return "Day 1 — setting up SRE bot";
  if (s.current_step === 0) return `Day ${s.current_day} done — waiting for Day ${s.current_day + 1}`;
  return `Day ${s.current_day}, Step ${s.current_step}`;
}

// Sends the Telegram "it's done" messages for builds, either straight away or once the
// student's web animation has finished (see holdAnnouncement in _shared/runs.ts).
import { sendMessage, sendHeldMessages } from "./telegram.ts";
import { getStudentById } from "./db.ts";
import { announceSreLive } from "./day1.ts";
import { claimAnnouncement, type Announcement } from "../_shared/runs.ts";
import type { Student } from "./types.ts";

export async function deliverRunAnnouncement(runId: string): Promise<boolean> {
  const claim = await claimAnnouncement(runId);
  if (!claim) return false;
  const student = await getStudentById(claim.studentId);
  if (!student) return false;
  await sendAnnouncement(student, claim.announce);
  return true;
}

export async function sendAnnouncement(student: Student, a: Announcement): Promise<void> {
  if (a.type === "messages") {
    await sendHeldMessages(student.telegram_chat_id, a.items);
    return;
  }
  if (a.type === "sre_live") {
    await announceSreLive(student, student.telegram_chat_id, a.botUsername, a.day, a.chatUrl);
    return;
  }
  const firstName = student.full_name ? student.full_name.split(" ")[0] : "there";
  const links = `📌 <b>Normal page:</b>\n${a.normalUrl}\n\n⭐ <b>Premium page:</b>\n${a.premiumUrl}`;
  await sendMessage(
    student.telegram_chat_id,
    a.isRepair
      ? `✅ <b>Your sales pages are fixed and updated, ${firstName}!</b>\n\n${links}\n\n<i>Give GitHub a minute or two to publish the changes.</i>`
      : `🎉 <b>Your sales pages are LIVE, ${firstName}!</b>\n\n${links}\n\n<i>GitHub can take a minute or two to show them.</i>\n\n✅ <b>Day 2 is COMPLETE!</b> Day 3 unlocks tomorrow at 8AM Nigeria time.\n\nUntil then I'll stay quiet so you can rest 🤫 — no need to message me. I'll message you the moment it opens 🔔`
  );
}

// Admin commands — only reachable when the message comes from ADMIN_CHAT_ID.
//
// Usage:
//   Send any message containing a payhip link → Amara asks to confirm → tap Yes
//   list → Show all active students

import { sendMessage, sendWithKeyboard, answerCallbackQuery } from "./telegram.ts";
import { modifyTemplateForStudent } from "./html-modifier.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET       = "student-pages";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Entry point (text messages) ───────────────────────────────────────────────

export async function handleAdminCommand(chatId: number, text: string): Promise<void> {
  const t = text.trim();

  // list
  if (/^list\b/i.test(t)) {
    await listStudents(chatId);
    return;
  }

  // Detect a payhip link anywhere in the message
  const payhipMatch = t.match(/https?:\/\/payhip\.com\/\S+/i);
  if (payhipMatch) {
    const payhipLink = payhipMatch[0].replace(/[.,;!?]+$/, ""); // strip trailing punctuation
    await sendWithKeyboard(
      chatId,
      `Create pages for this Payhip link?\n\n<code>${payhipLink}</code>`,
      [[
        { text: "✅ Yes, create pages", callback_data: `setup:${payhipLink}` },
        { text: "❌ Cancel",            callback_data: "setup_cancel" },
      ]]
    );
    return;
  }

  await sendHelp(chatId);
}

// ── Entry point (button taps / callback queries) ──────────────────────────────

export async function handleAdminCallback(
  chatId: number,
  callbackQueryId: string,
  data: string
): Promise<void> {
  await answerCallbackQuery(callbackQueryId);

  if (data === "setup_cancel") {
    await sendMessage(chatId, "Cancelled.");
    return;
  }

  if (data.startsWith("setup:")) {
    const payhipLink = data.slice("setup:".length);
    await runSetup(chatId, payhipLink);
    return;
  }
}

// ── Help ──────────────────────────────────────────────────────────────────────

async function sendHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Admin commands:</b>\n\n` +
    `<b>Create pages:</b> Just send a message with a Payhip link — I'll ask to confirm.\n\n` +
    `<code>list</code> → Show all active students and their current day/step.`
  );
}

// ── List students ─────────────────────────────────────────────────────────────

async function listStudents(chatId: number): Promise<void> {
  const { data } = await supabase
    .from("amara_students")
    .select("full_name, current_day, current_step, status, sales_page_link")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!data || data.length === 0) {
    await sendMessage(chatId, "No active students yet.");
    return;
  }

  const lines = (data as Record<string, string | number>[]).map((s) =>
    `• <b>${s.full_name ?? "unnamed"}</b> — Day ${s.current_day}, Step ${s.current_step}` +
    (s.sales_page_link ? ` ✅` : ` ❌`)
  );

  await sendMessage(chatId, `<b>Active students (${data.length}):</b>\n\n${lines.join("\n")}`);
}

// ── Setup: host pages on Supabase Storage ─────────────────────────────────────

async function runSetup(adminChatId: number, payhipLink: string): Promise<void> {
  await sendMessage(adminChatId, `Creating pages... ⏳`);

  // Load + customise HTML templates
  let normalHtml: string;
  let premiumHtml: string;
  try {
    const normalRaw  = await Deno.readTextFile(new URL("./index_normal.html",  import.meta.url));
    const premiumRaw = await Deno.readTextFile(new URL("./index_premium.html", import.meta.url));
    normalHtml  = modifyTemplateForStudent(normalRaw,  payhipLink);
    premiumHtml = modifyTemplateForStudent(premiumRaw, payhipLink);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Failed to load templates: ${String(e).slice(0, 150)}`);
    return;
  }

  // Ensure public bucket exists
  await ensureBucket();

  // Unique filenames from timestamp
  const suffix      = Date.now().toString(36).slice(-8);
  const normalPath  = `${suffix}-normal.html`;
  const premiumPath = `${suffix}-premium.html`;

  try {
    await uploadHtml(normalPath,  normalHtml);
    await uploadHtml(premiumPath, premiumHtml);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Upload failed: ${String(e).slice(0, 200)}`);
    return;
  }

  const normalUrl  = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${normalPath}`;
  const premiumUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${premiumPath}`;

  await sendMessage(
    adminChatId,
    `✅ <b>Done! Pages are live:</b>\n\n` +
    `📌 Normal:\n${normalUrl}\n\n` +
    `⭐ Premium:\n${premiumUrl}`
  );
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function ensureBucket(): Promise<void> {
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
}

async function uploadHtml(path: string, html: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "text/html",
      "x-upsert": "true",
    },
    body: html,
  });
  if (!res.ok) {
    throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);
  }
  await res.body?.cancel();
}

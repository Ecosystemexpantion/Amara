import type { DownloadedFile } from "./types.ts";
import type { HeldMessage } from "../_shared/runs.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TG_FILE_BASE = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

// While a chat is "held" (a web upload the student is watching), messages to that chat are
// collected instead of sent, and released when the web animation ends.
const held = new Map<string, HeldMessage[]>();

export function startHolding(chatId: number | string): void {
  held.set(String(chatId), []);
}

export function stopHolding(chatId: number | string): HeldMessage[] {
  const items = held.get(String(chatId)) ?? [];
  held.delete(String(chatId));
  return items;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

export async function sendHeldMessages(chatId: number | string, items: HeldMessage[]): Promise<void> {
  for (const m of items) {
    if (m.kind === "text") await sendMessage(chatId, m.text, m.parseMode);
    else await sendDocument(chatId, m.filename, Uint8Array.from(atob(m.b64), (c) => c.charCodeAt(0)), m.caption);
    await new Promise((r) => setTimeout(r, 700));
  }
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<boolean> {
  const hold = held.get(String(chatId));
  if (hold) {
    hold.push({ kind: "text", text, parseMode });
    return true;
  }
  try {
    const res = await fetch(`${TG_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("sendMessage error:", e);
    return false;
  }
}

export async function copyMessage(
  toChatId: number | string,
  fromChatId: number | string,
  messageId: number
): Promise<void> {
  try {
    await fetch(`${TG_BASE}/copyMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId }),
    });
  } catch (e) {
    console.error("copyMessage error:", e);
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendChatAction(
  chatId: number | string,
  action: string
): Promise<void> {
  if (held.has(String(chatId))) return;
  try {
    await fetch(`${TG_BASE}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (_) { /* ignore */ }
}

export async function typeMessage(
  chatId: number | string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<void> {
  if (held.has(String(chatId))) {
    await sendMessage(chatId, text, parseMode);
    return;
  }
  const plainLength = text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().length;
  const delayMs = Math.min(Math.max(plainLength * 28, 600), 4200);
  await sendChatAction(chatId, "typing");
  await new Promise((r) => setTimeout(r, delayMs));
  await sendMessage(chatId, text, parseMode);
}

export async function sendDocument(
  chatId: number | string,
  filename: string,
  content: Uint8Array,
  caption?: string
): Promise<void> {
  const hold = held.get(String(chatId));
  if (hold) {
    hold.push({ kind: "doc", filename, b64: toBase64(content), caption });
    return;
  }
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    const blob = new Blob([content], { type: "application/octet-stream" });
    form.append("document", blob, filename);
    if (caption) form.append("caption", caption);
    await fetch(`${TG_BASE}/sendDocument`, { method: "POST", body: form });
  } catch (e) {
    console.error("sendDocument error:", e);
  }
}

export async function sendPhoto(
  chatId: number | string,
  photoBytes: Uint8Array,
  caption?: string
): Promise<void> {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    const blob = new Blob([photoBytes], { type: "image/jpeg" });
    form.append("photo", blob, "photo.jpg");
    if (caption) form.append("caption", caption);
    await fetch(`${TG_BASE}/sendPhoto`, { method: "POST", body: form });
  } catch (e) {
    console.error("sendPhoto error:", e);
  }
}

export async function sendWithKeyboard(
  chatId: number | string,
  text: string,
  buttons: { text: string; callback_data: string }[][]
): Promise<void> {
  try {
    await fetch(`${TG_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons },
      }),
    });
  } catch (e) {
    console.error("sendWithKeyboard error:", e);
  }
}

export async function removeButtons(chatId: number | string, messageId: number): Promise<void> {
  try {
    await fetch(`${TG_BASE}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    });
  } catch (_) { /* ignore */ }
}

export async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  try {
    await fetch(`${TG_BASE}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch (_) { /* ignore */ }
}

export async function getFilePath(fileId: string): Promise<string> {
  const res = await fetch(`${TG_BASE}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`getFile failed for ${fileId}: ${JSON.stringify(data)}`);
  }
  return data.result.file_path as string;
}

export async function downloadFile(fileId: string): Promise<DownloadedFile> {
  const filePath = await getFilePath(fileId);
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    pdf: "application/pdf",
  };
  const mimeType = mimeMap[ext] ?? "application/octet-stream";
  const res = await fetch(`${TG_FILE_BASE}/${filePath}`);
  if (!res.ok) throw new Error(`downloadFile HTTP ${res.status} for ${filePath}`);
  const buffer = await res.arrayBuffer();
  return { bytes: new Uint8Array(buffer), mimeType };
}

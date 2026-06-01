import type { DownloadedFile } from "./types.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TG_FILE_BASE = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

export async function sendMessage(
  chatId: number | string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<void> {
  try {
    await fetch(`${TG_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("sendMessage error:", e);
  }
}

export async function sendChatAction(
  chatId: number | string,
  action: string
): Promise<void> {
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

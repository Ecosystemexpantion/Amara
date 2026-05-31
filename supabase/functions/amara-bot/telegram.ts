import type { DownloadedFile } from "./types.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TG_FILE_BASE = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

// Returns true if the student's message signals they want voice OR are confused
function shouldUseVoice(studentText: string | null, screenshotAttempts = 0): boolean {
  if (screenshotAttempts >= 2) return true; // stuck after multiple failed screenshots
  if (!studentText) return false;
  const t = studentText.toLowerCase();
  return (
    // explicit voice request
    /\b(voice\s*note|send\s*(me\s*)?voice|vn\b|audio|speak|say\s*it)\b/.test(t) ||
    // confusion signals
    /\b(don'?t?\s*understand|not\s*clear|confus(ed)?|what\s*do\s*you\s*mean|help\s*me|i('?m|\s+am)\s*(lost|confused)|no\s*understand|explain\s*(again|more|better))\b/.test(t) ||
    // three or more question marks = frustrated/confused
    (studentText.match(/\?/g) ?? []).length >= 3
  );
}

// Smart reply: sends a voice note when student is confused or requests one,
// otherwise sends a normal text message. Falls back to text on any TTS error.
export async function sendAmaraReply(
  chatId: number | string,
  amaraText: string,
  studentText: string | null = null,
  screenshotAttempts = 0
): Promise<void> {
  if (shouldUseVoice(studentText, screenshotAttempts)) {
    await sendVoiceNote(chatId, amaraText);
  } else {
    await sendMessage(chatId, amaraText);
  }
}

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

// Send a voice note via Fish Audio TTS.
// Fish Audio requires msgpack encoding (not JSON) — that's why it failed before.
// Falls back to plain sendMessage if key is missing or on any error.
export async function sendVoiceNote(chatId: number | string, text: string): Promise<void> {
  const FISHAUDIO_API_KEY = Deno.env.get("FISHAUDIO_API_KEY");
  const FISHAUDIO_VOICE_ID = Deno.env.get("FISHAUDIO_VOICE_ID") ?? "";

  if (!FISHAUDIO_API_KEY) {
    await sendMessage(chatId, text);
    return;
  }

  // Strip HTML tags and decode common entities so TTS reads clean text
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) {
    await sendMessage(chatId, text);
    return;
  }

  try {
    await sendChatAction(chatId, "record_voice");

    const payload: Record<string, unknown> = { text: plain, format: "mp3" };
    if (FISHAUDIO_VOICE_ID) payload.reference_id = FISHAUDIO_VOICE_ID;

    const res = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FISHAUDIO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Fish Audio TTS ${res.status}: ${await res.text()}`);
      await sendMessage(chatId, text);
      return;
    }

    const audioBytes = new Uint8Array(await res.arrayBuffer());

    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("voice", new Blob([audioBytes], { type: "audio/mpeg" }), "amara.mp3");

    const tgRes = await fetch(`${TG_BASE}/sendVoice`, { method: "POST", body: form });
    if (!tgRes.ok) {
      console.error(`Telegram sendVoice failed: ${await tgRes.text()}`);
      await sendMessage(chatId, text);
    }
  } catch (e) {
    console.error("sendVoiceNote error:", e);
    await sendMessage(chatId, text);
  }
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

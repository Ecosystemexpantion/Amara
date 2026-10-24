// Students who signed up on the web have no Telegram chat: their telegram_chat_id is a "w…"
// placeholder and everything Amara would send them on Telegram lands in web_inbox instead.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export function isWebChat(chatId: string | number | null | undefined): boolean {
  return /^w\d{6,}$/.test(String(chatId ?? ""));
}

export function newWebChatId(): string {
  const digits = crypto.getRandomValues(new Uint32Array(3)).reduce((s, n) => s + String(n % 10000).padStart(4, "0"), "");
  return `w${digits}`;
}

// Web chat visitors talking to a student's web SRE.
export function isWebVisitor(chatId: string | number | null | undefined): boolean {
  return String(chatId ?? "").startsWith("web-");
}

export async function pushInbox(
  chatId: string | number,
  item: { kind: "text" | "me"; text: string } | { kind: "doc"; filename: string; b64: string; caption?: string }
): Promise<boolean> {
  const row: Record<string, unknown> = item.kind !== "doc"
    ? { chat_id: String(chatId), kind: item.kind, text: item.text }
    : { chat_id: String(chatId), kind: "doc", text: item.caption ?? null, filename: item.filename, data: item.b64 };
  const { error } = await db.from("web_inbox").insert(row);
  if (error) console.error("pushInbox failed:", error.message);
  return !error;
}

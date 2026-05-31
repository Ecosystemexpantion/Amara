import { sendMessage } from "./telegram.ts";

const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";

export async function notifyAdmin(message: string): Promise<void> {
  try {
    await sendMessage(ADMIN_CHAT_ID, message);
  } catch (e) {
    console.error("notifyAdmin error:", e);
  }
}

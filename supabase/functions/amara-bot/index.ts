import { getStudentByChatId, createStudent, touchActivity } from "./db.ts";
import { routeMessage } from "./state-machine.ts";
import { handleAdminCommand } from "./admin-commands.ts";
import type { TelegramUpdate } from "./types.ts";

const ADMIN_CHAT_ID_STR = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";

// Amara Bot — EEM26 4-Day Student Coaching Bot
// Supabase Edge Function (Deno/TypeScript)
// AI: Google Gemini (gemini-2.5-flash-lite)

Deno.serve(async (req: Request): Promise<Response> => {
  // Always respond with 200 to Telegram to prevent retries
  if (req.method !== "POST") {
    return new Response("Amara Bot is running ✅", { status: 200 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  // Only handle regular messages (not edited messages, callback queries, etc.)
  const msg = update?.message;
  if (!msg) return new Response("OK", { status: 200 });

  const chatId = msg?.chat?.id;
  if (!chatId) return new Response("OK", { status: 200 });

  // Process the message asynchronously so we return 200 to Telegram within 5s.
  // Gemini API + file downloads can take 3-10s which exceeds Telegram's webhook timeout.
  const processingPromise = (async () => {
    try {
      // Admin commands — handled before any student lookup
      if (String(chatId) === ADMIN_CHAT_ID_STR) {
        const text = msg.text?.trim() ?? "";
        await handleAdminCommand(chatId, text);
        return;
      }

      let student = await getStudentByChatId(String(chatId));
      if (!student) {
        student = await createStudent(String(chatId));
      }

      if (student.status === "INACTIVE") return;

      // Track activity for silence-nudge detection (fire-and-forget)
      touchActivity(student.id).catch(() => {});

      await routeMessage(msg, student, chatId);
    } catch (e) {
      console.error("Top-level processing error:", e);
    }
  })();

  // Use EdgeRuntime.waitUntil if available (Supabase Edge Runtime)
  // This lets the function keep running after the HTTP response is sent
  if (typeof EdgeRuntime !== "undefined") {
    (EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(processingPromise);
  } else {
    // Local dev: await inline
    await processingPromise;
  }

  return new Response("OK", { status: 200 });
});

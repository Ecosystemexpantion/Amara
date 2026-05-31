import { createClient } from "npm:@supabase/supabase-js@2";

// Amara Day Unlock — Cron Job Function
// Runs every 5 minutes via Supabase cron schedule.
// Finds students who have completed a day and are due for their next day unlock
// (at 8AM Nigeria time = 07:00 UTC), sends the unlock message, and advances their state.

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

const DAY_UNLOCK_MESSAGES: Record<number, string> = {
  2: `☀️ <b>Good morning! Day 2 is UNLOCKED!</b>

Today we're building your <b>Sales Page</b> — this is your online shop. When people click your link, this is where they land, read about the product, and BUY.

After today you'll have a live link you can share anywhere to make sales. Let's build it! 💪

Say <b>"ready"</b> and we'll start! 🚀`,

  3: `🔥 <b>Good morning! Day 3 is LIVE!</b>

Today you become a tech person! 😄 We're building YOUR own Smart Reply Engine — an AI bot that handles your customer conversations and closes sales for you automatically, 24/7.

This is the most exciting day of the program. Say <b>"ready"</b> and let's go! 🤖`,

  4: `🏆 <b>Good morning! Day 4 — YOUR FINAL DAY!</b>

Today we go LIVE! We set everything up, test your bot, and at the end — you get your official <b>Certificate of Completion! 🎓</b>

Today is your finish line. Say <b>"ready"</b> and let's complete this! 💪`,
};

async function sendTelegram(chatId: string, text: string): Promise<void> {
  try {
    await fetch(`${TG_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error(`sendTelegram error for ${chatId}:`, e);
  }
}

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const now = new Date().toISOString();

    // Find all students who:
    // 1. Are ACTIVE
    // 2. Have current_step = 0 (sentinel: day complete, waiting for unlock)
    // 3. Have next_day_unlocks_at <= now
    // 4. Are on day 1, 2, or 3 (so they can advance to 2, 3, or 4)
    const { data: students, error } = await supabase
      .from("amara_students")
      .select("*")
      .eq("status", "ACTIVE")
      .eq("current_step", 0)
      .lte("next_day_unlocks_at", now)
      .gte("current_day", 1)
      .lte("current_day", 3)
      .not("next_day_unlocks_at", "is", null);

    if (error) {
      console.error("Query error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    if (!students || students.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No students due for unlock" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${students.length} students due for day unlock`);
    let processed = 0;
    const errors: string[] = [];

    for (const student of students) {
      try {
        const nextDay = student.current_day + 1;

        // Optimistic lock: only update if still in step=0 state
        // This prevents double-unlock if cron invocations overlap
        const { error: updateError, count } = await supabase
          .from("amara_students")
          .update({
            current_day: nextDay,
            current_step: 1,
            next_day_unlocks_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", student.id)
          .eq("current_step", 0) // Optimistic lock
          .eq("current_day", student.current_day); // Extra guard

        if (updateError) {
          console.error(`Update error for student ${student.id}:`, updateError);
          errors.push(`${student.id}: ${updateError.message}`);
          continue;
        }

        // If count is 0, another invocation already updated this student — skip
        if (count === 0) {
          console.log(`Student ${student.id} already updated by another invocation, skipping`);
          continue;
        }

        // Send the day unlock message
        const message = DAY_UNLOCK_MESSAGES[nextDay];
        if (message) {
          await sendTelegram(student.telegram_chat_id, message);
        }

        console.log(`Unlocked Day ${nextDay} for student ${student.id} (${student.full_name})`);
        processed++;
      } catch (err) {
        console.error(`Error processing student ${student.id}:`, err);
        errors.push(`${student.id}: ${String(err)}`);
      }
    }

    const result = {
      processed,
      total: students.length,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: now,
    };

    console.log("Day unlock result:", JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Cron job fatal error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

// Amara Day Unlock — Cron Job Function
// Runs every 5 minutes via Supabase cron schedule.
// Handles three proactive messaging flows:
// 1. Morning day-unlock at 8AM Nigeria time (07:00 UTC)
// 2. Evening check-in at 6PM Nigeria time (17:00 UTC)
// 3. Silence nudge when a student hasn't messaged in 20+ hours

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_BASE   = `https://api.telegram.org/bot${BOT_TOKEN}`;

const TECH_STACK_URL = "https://ecosystemexpantion.github.io/Tech_stack/";

// Day 2 Step 1 intro — kept identical to amara-bot/day2.ts handleTechStackVerification
// so a proactively-rescued student sees the same flow as one who messages in.
const DAY2_TECH_STACK_INTRO = `<b>🚀 Day 2: Your Live Sales Pages!</b>

Today I'm building your <b>TWO live sales pages</b> — but I need your <b>Tech Stack 📦</b> to do it. Here's what's inside that we need for today:

1️⃣ <b>Landing page code</b> — your ready-made sales page template
2️⃣ <b>The hot-selling product</b> — currently making students <b>₦51M+</b> 🔥
3️⃣ <b>Premium page template</b> — your high-ticket version
4️⃣ <b>Product images & graphics</b> — professional visuals for your pages
5️⃣ <b>Sales copy & descriptions</b> — proven words that convert visitors to buyers

All of these are inside the Tech Stack — I can't build without them!`;

const DAY2_TECH_STACK_ASK = `Have you downloaded the Tech Stack yet?

👉 <a href="${TECH_STACK_URL}">Download your Tech Stack here</a>

Once you've downloaded it, send me a <b>screenshot of your proof of payment</b> (receipt or confirmation email) so we can continue immediately! 💰

Our target is <b>₦500k in a week</b> — let's go! 🔥`;

// ── Day-unlock messages (sent at 8AM Nigeria) ──────────────────────────────────

const DAY_UNLOCK_MESSAGES: Record<number, string> = {
  2: `☀️ <b>Good morning! Day 2 is UNLOCKED!</b>

Today I'm building your <b>two live sales pages</b> automatically — you just need to connect your GitHub account once (I'll handle the rest!). After today you'll have two live links to share anywhere and make sales 💪

Say <b>"ready"</b> and let's go! 🚀`,

  3: `🔥 <b>Good morning! Day 3 is LIVE!</b>

Today you get your own AI sales bot! 🤖 Just create a bot with @BotFather on Telegram and give me the token — I'll set everything else up automatically for you (no terminal, no coding needed!).

Say <b>"ready"</b> and let's go! 💪`,

  4: `🏆 <b>Good morning! Day 4 — YOUR FINAL DAY!</b>

Today we test your bot is live, confirm everything is working, and you'll receive your official <b>Certificate of Completion 🎓</b>

⚠️ <b>IMPORTANT — Final Stage Setup:</b>
Coach Victor holds a <b>live session every Saturday at 8:30 PM Nigeria time</b> for your final stage setup. You need to attend!

👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group now</a> so you don't miss it — miss it and you wait another full week!

This is your finish line. Say <b>"ready"</b> and let's complete this! 💪`,
};

// ── Evening check-in messages (sent at 6PM Nigeria = 17:00 UTC) ───────────────

const EVENING_MESSAGES: Record<number, string> = {
  1: `👋 <b>Evening check-in!</b>

How's your Day 1 going? Just checking in — if you haven't finished yet, now is a great time to continue. I'm right here ready to guide you through your Selar and Payhip setup! 💪

Send a message anytime and we'll pick up exactly where you left off 😊`,

  2: `🌙 <b>Evening check-in!</b>

How did the GitHub connection go today? Once you tap the link and authorize, I set up BOTH sales pages automatically — no more manual steps! 🚀

If you haven't done it yet, send me a message and I'll send you the link again 👆`,

  3: `🌙 <b>Evening check-in!</b>

Day 3 going well? Just a reminder — all you need is your BotFather token and I'll handle the rest 🤖 Your bot will be live in seconds once you paste it!

Tap here to continue whenever you're ready 😊`,

  4: `✨ <b>You're SO close!</b>

Day 4 is your final day — just test your bot and send me your signature for your certificate! 🎓

Don't stop now — you're literally one step from the finish line! 💪`,
};

const EVENING_DEFAULT = `👋 <b>Evening check-in!</b>

Just checking in — I'm here whenever you're ready to continue! Send me a message and we'll pick up exactly where you left off 😊`;

// ── Silence nudge messages ─────────────────────────────────────────────────────

const NUDGE_MESSAGES: Record<number, string> = {
  1: `💬 Hey! It's Amara here — just checking in 😊

I noticed you haven't been on in a while. Your Day 1 is waiting for you — Selar and Payhip setup usually takes less than 30 minutes with my help!

Come back whenever you're ready — I'll be right here 💪`,

  2: `💬 Hey! Amara here 👋

Your sales pages are one GitHub connection away from being live! I do all the work once you tap the link — seriously, it takes about 2 minutes.

Ready to continue? Just reply here and I'll send you the link 🔗`,

  3: `💬 Amara here — checking on you! 👋

Day 3 is waiting and your bot is SO close to being live 🤖 Just paste your BotFather token and I'll set everything up automatically in seconds.

Come back when you're ready — I dey here for you! 💪`,

  4: `💬 Hey! You're on your FINAL day! 🏆

Your certificate and completion are literally waiting for you. Don't let Day 4 slip away — it only takes a few minutes to finish!

Reply here and let's get you across the finish line 🎓`,
};

const NUDGE_DEFAULT = `💬 Hey! Amara here 👋

Just checking in — your EEM26 program is waiting for you! Send me a message whenever you're ready and we'll pick up right where you left off 😊`;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function markProactiveSent(studentId: string): Promise<void> {
  await supabase
    .from("amara_students")
    .update({ last_proactive_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", studentId);
}

// ── Main cron handler ─────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const results: Record<string, unknown> = {};

    // ── 0. Rescue legacy students stranded on the removed Payhip-approval step ──
    // Day 1 step 5 (and 6) were the old "wait for Coach Victor's approval" flow,
    // which no longer exists. Students there finished Selar + Payhip and are
    // frozen forever waiting for an approval that will never come. Move them
    // straight into Day 2 (Tech Stack verification) and message them proactively
    // so the silent/frustrated ones don't have to send a message to get unstuck.
    const { data: strandedStudents } = await supabase
      .from("amara_students")
      .select("id, telegram_chat_id, full_name, day1_completed_at")
      .eq("status", "ACTIVE")
      .eq("current_day", 1)
      .gte("current_step", 5);

    let rescuedCount = 0;
    for (const s of strandedStudents ?? []) {
      try {
        // Optimistic lock: only advance if still stranded (avoids double-sends if
        // the student messaged and the bot rescued them in the same window).
        // .select() returns the rows actually updated — empty means already moved.
        const { data: updated } = await supabase
          .from("amara_students")
          .update({
            current_day: 2,
            current_step: 1,
            payhip_account_created: true,
            day1_completed_at: s.day1_completed_at ?? nowIso,
            next_day_unlocks_at: null,
            updated_at: nowIso,
          })
          .eq("id", s.id)
          .eq("current_day", 1)
          .gte("current_step", 5)
          .select("id");

        if (!updated || updated.length === 0) continue;

        // Warm bridge first — these students have been waiting (some for days),
        // so reassure them their setup is approved before asking for anything.
        await sendTelegram(
          s.telegram_chat_id,
          `🎉 <b>Great news${s.full_name ? `, ${s.full_name.split(" ")[0]}` : ""}!</b>\n\nYour Day 1 setup is fully approved ✅ — no more waiting! We're moving straight to <b>Day 2</b> right now 🚀`
        );
        await new Promise((r) => setTimeout(r, 400));
        await sendTelegram(s.telegram_chat_id, DAY2_TECH_STACK_INTRO);
        await new Promise((r) => setTimeout(r, 400));
        await sendTelegram(s.telegram_chat_id, DAY2_TECH_STACK_ASK);
        await markProactiveSent(s.id);
        rescuedCount++;
      } catch (err) {
        console.error(`Rescue error for ${s.id}:`, err);
      }
    }
    results.legacyRescued = rescuedCount;

    // ── 1. Morning day-unlock ──────────────────────────────────────────────────
    const { data: unlockStudents, error: unlockError } = await supabase
      .from("amara_students")
      .select("*")
      .eq("status", "ACTIVE")
      .eq("current_step", 0)
      .lte("next_day_unlocks_at", nowIso)
      .gte("current_day", 1)
      .lte("current_day", 3)
      .not("next_day_unlocks_at", "is", null);

    if (unlockError) console.error("Unlock query error:", unlockError);

    let unlockCount = 0;
    for (const student of unlockStudents ?? []) {
      try {
        const nextDay = student.current_day + 1;

        // Optimistic lock: only update if still in step=0 state
        const { error: updateError, count } = await supabase
          .from("amara_students")
          .update({
            current_day: nextDay,
            current_step: 1,
            next_day_unlocks_at: null,
            updated_at: nowIso,
          })
          .eq("id", student.id)
          .eq("current_step", 0)
          .eq("current_day", student.current_day);

        if (updateError || count === 0) continue;

        const message = DAY_UNLOCK_MESSAGES[nextDay];
        if (message) await sendTelegram(student.telegram_chat_id, message);
        unlockCount++;
      } catch (err) {
        console.error(`Unlock error for ${student.id}:`, err);
      }
    }
    results.unlocked = unlockCount;

    // ── 2. Evening check-in (6PM Nigeria = 17:00 UTC) ─────────────────────────
    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();

    if (utcHour === 17 && utcMin < 5) {
      // Cut-off: must not have received a proactive message after 16:55 UTC today
      const checkinCutoff = new Date(now);
      checkinCutoff.setUTCHours(16, 55, 0, 0);

      const { data: checkinStudents } = await supabase
        .from("amara_students")
        .select("id, telegram_chat_id, current_day, current_step")
        .eq("status", "ACTIVE")
        .gt("current_step", 0)
        .gte("current_day", 1)
        .lte("current_day", 4)
        .or(`last_proactive_at.is.null,last_proactive_at.lt.${checkinCutoff.toISOString()}`);

      let checkinCount = 0;
      for (const s of checkinStudents ?? []) {
        const msg = EVENING_MESSAGES[s.current_day] ?? EVENING_DEFAULT;
        await sendTelegram(s.telegram_chat_id, msg);
        await markProactiveSent(s.id);
        checkinCount++;
      }
      results.eveningCheckins = checkinCount;
    }

    // ── 3. Silence nudge (no activity for 20+ hours) ──────────────────────────
    const silenceCutoff = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();

    const { data: silentStudents } = await supabase
      .from("amara_students")
      .select("id, telegram_chat_id, current_day, current_step, last_activity_at")
      .eq("status", "ACTIVE")
      .gt("current_step", 0)
      .gte("current_day", 1)
      .lte("current_day", 4)
      .not("last_activity_at", "is", null)
      .lt("last_activity_at", silenceCutoff)
      .or(`last_proactive_at.is.null,last_proactive_at.lt.${silenceCutoff}`);

    let nudgeCount = 0;
    for (const s of silentStudents ?? []) {
      const msg = NUDGE_MESSAGES[s.current_day] ?? NUDGE_DEFAULT;
      await sendTelegram(s.telegram_chat_id, msg);
      await markProactiveSent(s.id);
      nudgeCount++;
    }
    results.silenceNudges = nudgeCount;

    // ── 4. Daily Sunday training reminder for student bot leads ──────────────
    // Runs once at 9AM Nigeria (08:00 UTC) — REGISTERED leads only
    if (utcHour === 8 && utcMin < 5) {
      const reminderCutoff = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();

      const { data: botStudents } = await supabase
        .from("amara_students")
        .select("id, bot_token")
        .eq("status", "ACTIVE")
        .not("bot_token", "is", null);

      let botReminderCount = 0;
      for (const s of botStudents ?? []) {
        if (!s.bot_token) continue;

        const { data: regLeads } = await supabase
          .from("student_bot_leads")
          .select("chat_id, name")
          .eq("student_id", s.id)
          .eq("stage", "REGISTERED")
          .or(`last_contacted_at.is.null,last_contacted_at.lt.${reminderCutoff}`);

        for (const lead of regLeads ?? []) {
          const firstName = (lead.name ?? "").split(" ")[0];
          const greeting = firstName ? `Hey ${firstName}! ` : "Hey! ";
          const msg =
            `${greeting}Just a reminder — Sunday training is at <b>8PM Nigeria time</b> tonight! 🎯\n\n` +
            `This is where everything gets revealed live. Don't miss it — see you there! 👊\n\n` +
            `<a href="https://t.me/+jX6QLzq04uQ3OGE0">👉 Join the training group here</a>`;

          await fetch(`https://api.telegram.org/bot${s.bot_token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: lead.chat_id, text: msg, parse_mode: "HTML", disable_web_page_preview: true }),
          }).catch(() => {});

          await supabase
            .from("student_bot_leads")
            .update({ last_contacted_at: new Date().toISOString() })
            .eq("student_id", s.id)
            .eq("chat_id", lead.chat_id);

          botReminderCount++;
        }
      }
      results.botReminders = botReminderCount;
    }

    // ── 5. Saturday session reminder for COMPLETED graduates ─────────────────
    // Runs once at 8AM Nigeria (07:00 UTC) every morning.
    // Reminds graduates daily UNTIL their first Saturday session (8:30PM Nigeria
    // = 19:30 UTC) has passed — after that Saturday, Amara goes silent entirely.
    if (utcHour === 7 && utcMin < 5) {
      const morningCutoff = new Date(now);
      morningCutoff.setUTCHours(6, 55, 0, 0);

      const { data: graduates } = await supabase
        .from("amara_students")
        .select("id, telegram_chat_id, day4_completed_at")
        .eq("status", "COMPLETED")
        .or(`last_proactive_at.is.null,last_proactive_at.lt.${morningCutoff.toISOString()}`);

      let graduateReminderCount = 0;
      for (const s of graduates ?? []) {
        // Skip if their first Saturday session has already passed (silent forever after).
        if (s.day4_completed_at) {
          const grad = new Date(s.day4_completed_at);
          const session = new Date(grad);
          // Walk forward to the first Saturday 19:30 UTC at/after graduation
          for (let i = 0; i < 8; i++) {
            const candidate = new Date(grad);
            candidate.setUTCDate(grad.getUTCDate() + i);
            candidate.setUTCHours(19, 30, 0, 0);
            if (candidate.getUTCDay() === 6 && candidate.getTime() >= grad.getTime()) {
              session.setTime(candidate.getTime());
              break;
            }
          }
          if (now.getTime() >= session.getTime()) continue; // their Saturday passed → silent
        }

        await sendTelegram(
          s.telegram_chat_id,
          `☀️ <b>Good morning, EEM26 graduate!</b>\n\nJust a reminder — Coach Victor's <b>Final Stage Setup session</b> is this <b>Saturday at 8:30 PM Nigeria time</b> 🎯\n\n👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group here</a>\n\n⚠️ Don't miss it — see you there! 🏆`
        );
        await markProactiveSent(s.id);
        graduateReminderCount++;
      }
      results.graduateReminders = graduateReminderCount;
    }

    console.log("Cron result:", JSON.stringify(results));
    return new Response(JSON.stringify({ ...results, timestamp: nowIso }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Cron fatal error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

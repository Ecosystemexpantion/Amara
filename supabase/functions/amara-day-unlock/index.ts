import { createClient } from "npm:@supabase/supabase-js@2";
import {
  SRE_STEP,
  GATE_STEP,
  GATE_PITCH,
  GATE_FOLLOWUPS,
  sreIntroMessages,
  legacyUpgradeMessage,
} from "../amara-bot/day1-content.ts";
import { aiHealthCheck } from "../_shared/ai.ts";
import { PAGES_VERSION, syncStudentPages, recordPageSync } from "../_shared/pages.ts";

// Amara Day Unlock — Cron Job Function
// Runs every 5 minutes via Supabase cron schedule.
// Handles the proactive messaging flows:
// 0. Move students on the old day order onto the new Day 1 (SRE first)
// 1. Morning day-unlock at 8AM Nigeria time (07:00 UTC)
// 1b. Tech Stack sales messages + 48h expiry for students locked at Day 2
// 2. Evening check-in at 6PM Nigeria time (17:00 UTC)
// 3. Silence nudge when a student hasn't messaged in 20+ hours
// 6. AI health check every 3 hours — alerts the admin before students notice
// 7. Sales page sync — repairs 404s and rolls out new page designs, a few students per run

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_BASE   = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Day-unlock messages (sent at 8AM Nigeria) ──────────────────────────────────

const DAY_UNLOCK_MESSAGES: Record<number, string> = {
  3: `🔥 <b>Good morning! Day 3 is LIVE!</b>

Today we set up your two money platforms 💰
🛒 <b>Selar</b> — your own storefront where customers buy from you directly
🔁 <b>Payhip</b> — you earn commissions every time someone buys through your link

Got questions about how the business works? Ask me anything — when you're ready, say <b>"ready"</b> and let's go! 💪`,

  4: `🏆 <b>Good morning! Day 4 — YOUR FINAL DAY!</b>

Today we test your bot is live, confirm everything is working, and you'll receive your official <b>Certificate of Completion 🎓</b>

⚠️ <b>IMPORTANT — Final Stage Setup:</b>
Coach Victor holds a <b>live session every Saturday at 8:30 PM Nigeria time</b> for your final stage setup. You need to attend!

👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group now</a> so you don't miss it — miss it and you wait another full week!

This is your finish line. Say <b>"ready"</b> and let's complete this! 💪`,
};

// Students who started on the old day order reach Day 3 without a bot and build it there.
const LEGACY_DAY3_SRE = {
  unlock: `🔥 <b>Good morning! Day 3 is LIVE!</b>

Today you get your own AI sales bot! 🤖 Just create a bot with @BotFather on Telegram and give me the token — I'll set everything else up automatically for you (no terminal, no coding needed!).

Say <b>"ready"</b> and let's go! 💪`,
  evening: `🌙 <b>Evening check-in!</b>

Day 3 going well? Just a reminder — all you need is your BotFather token and I'll handle the rest 🤖 Your bot will be live in seconds once you paste it!`,
  nudge: `💬 Amara here — checking on you! 👋

Day 3 is waiting and your bot is SO close to being live 🤖 Just paste your BotFather token and I'll set everything up automatically in seconds.`,
};

// ── Evening check-in messages (sent at 6PM Nigeria = 17:00 UTC) ───────────────

const EVENING_MESSAGES: Record<number, string> = {
  1: `👋 <b>Evening check-in!</b>

How's your Day 1 going? All you need is your BotFather token and I'll switch on your AI sales bot automatically 🤖 It goes live in seconds once you paste it!

Send a message anytime and we'll pick up exactly where you left off 😊`,

  2: `🌙 <b>Evening check-in!</b>

How did the GitHub connection go today? Once you tap the link and authorize, I set up BOTH sales pages automatically — no more manual steps! 🚀

If you haven't done it yet, send me a message and I'll send you the link again 👆`,

  3: `🌙 <b>Evening check-in!</b>

How's your Day 3 going? If you haven't finished yet, now is a great time — I'm right here ready to guide you through your Selar and Payhip setup! 💪

Send a message anytime and we'll pick up exactly where you left off 😊`,

  4: `✨ <b>You're SO close!</b>

Day 4 is your final day — just test your bot and send me your signature for your certificate! 🎓

Don't stop now — you're literally one step from the finish line! 💪`,
};

const EVENING_DEFAULT = `👋 <b>Evening check-in!</b>

Just checking in — I'm here whenever you're ready to continue! Send me a message and we'll pick up exactly where you left off 😊`;

// ── Silence nudge messages ─────────────────────────────────────────────────────

const NUDGE_MESSAGES: Record<number, string> = {
  1: `💬 Amara here — checking on you! 👋

Day 1 is waiting and your AI sales bot is SO close to being live 🤖 Just paste your BotFather token and I'll set everything up automatically in seconds.

Come back when you're ready — I dey here for you! 💪`,

  2: `💬 Hey! Amara here 👋

Your sales pages are one GitHub connection away from being live! I do all the work once you tap the link — seriously, it takes about 2 minutes.

Ready to continue? Just reply here and I'll send you the link 🔗`,

  3: `💬 Hey! It's Amara here — just checking in 😊

I noticed you haven't been on in a while. Your Day 3 is waiting for you — Selar and Payhip setup usually takes less than 30 minutes with my help!

Come back whenever you're ready — I'll be right here 💪`,

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

    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();

    // ── 0. Students on the old day order → new Day 1 (SRE first) ──────────────
    // Old Day 1 (Selar/Payhip, steps 0–6) and old Day 2 step 1 (Tech Stack payment).
    // None of them have paid, so they start on the SRE bot (or the Day 2 lock if they already have one).
    const { data: legacyStudents } = await supabase
      .from("amara_students")
      .select("id, telegram_chat_id, full_name, current_day, current_step, bot_token")
      .eq("status", "ACTIVE")
      .or(`and(current_day.eq.1,current_step.lt.${SRE_STEP}),and(current_day.eq.2,current_step.eq.1)`);

    let migratedCount = 0;
    for (const s of legacyStudents ?? []) {
      try {
        const toGate = !!s.bot_token;
        const { data: updated } = await supabase
          .from("amara_students")
          .update({
            current_day: 1,
            current_step: toGate ? GATE_STEP : SRE_STEP,
            next_day_unlocks_at: null,
            screenshot_attempts: 0,
            last_proactive_at: nowIso,
            ...(toGate ? { day1_completed_at: nowIso } : {}),
            updated_at: nowIso,
          })
          .eq("id", s.id)
          .eq("current_day", s.current_day)
          .eq("current_step", s.current_step)
          .select("id");

        if (!updated || updated.length === 0) continue;

        await sendTelegram(s.telegram_chat_id, legacyUpgradeMessage(s.full_name));
        for (const m of toGate ? GATE_PITCH : sreIntroMessages(s.full_name, s.telegram_chat_id)) {
          await new Promise((r) => setTimeout(r, 400));
          await sendTelegram(s.telegram_chat_id, m);
        }
        migratedCount++;
      } catch (err) {
        console.error(`Migration error for ${s.id}:`, err);
      }
    }
    results.movedToNewDay1 = migratedCount;

    // ── 1. Morning day-unlock ──────────────────────────────────────────────────
    const { data: unlockStudents, error: unlockError } = await supabase
      .from("amara_students")
      .select("*")
      .eq("status", "ACTIVE")
      .eq("current_step", 0)
      .lte("next_day_unlocks_at", nowIso)
      .gte("current_day", 2)
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

        const message = nextDay === 3 && !student.bot_token ? LEGACY_DAY3_SRE.unlock : DAY_UNLOCK_MESSAGES[nextDay];
        if (message) await sendTelegram(student.telegram_chat_id, message);
        unlockCount++;
      } catch (err) {
        console.error(`Unlock error for ${student.id}:`, err);
      }
    }
    results.unlocked = unlockCount;

    // ── 1b. Tech Stack sales messages for students locked at Day 2 ────────────
    // Amara never replies to these students; this sequence is all they hear from her.
    // Each message is due `afterHours` after Day 1 finished; only the latest due one is sent.
    const nigeriaHour = (utcHour + 1) % 24;
    if (nigeriaHour >= 8 && nigeriaHour < 21) {
      const { data: lockedStudents } = await supabase
        .from("amara_students")
        .select("id, telegram_chat_id, full_name, day1_completed_at, last_proactive_at")
        .eq("status", "ACTIVE")
        .eq("current_day", 1)
        .eq("current_step", GATE_STEP)
        .not("day1_completed_at", "is", null);

      let salesCount = 0;
      for (const s of lockedStudents ?? []) {
        const lockedAt = new Date(s.day1_completed_at).getTime();
        const hoursLocked = (now.getTime() - lockedAt) / 3_600_000;
        const due = GATE_FOLLOWUPS.filter((f) => hoursLocked >= f.afterHours).pop();
        if (!due) continue;

        const dueAt = lockedAt + due.afterHours * 3_600_000;
        if (s.last_proactive_at && new Date(s.last_proactive_at).getTime() >= dueAt) continue;

        await sendTelegram(s.telegram_chat_id, due.text(s.full_name?.split(" ")[0] ?? ""));
        await markProactiveSent(s.id);
        salesCount++;
      }
      results.techStackSales = salesCount;
    }

    // ── 2. Evening check-in (6PM Nigeria = 17:00 UTC) ─────────────────────────

    if (utcHour === 17 && utcMin < 5) {
      // Cut-off: must not have received a proactive message after 16:55 UTC today
      const checkinCutoff = new Date(now);
      checkinCutoff.setUTCHours(16, 55, 0, 0);

      const { data: checkinStudents } = await supabase
        .from("amara_students")
        .select("id, telegram_chat_id, current_day, current_step, bot_token")
        .eq("status", "ACTIVE")
        .gt("current_step", 0)
        .gte("current_day", 1)
        .lte("current_day", 4)
        .or(`last_proactive_at.is.null,last_proactive_at.lt.${checkinCutoff.toISOString()}`);

      let checkinCount = 0;
      for (const s of checkinStudents ?? []) {
        if (s.current_day === 1 && s.current_step === GATE_STEP) continue;
        const msg = s.current_day === 3 && !s.bot_token
          ? LEGACY_DAY3_SRE.evening
          : EVENING_MESSAGES[s.current_day] ?? EVENING_DEFAULT;
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
      .select("id, telegram_chat_id, current_day, current_step, last_activity_at, bot_token")
      .eq("status", "ACTIVE")
      .gt("current_step", 0)
      .gte("current_day", 1)
      .lte("current_day", 4)
      .not("last_activity_at", "is", null)
      .lt("last_activity_at", silenceCutoff)
      .or(`last_proactive_at.is.null,last_proactive_at.lt.${silenceCutoff}`);

    let nudgeCount = 0;
    for (const s of silentStudents ?? []) {
      if (s.current_day === 1 && s.current_step === GATE_STEP) continue;
      const msg = s.current_day === 3 && !s.bot_token
        ? LEGACY_DAY3_SRE.nudge
        : NUDGE_MESSAGES[s.current_day] ?? NUDGE_DEFAULT;
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

    // ── 6. AI health check (every 3 hours) — a failing Claude alerts the admin from _shared/ai.ts
    if (utcHour % 3 === 0 && utcMin < 5) {
      results.aiProblems = await aiHealthCheck();
    }

    // ── 7. Sales page sync (10 students per run) ─────────────────────────────
    {
      const PAGES_PER_RUN = 10;
      const RETRY_AFTER_MS = 6 * 3600_000;
      const { data: withGithub } = await supabase
        .from("amara_students")
        .select("id, payhip_link, github_access_token")
        .not("github_access_token", "is", null);
      const { data: synced } = await supabase.from("student_pages").select("student_id, version, status, synced_at");
      const byId = new Map((synced ?? []).map((r) => [r.student_id, r]));

      const due = (withGithub ?? [])
        .filter((s) => {
          const r = byId.get(s.id);
          if (!r) return true;
          if (r.status === "ok") return r.version < PAGES_VERSION;
          return !r.synced_at || now.getTime() - new Date(r.synced_at).getTime() > RETRY_AFTER_MS;
        })
        .sort((a, b) => Number(byId.has(a.id)) - Number(byId.has(b.id)))
        .slice(0, PAGES_PER_RUN);

      let pagesOk = 0;
      for (const s of due) {
        try {
          const result = await syncStudentPages(s.github_access_token, s.payhip_link);
          await recordPageSync(supabase, s.id, result);
          if (result.status === "ok") {
            pagesOk++;
            await supabase
              .from("amara_students")
              .update({
                github_username: result.username,
                github_repo_normal: result.normalUrl,
                github_repo_premium: result.premiumUrl,
                sales_page_link: result.normalUrl,
                updated_at: new Date().toISOString(),
              })
              .eq("id", s.id);
          }
        } catch (err) {
          console.error(`Page sync error for ${s.id}:`, err);
        }
      }
      results.pagesSynced = `${pagesOk}/${due.length}`;
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

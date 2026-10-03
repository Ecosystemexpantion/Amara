// Shared by amara-bot and the amara-day-unlock cron. Keep this file free of side-effect imports.

// Day 1 step numbers start at 10 so they never collide with the old Selar/Payhip Day 1 (steps 0–6).
export const SRE_STEP = 10;
export const GATE_STEP = 11;

export const TECH_STACK_URL = "https://ecosystemexpantion.github.io/Tech_stack/";

const DOWNLOAD_LINE = `👉 <a href="${TECH_STACK_URL}">Download your Tech Stack here</a>`;
const UNLOCK_LINE = `Once you've paid, send me a <b>screenshot of your proof of payment</b> right here and <b>Day 2 unlocks instantly</b> 🔓`;

export function sreIntroMessages(fullName: string | null): string[] {
  const firstName = fullName?.split(" ")[0] ?? "";
  const handle = firstName.toLowerCase().replace(/[^a-z0-9]/g, "") || "my";
  return [
    `<b>Welcome to Day 1: Your AI Sales Bot (SRE) 🤖</b>\n\nThe EEM26 model runs on 2 systems:\n\n✅ <b>SRE (Smart Reply Engine)</b> — AI that replies to buyers and closes sales even while you sleep\n✅ <b>AAM (Automate and Attract Method)</b> — brings buyers to your DM automatically, no ads needed\n\nToday we switch on your SRE — your own bot, live in minutes 🔥`,
    `Here's all you need to do:\n\n1️⃣ Open Telegram and search for <b>@BotFather</b>\n2️⃣ Send <b>/newbot</b>\n3️⃣ Choose a display name (like "${firstName || "My"} EEM26 Assistant")\n4️⃣ Choose a username — it must end in "bot" (like "${handle}eem26bot")\n5️⃣ Copy the <b>token</b> BotFather gives you and paste it right here\n\nI'll handle everything else automatically — no coding needed! 💪`,
  ];
}

export function legacyUpgradeMessage(fullName: string | null): string {
  const firstName = fullName?.split(" ")[0];
  return `Hey${firstName ? ` ${firstName}` : ""}! 🎉 Quick update — we've upgraded the EEM26 setup.\n\nWe now start with your <b>AI sales bot (SRE)</b> so it's working for you from Day 1 🤖`;
}

export const GATE_PITCH: string[] = [
  `🔒 <b>Day 2 is LOCKED</b> until you get your <b>Tech Stack 📦</b>\n\nYour bot is live — but it needs what's inside the Tech Stack to start making you money:\n\n1️⃣ <b>Two live sales pages</b> — I build them for you on Day 2\n2️⃣ <b>The hot-selling product</b> — currently making students <b>₦51M+</b> 🔥\n3️⃣ <b>Premium page template</b> — your high-ticket version\n4️⃣ <b>Product images & sales copy</b> — proven words that convert\n5️⃣ <b>4 personal coaches</b> — with you until you're earning`,
  `${DOWNLOAD_LINE}\n\n${UNLOCK_LINE}\n\nDay 2, 3 and 4 — that's where the money starts 💰`,
];

// Sent by the cron to students locked at the gate, timed from day1_completed_at.
// Copy drawn from the Ecosystem Expansion (EEM26) sales page.
export const GATE_FOLLOWUPS: { afterHours: number; text: (firstName: string) => string }[] = [
  {
    afterHours: 3,
    text: (n) =>
      `🔥 <b>${n ? `${n}, your` : "Your"} AI bot is live — but it can't make you money yet.</b>\n\nRight now your SRE is running with nothing to sell and no sales page to send buyers to. Day 2, 3 and 4 fix that — and everything for it is inside the Tech Stack 📦\n\nReal EEM26 students who did exactly this:\n• <b>Halima Sada</b> (Kano) — first real withdrawal by week three\n• <b>Emmanuel Biachi</b> (Ibadan) — sales in NGN, XAF and GHS in his first month\n• <b>Ahmad Nasir</b> (Kaduna) — ₦359,400 in affiliate earnings from 20 sales\n• <b>Samuel Oluranti</b> (Ilorin) — sales in 4 currencies from one weekend setup\n\n${DOWNLOAD_LINE}\n\n${UNLOCK_LINE}`,
  },
  {
    afterHours: 20,
    text: (n) =>
      `☀️ <b>Good morning${n ? ` ${n}` : ""}!</b> Your Day 2 is still locked 🔒\n\nHere's what opens up the moment you get your Tech Stack:\n\n🤖 <b>SRE Setup</b> — your bot gets real products to sell and closes sales for you\n🎯 <b>AAM Setup</b> — buyers come to your DM without running ads\n🌐 <b>Two live sales pages</b> — built for you automatically\n📦 <b>Weekly Stacks</b> — ready-made products you resell and keep the money\n🏆 <b>4 personal coaches</b> — Coach Victor, Michael, Ego and Tochi — with you until you're earning\n\nStudents have made <b>₦51M+</b> with this exact system.\n\n${DOWNLOAD_LINE}\n\n${UNLOCK_LINE}`,
  },
  {
    afterHours: 30,
    text: (n) =>
      `⏳ <b>${n ? `${n}, slots` : "Slots"} are closing.</b>\n\nDownload slots are limited for each batch — once they're gone, the link closes and you wait for the next batch. Coach Victor personally handles the Day 4 setup for only <b>5 people per batch</b>.\n\nThe students who are earning now weren't special. They just acted.\n\n${DOWNLOAD_LINE}\n\n${UNLOCK_LINE}`,
  },
  {
    afterHours: 48,
    text: (n) =>
      `⚠️ <b>${n ? `${n}, everything` : "Everything"} you've built is about to expire.</b>\n\nYour AI sales bot is set up and live — and it's about to go to waste.\n\nWould you really allow it? 💔 It's just <b>Day 2, 3 and 4</b> — that's when you start making money — and you're about to let it all go, just like that?\n\nGet your Tech Stack now and we continue immediately:\n\n${DOWNLOAD_LINE}\n\n${UNLOCK_LINE}`,
  },
];

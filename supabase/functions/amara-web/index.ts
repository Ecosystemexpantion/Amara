// JSON API behind the standalone EEM26 web app (the page itself is on GitHub Pages).
// Students sign in with email + password (a session token), or use an older private
// link key (?k=…). Web-only students have no Telegram: Amara's messages land in web_inbox.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSreFromWeb, buildWebSreFromWeb, attachTelegramFromWeb, webPaymentProof, isGated } from "../amara-bot/day1.ts";
import { handleDay3 } from "../amara-bot/day3.ts";
import { handleDay4, testWebSre } from "../amara-bot/day4.ts";
import { routeMessage } from "../amara-bot/state-machine.ts";
import { deliverRunAnnouncement } from "../amara-bot/announce.ts";
import { buildGitHubAuthUrl } from "../amara-bot/github.ts";
import { saveConversation, countStudentMessagesToday, touchActivity } from "../amara-bot/db.ts";
import { notifyAdmin, studentLabel } from "../amara-bot/admin.ts";
import { sendMessage, startHolding, stopHolding, sendHeldMessages, escapeHtml } from "../amara-bot/telegram.ts";
import { holdAnnouncement, SRE_CHAT_URL } from "../_shared/runs.ts";
import { isWebChat, newWebChatId, pushInbox } from "../_shared/web-inbox.ts";
import { issueLoginCode, sha256, CODE_MINUTES } from "../_shared/web-auth.ts";
import { SRE_STEP, GATE_STEP, BOTFATHER_LINK, TECH_STACK_URL, suggestedBotNames, hasSre } from "../amara-bot/day1-content.ts";
import type { Student, TelegramMessage } from "../amara-bot/types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN_RE = /\d{6,12}:[A-Za-z0-9_-]{30,}/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_WEB_RUNS_PER_DAY = 10;
const MAX_UPLOADS_PER_DAY = 30;
const MAX_PAYMENT_PROOFS_PER_DAY = 10;
const MAX_MESSAGES_PER_DAY = 30;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const PBKDF2_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const MAX_CODE_ATTEMPTS = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function background(p: Promise<unknown>): void {
  const safe = p.catch((e) => console.error("amara-web background error:", e));
  if (typeof EdgeRuntime !== "undefined") {
    (EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(safe);
  }
}

// ── Passwords, sessions and one-time codes ───────────────────────────────────

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, iter, salt, hash] = (stored ?? "").split("$");
  if (scheme !== "pbkdf2" || !hash) return false;
  const got = b64(await pbkdf2(password, unb64(salt), Number(iter)));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

async function createSession(studentId: string): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const { error } = await supabase.from("web_sessions").insert({ token_hash: await sha256(token), student_id: studentId, expires_at: expires });
  if (error) throw new Error(`createSession: ${error.message}`);
  return token;
}

function bearer(req: Request): string | null {
  return req.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? null;
}

async function studentBySession(token: string | null): Promise<Student | null> {
  if (!token) return null;
  const { data } = await supabase
    .from("web_sessions")
    .select("student_id, expires_at")
    .eq("token_hash", await sha256(token))
    .maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  const { data: s } = await supabase.from("amara_students").select("*").eq("id", data.student_id).maybeSingle();
  return (s as Student) ?? null;
}

async function studentByKey(key: string | null): Promise<Student | null> {
  if (!key || !/^[a-f0-9]{32}$/.test(key)) return null;
  const { data } = await supabase.from("amara_students").select("*").eq("web_key", key).maybeSingle();
  return (data as Student) ?? null;
}

async function studentsByEmail(email: string): Promise<Student[]> {
  const { data } = await supabase
    .from("amara_students")
    .select("*")
    .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .order("updated_at", { ascending: false })
    .limit(5);
  return (data ?? []) as Student[];
}

async function sendCodeOnTelegram(student: Student): Promise<boolean> {
  const { data: last } = await supabase.from("web_link_codes").select("expires_at").eq("student_id", student.id).maybeSingle();
  // One code a minute is plenty.
  if (last && new Date(last.expires_at).getTime() - Date.now() > (CODE_MINUTES - 1) * 60_000) return true;
  const code = await issueLoginCode(student.id);
  return await sendMessage(
    student.telegram_chat_id,
    `🔐 Your EEM26 web login code: <b>${code}</b>\n\nType it on the web page to finish signing in. It expires in ${CODE_MINUTES} minutes.\n\n<i>Didn't ask for this? Ignore it — nobody can sign in without this code.</i>`
  );
}

function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) return "Your password needs at least 8 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

// ── Where the student is ─────────────────────────────────────────────────────

function phaseOf(s: Student): string {
  if (s.status === "COMPLETED" || s.current_day > 4) return "graduated";
  if (s.current_day === 0) return "onboarding";
  if (s.current_day === 1 && s.current_step === GATE_STEP) return "bot_live";
  if (s.current_day === 1) return "build_bot";
  if (s.current_day === 2) return s.day2_completed_at ? "pages_live" : "build_pages";
  if (s.current_day === 3 && !hasSre(s)) return "build_bot";
  if (s.current_day === 3) return s.current_step === 0 ? "day3_done" : s.current_step === 1 ? "day3_start" : "day3_upload";
  if (s.current_day === 4) return s.current_step === 1 || s.current_step === 3 ? "day4_upload" : "day4";
  return `day${s.current_day}`;
}

const webSreOnly = (s: Student) => !!s.sre_slug && !s.bot_token;

// What the student should upload on the page for their current step.
function uploadFor(s: Student): { label: string; hint: string } | null {
  if (isGated(s)) return { label: "Payment screenshot", hint: "A screenshot of your successful Tech Stack payment — showing the amount, the date and that it went through." };
  if (s.current_day === 3 && hasSre(s)) {
    if (s.current_step === 2) return { label: "Selar screenshot", hint: "A screenshot of the Selar sign-up page or your Selar dashboard." };
    if (s.current_step === 3) return { label: "Selar dashboard", hint: "A screenshot of your Selar creator dashboard after signing up." };
    if (s.current_step === 4) return { label: "Payhip dashboard", hint: "A screenshot of your Payhip affiliate sign-up form or dashboard." };
  }
  if (s.current_day === 4 && s.current_step === 1 && !webSreOnly(s)) return { label: "Bot test", hint: "A screenshot of your bot replying to a message you sent it." };
  if (s.current_day === 4 && s.current_step === 3) return { label: "Signature", hint: "A clear photo of your handwritten signature on paper." };
  return null;
}

async function latestRun(studentId: string, runId?: string | null) {
  let q = supabase.from("sre_runs").select("id, kind, title, status, source, bot_username, events, created_at").eq("student_id", studentId);
  q = runId ? q.eq("id", runId) : q.order("created_at", { ascending: false }).limit(1);
  const { data } = await q;
  return data?.[0] ?? null;
}

async function countRuns(studentId: string, filter: { source?: string; kind?: string[] }): Promise<number> {
  let q = supabase
    .from("sre_runs")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if (filter.source) q = q.eq("source", filter.source);
  if (filter.kind) q = q.in("kind", filter.kind);
  const { count } = await q;
  return count ?? 0;
}

function decodeImage(data: unknown, mime: unknown): { bytes: Uint8Array; mimeType: string } | null {
  if (typeof data !== "string" || typeof mime !== "string" || !/^image\/(jpeg|png|webp)$/.test(mime)) return null;
  try {
    const bin = atob(data.replace(/^data:[^,]+,/, ""));
    if (bin.length === 0 || bin.length > MAX_UPLOAD_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mimeType: mime };
  } catch {
    return null;
  }
}

// Amara's replies to a web upload are held until the page finishes playing the check,
// then released together (or by the cron's fallback if the page is closed early).
async function checkUploadAndHoldReplies(student: Student, chatId: number, run: () => Promise<void>): Promise<void> {
  const startedAt = new Date(Date.now() - 2_000).toISOString();
  startHolding(chatId);
  try {
    await run();
  } finally {
    const items = stopHolding(chatId);
    const { data } = await supabase
      .from("sre_runs")
      .select("id")
      .eq("student_id", student.id)
      .in("kind", ["check", "certificate"])
      .gte("created_at", startedAt)
      .order("created_at", { ascending: false })
      .limit(1);
    const runId = data?.[0]?.id as string | undefined;
    if (runId && items.length) await holdAnnouncement(runId, { type: "messages", items });
    else if (items.length) await sendHeldMessages(chatId, items);
  }
}

function slugBase(text: string | null): string {
  return (text ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 14) || "eem26";
}

async function freeSlug(base: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const slug = `${base}-${String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, "0")}`;
    const { data } = await supabase.from("amara_students").select("id").eq("sre_slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function account(s: Student) {
  return { email: s.email, webOnly: isWebChat(s.telegram_chat_id), hasPassword: !!s.password_hash };
}

// ── Account actions (no sign-in needed) ──────────────────────────────────────

async function signup(body: Record<string, unknown>): Promise<Response> {
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim().slice(0, 25) || null;
  const country = String(body.country ?? "").trim().slice(0, 40) || null;
  if (name.length < 2 || name.length > 60) return json({ error: "Please enter your full name (as it should appear on your certificate)." }, 400);
  if (!EMAIL_RE.test(email) || email.length > 120) return json({ error: "Please enter a valid email address." }, 400);
  const bad = passwordProblem(body.password);
  if (bad) return json({ error: bad }, 400);

  const existing = await studentsByEmail(email);
  if (existing.some((s) => s.password_hash)) return json({ error: "You already have an account with this email — log in instead." }, 409);

  // Already a student on Telegram: prove it's them with a code from Amara, then keep their progress.
  const onTelegram = existing.find((s) => !isWebChat(s.telegram_chat_id));
  if (onTelegram) {
    const sent = await sendCodeOnTelegram(onTelegram);
    return json({
      needCode: true,
      message: sent
        ? "You're already an EEM26 student 🎉 We sent a 6-digit code to your Amara chat on Telegram — type it below to link your account and keep all your progress."
        : "You're already an EEM26 student, but we couldn't reach your Amara chat on Telegram. Ask your coach for a login code.",
    });
  }

  const { data, error } = await supabase
    .from("amara_students")
    .insert({
      telegram_chat_id: newWebChatId(),
      full_name: name,
      email,
      phone,
      country,
      current_day: 1,
      current_step: SRE_STEP,
      status: "ACTIVE",
      password_hash: await hashPassword(String(body.password)),
      last_activity_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error || !data) throw new Error(`signup insert: ${error?.message}`);
  const student = data as Student;

  await pushInbox(
    student.telegram_chat_id,
    {
      kind: "text",
      text: `Welcome, <b>${escapeHtml(name.split(" ")[0])}</b>! 🎉 I'm your EEM26 setup coach.\n\nIn 4 days we set up your whole business. <b>Day 1</b> is your AI sales assistant (SRE) — it chats with buyers and closes sales for you 24/7, right on its own web link. No Telegram, no BotFather, no code. Tap <b>Build my assistant</b> to start 🚀`,
    }
  );
  await notifyAdmin(`🆕 <b>New web sign-up</b>\n\n${studentLabel(name, student.telegram_chat_id)}\n📧 ${escapeHtml(email)}${phone ? `\n📞 ${escapeHtml(phone)}` : ""}${country ? `\n🌍 ${escapeHtml(country)}` : ""}\n\n<i>Web-only — no Telegram. Replies you send with this 🆔 appear on their page.</i>`);
  return json({ session: await createSession(student.id), firstName: name.split(" ")[0] });
}

async function login(body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  const existing = await studentsByEmail(email);
  for (const s of existing.filter((x) => x.password_hash)) {
    if (await verifyPassword(password, s.password_hash)) {
      return json({ session: await createSession(s.id), firstName: s.full_name?.split(" ")[0] ?? null });
    }
  }
  if (existing.length && !existing.some((s) => s.password_hash)) {
    return json({ error: "You haven't set a password yet — tap Create account with this email to link your Telegram progress." }, 401);
  }
  return json({ error: "That email and password don't match. Check them and try again." }, 401);
}

async function forgot(body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const s = (await studentsByEmail(email))[0];
  const generic = { needCode: true, message: "If that email has an account, a 6-digit code is on its way — on Telegram if you use Amara there, or from your coach." };
  if (!s) return json(generic);
  if (!isWebChat(s.telegram_chat_id) && (await sendCodeOnTelegram(s))) {
    return json({ needCode: true, message: "We sent a 6-digit code to your Amara chat on Telegram. Type it below with your new password." });
  }
  await notifyAdmin(`🔐 <b>Password reset request</b> on the web\n\n${studentLabel(s.full_name, s.telegram_chat_id)}\n📧 ${escapeHtml(s.email ?? "")}\n\nSend <code>code ${s.telegram_chat_id}</code> to get a login code, then give it to them.`);
  return json({ needCode: true, message: "Your coach has been asked for your login code — they'll send it to you shortly. Type it below with your new password." });
}

async function verifyCode(body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").replace(/\D/g, "");
  const bad = passwordProblem(body.password);
  if (bad) return json({ error: bad }, 400);
  const fail = json({ error: "That code isn't right or has expired. Ask for a new one." }, 401);

  for (const s of await studentsByEmail(email)) {
    const { data: row } = await supabase.from("web_link_codes").select("*").eq("student_id", s.id).maybeSingle();
    if (!row) continue;
    if (new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) return fail;
    if (row.code_hash !== (await sha256(`${s.id}:${code}`))) {
      await supabase.from("web_link_codes").update({ attempts: row.attempts + 1 }).eq("student_id", s.id);
      return fail;
    }
    await supabase.from("web_link_codes").delete().eq("student_id", s.id);
    await supabase.from("amara_students").update({ password_hash: await hashPassword(String(body.password)), updated_at: new Date().toISOString() }).eq("id", s.id);
    await supabase.from("web_sessions").delete().eq("student_id", s.id);
    return json({ session: await createSession(s.id), firstName: s.full_name?.split(" ")[0] ?? null });
  }
  return fail;
}

// ── Signed-in page data ──────────────────────────────────────────────────────

async function pageState(student: Student, url: URL): Promise<Response> {
  const chatId = student.telegram_chat_id;

  const docId = url.searchParams.get("doc");
  if (docId) {
    const { data } = await supabase.from("web_inbox").select("filename, data").eq("id", Number(docId)).eq("chat_id", chatId).eq("kind", "doc").maybeSingle();
    return data ? json(data) : json({ error: "Not found" }, 404);
  }

  const phase = phaseOf(student);
  const run = await latestRun(student.id, url.searchParams.get("run"));
  const names = suggestedBotNames(student.full_name, chatId);
  const out: Record<string, unknown> = {
    firstName: student.full_name?.split(" ")[0] ?? null,
    fullName: student.full_name,
    account: account(student),
    phase,
    day: student.current_day,
    step: student.current_step,
    botfather: { link: BOTFATHER_LINK, displayName: names.displayName, username: names.username },
    techStackUrl: TECH_STACK_URL,
    githubConnectUrl: phase === "build_pages" || phase === "pages_live" ? buildGitHubAuthUrl(`web.${chatId}`) : null,
    pages: student.github_repo_normal ? { normal: student.github_repo_normal, premium: student.github_repo_premium } : null,
    sre: {
      name: student.sre_name ?? null,
      chatUrl: student.sre_slug ? `${SRE_CHAT_URL}?s=${student.sre_slug}` : null,
      telegram: !!student.bot_token,
      suggestedName: `${student.full_name?.split(" ")[0] ?? "My"}'s Assistant`.slice(0, 40),
    },
    upload: uploadFor(student),
    canTestSre: student.current_day === 4 && student.current_step === 1 && webSreOnly(student),
    canMessage: isWebChat(chatId) && phase !== "build_bot",
    run,
  };

  const after = url.searchParams.get("inbox");
  if (after !== null) {
    const { data } = await supabase
      .from("web_inbox")
      .select("id, kind, text, filename, created_at")
      .eq("chat_id", chatId)
      .gt("id", Number(after) || 0)
      .order("id", { ascending: false })
      .limit(60);
    out.inbox = (data ?? []).reverse();
  }

  if (url.searchParams.get("leads") && hasSre(student)) {
    const { data } = await supabase
      .from("student_bot_leads")
      .select("name, country, stage, interest_level, chat_id, updated_at")
      .eq("student_id", student.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    out.leads = (data ?? []).map((l) => ({
      name: l.name,
      country: l.country,
      stage: l.stage,
      interest: l.interest_level,
      via: String(l.chat_id).startsWith("web-") ? "web" : "telegram",
      at: l.updated_at,
    }));
  }
  return json(out);
}

async function act(student: Student, body: Record<string, unknown>, req: Request): Promise<Response> {
  const chatId = student.telegram_chat_id as unknown as number;
  const phase = phaseOf(student);

  // The page finished playing a build: release the held message.
  if (body.action === "shown") {
    const { data: own } = await supabase.from("sre_runs").select("id").eq("id", String(body.run ?? "")).eq("student_id", student.id).maybeSingle();
    if (own) background(deliverRunAnnouncement(own.id));
    return json({ ok: true });
  }

  if (body.action === "logout") {
    const token = bearer(req);
    if (token) await supabase.from("web_sessions").delete().eq("token_hash", await sha256(token));
    return json({ ok: true });
  }

  // A question for the coach (web-only students — Telegram students talk to Amara there).
  if (body.action === "message") {
    const text = String(body.text ?? "").trim().slice(0, 1500);
    if (!text) return json({ error: "Type a message first." }, 400);
    if (!isWebChat(student.telegram_chat_id)) return json({ error: "Send your questions to Amara on Telegram 😊" }, 409);
    if (phase === "build_bot") return json({ error: "Tap Build my assistant above — that's all Day 1 needs 😊" }, 409);
    if ((await countStudentMessagesToday(student.id)) >= MAX_MESSAGES_PER_DAY) {
      return json({ error: "You've sent a lot of messages today — your coach will catch up with you tomorrow 🙏" }, 429);
    }
    await pushInbox(student.telegram_chat_id, { kind: "me", text: escapeHtml(text) });
    touchActivity(student.id).catch(() => {});
    const msg: TelegramMessage = { message_id: 0, chat: { id: 0, type: "private" }, date: Math.floor(Date.now() / 1000), text };
    background(routeMessage(msg, student, chatId));
    return json({ ok: true });
  }

  // Day 3 begins with "ready" — the student starts the Selar step from the page.
  if (body.action === "ready") {
    if (phase !== "day3_start") return json({ error: "Nothing to start right now." }, 409);
    await saveConversation(student.id, "user", "ready [web]", "text");
    background(handleDay3({} as TelegramMessage, student, chatId, "ready", null));
    return json({ ok: true });
  }

  // Day 4 with a web assistant: the agents test it with a real buyer message.
  if (body.action === "test_sre") {
    if (!(student.current_day === 4 && student.current_step === 1 && webSreOnly(student))) return json({ error: "Nothing to test right now." }, 409);
    if ((await countRuns(student.id, { kind: ["check"] })) >= MAX_UPLOADS_PER_DAY) return json({ error: "Too many tests today — try again tomorrow." }, 429);
    background(checkUploadAndHoldReplies(student, chatId, async () => { await testWebSre(student, chatId); }));
    return json({ ok: true });
  }

  // Screenshots: Tech Stack payment proof (checked by the coach), Day 3 / Day 4 checks.
  if (body.action === "upload") {
    if (!uploadFor(student)) return json({ error: "There's nothing to upload for your current step." }, 409);
    const photo = decodeImage(body.image, body.mime);
    if (!photo) return json({ error: "That image couldn't be read. Please choose a JPG or PNG under 6 MB." }, 400);
    if (isGated(student)) {
      if ((await countStudentMessagesToday(student.id, "photo")) >= MAX_PAYMENT_PROOFS_PER_DAY) {
        return json({ error: "You've sent several screenshots today — your coach is checking them 🙏" }, 429);
      }
      background(webPaymentProof(student, photo));
      return json({ ok: true, payment: true });
    }
    if ((await countRuns(student.id, { kind: ["check", "certificate"] })) >= MAX_UPLOADS_PER_DAY) {
      return json({ error: "Too many uploads today — please try again tomorrow." }, 429);
    }
    await saveConversation(student.id, "user", "[photo via web]", "photo");
    const handler = student.current_day === 3 ? handleDay3 : handleDay4;
    background(checkUploadAndHoldReplies(student, chatId, () => handler({} as TelegramMessage, student, chatId, null, photo)));
    return json({ ok: true });
  }

  const { data: running } = await supabase
    .from("sre_runs")
    .select("id")
    .eq("student_id", student.id)
    .eq("kind", "sre")
    .eq("status", "running")
    .gte("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
    .limit(1);

  // Day 1 on the web: the AI sales assistant as a chat page — no Telegram needed.
  if (body.action === "build_sre") {
    if (phase !== "build_bot" || (student.current_day === 1 && student.current_step !== SRE_STEP)) {
      return json({ error: "Your assistant is already set up — there's nothing to build right now." }, 409);
    }
    if (running?.[0]) return json({ runId: running[0].id });
    if ((await countRuns(student.id, { source: "web", kind: ["sre"] })) >= MAX_WEB_RUNS_PER_DAY) {
      return json({ error: "Too many attempts today — please try again tomorrow." }, 429);
    }
    const name = String(body.name ?? "").trim().replace(/[<>]/g, "").replace(/\s+/g, " ").slice(0, 40) || `${student.full_name?.split(" ")[0] ?? "My"}'s Assistant`;
    const slug = student.sre_slug ?? (await freeSlug(slugBase(student.full_name)));
    const { runId, done } = await buildWebSreFromWeb(student, name, slug);
    background(done);
    return json({ runId });
  }

  // A BotFather token: builds the Telegram bot (Day 1), or adds Telegram to a web assistant (optional).
  if (body.action === "token" || body.token) {
    const token = String(body.token ?? "").match(BOT_TOKEN_RE)?.[0];
    if (!token) {
      return json({ error: "That doesn't look like a BotFather token. It looks like 1234567890:AAH… — copy it from BotFather's \"Done!\" message." }, 400);
    }
    const attach = !!student.sre_slug && !student.bot_token;
    if (!attach && (phase !== "build_bot" || (student.current_day === 1 && student.current_step !== SRE_STEP))) {
      return json({ error: "Your bot is already set up — there's nothing to build right now." }, 409);
    }
    if (running?.[0]) return json({ runId: running[0].id });
    if ((await countRuns(student.id, { source: "web", kind: ["sre"] })) >= MAX_WEB_RUNS_PER_DAY) {
      return json({ error: "Too many attempts today — please try again tomorrow." }, 429);
    }
    const { runId, done } = attach ? await attachTelegramFromWeb(student, token) : await buildSreFromWeb(student, token);
    background(done);
    return json({ runId });
  }

  return json({ error: "Unknown action" }, 400);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const url = new URL(req.url);
    const body: Record<string, unknown> = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (req.method === "POST") {
      if (body.action === "signup") return await signup(body);
      if (body.action === "login") return await login(body);
      if (body.action === "forgot") return await forgot(body);
      if (body.action === "verify_code") return await verifyCode(body);
    }

    const key = (body.k as string | undefined) ?? url.searchParams.get("k");
    const student = (await studentBySession(bearer(req))) ?? (await studentByKey(key ?? null));
    if (!student) {
      return json({ error: key ? "This link isn't valid anymore — log in with your email instead." : "Please log in again.", signedOut: true }, 401);
    }

    if (req.method === "GET") return await pageState(student, url);
    if (req.method === "POST") return await act(student, body, req);
    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("amara-web error:", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});

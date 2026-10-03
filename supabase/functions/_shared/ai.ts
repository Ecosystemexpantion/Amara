// One place for every AI call (Amara, student bots, cron health check).
// Order: Claude (paid, primary) → Groq → Gemini. A failure at one provider never stops the chain,
// and retired free-tier models are replaced automatically from each provider's live model list.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ImageInput = { base64: string; mimeType: string };

const CLAUDE_MODELS = listEnv("AMARA_CLAUDE_MODELS", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"]);
const GEMINI_MODELS = listEnv("AMARA_GEMINI_MODELS", ["gemini-flash-latest", "gemini-flash-lite-latest"]);
const CLAUDE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function listEnv(name: string, fallback: string[]): string[] {
  const raw = Deno.env.get(name);
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return list.length > 0 ? list : fallback;
}

function envKeys(base: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    const k = Deno.env.get(i === 1 ? base : `${base}_${i}`);
    if (k) keys.push(k);
  }
  return keys;
}

// ── Admin alerts ──────────────────────────────────────────────────────────────

const lastAlertAt = new Map<string, number>();

export async function alertAdminOnce(key: string, html: string, everyMs = 30 * 60_000): Promise<void> {
  const now = Date.now();
  if (now - (lastAlertAt.get(key) ?? 0) < everyMs) return;
  lastAlertAt.set(key, now);
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const admin = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: admin, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error("alertAdminOnce error:", e);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Claude ────────────────────────────────────────────────────────────────────

let claudeClient: Anthropic | null = null;
function claude(): Anthropic | null {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  claudeClient ??= new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  return claudeClient;
}

// Claude 5.x models think on every request and reject sampling params; Haiku 4.5 does neither.
function isClaude5(model: string): boolean {
  return /^claude-(opus|sonnet|fable)-5/.test(model);
}

type ClaudeContent = string | Anthropic.Beta.Messages.BetaContentBlockParam[];

async function callClaude(
  system: string | undefined,
  messages: { role: "user" | "assistant"; content: ClaudeContent }[],
  maxTokens: number,
  temperature: number | undefined,
  errors: string[]
): Promise<string | null> {
  const client = claude();
  if (!client) {
    errors.push("Claude: ANTHROPIC_API_KEY is not set");
    warnClaudeDown(errors);
    return null;
  }

  for (const model of CLAUDE_MODELS) {
    const modern = isClaude5(model);
    try {
      const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
        model,
        // Thinking is always on for Claude 5.x, so leave room for it on top of the reply.
        max_tokens: modern ? maxTokens + 3000 : maxTokens,
        messages,
        ...(system ? { system } : {}),
        ...(modern
          ? { output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
          : temperature !== undefined ? { temperature } : {}),
      } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

      const res = await client.beta.messages.create(params);
      if (res.stop_reason === "refusal") {
        errors.push(`Claude ${model}: refused`);
        continue;
      }
      const text = res.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      if (text) return text;
      errors.push(`Claude ${model}: empty reply (${res.stop_reason})`);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        errors.push(`Claude: API key rejected (${e.status}) — ${e.message}`);
        warnClaudeDown(errors);
        return null; // every model would fail the same way
      }
      if (e instanceof Anthropic.NotFoundError) {
        errors.push(`Claude ${model}: model not found — ${e.message}`);
        alertAdminOnce(`claude-404-${model}`, `⚠️ <b>Claude model unavailable:</b> <code>${esc(model)}</code>\nAmara switched to the next model automatically. Update <code>AMARA_CLAUDE_MODELS</code> when convenient.`, 24 * 3600_000);
        continue;
      }
      if (e instanceof Anthropic.APIError) {
        errors.push(`Claude ${model}: ${e.status ?? "network"} — ${e.message}`);
        continue;
      }
      errors.push(`Claude ${model}: ${String(e)}`);
    }
  }
  warnClaudeDown(errors);
  return null;
}

function warnClaudeDown(errors: string[]): void {
  alertAdminOnce(
    "claude-down",
    `⚠️ <b>Claude is not answering</b> — Amara is running on the free backup providers, which can stop at any time.\n\n<code>${esc(errors.filter((e) => e.startsWith("Claude")).join("\n").slice(0, 1200))}</code>\n\nFix: set <code>ANTHROPIC_API_KEY</code> in Supabase secrets and make sure the account has credit.`,
    6 * 3600_000
  );
}

// ── Groq (self-discovering model list) ───────────────────────────────────────

let groqDiscovered: { at: number; models: string[] } | null = null;

async function groqModels(key: string): Promise<string[]> {
  const configured = Deno.env.get("AMARA_GROQ_MODELS");
  if (configured) return listEnv("AMARA_GROQ_MODELS", []);
  if (groqDiscovered && Date.now() - groqDiscovered.at < 6 * 3600_000) return groqDiscovered.models;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return [];
    const data = await res.json();
    const ids: string[] = (data.data ?? [])
      .filter((m: { id: string; active?: boolean }) => m.active !== false)
      .map((m: { id: string }) => m.id)
      .filter((id: string) => !/whisper|guard|tts|playai|orpheus|distil|prompt|compound|vision/i.test(id));
    const rank = (id: string) => {
      const prefs = [/gpt-oss-120b/i, /llama-4/i, /llama-3\.3-70b/i, /kimi|qwen/i, /llama/i, /gpt-oss/i];
      const i = prefs.findIndex((p) => p.test(id));
      return i === -1 ? prefs.length : i;
    };
    const models = ids.sort((a, b) => rank(a) - rank(b)).slice(0, 3);
    groqDiscovered = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}

async function callGroq(
  system: string | undefined,
  history: ChatTurn[],
  maxTokens: number,
  temperature: number | undefined,
  errors: string[]
): Promise<string | null> {
  const keys = envKeys("GROQ_API_KEY", 5);
  if (keys.length === 0) return null;
  const models = await groqModels(keys[0]);
  if (models.length === 0) {
    errors.push("Groq: no usable models found");
    return null;
  }

  const messages = [...(system ? [{ role: "system", content: system }] : []), ...history];
  for (const key of keys) {
    for (const model of models) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: temperature ?? 0.7 }),
        });
        if (!res.ok) {
          errors.push(`Groq ${model}: ${res.status}`);
          if (res.status === 404 || res.status === 400) groqDiscovered = null;
          continue;
        }
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (e) {
        errors.push(`Groq ${model}: ${String(e)}`);
      }
    }
  }
  return null;
}

// ── Gemini (aliases + self-discovering fallback) ─────────────────────────────

let geminiDiscovered: { at: number; models: string[] } | null = null;

async function geminiModels(key: string): Promise<string[]> {
  if (geminiDiscovered && Date.now() - geminiDiscovered.at < 6 * 3600_000) {
    return [...GEMINI_MODELS, ...geminiDiscovered.models];
  }
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`);
    if (res.ok) {
      const data = await res.json();
      const models: string[] = (data.models ?? [])
        .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: { name: string }) => m.name.replace(/^models\//, ""))
        .filter((n: string) => /flash/i.test(n) && !/image|tts|live|audio|embedding|exp|preview/i.test(n))
        .sort()
        .reverse()
        .slice(0, 2);
      geminiDiscovered = { at: Date.now(), models };
    }
  } catch { /* fall back to aliases only */ }
  return [...new Set([...GEMINI_MODELS, ...(geminiDiscovered?.models ?? [])])];
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

async function callGemini(
  system: string | undefined,
  contents: { role: "user" | "model"; parts: GeminiPart[] }[],
  maxTokens: number,
  temperature: number | undefined,
  errors: string[]
): Promise<string | null> {
  const keys = envKeys("GEMINI_API_KEY", 10);
  if (keys.length === 0) return null;
  const models = await geminiModels(keys[0]);

  for (const model of models) {
    for (const key of keys) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
              contents,
              generationConfig: { temperature: temperature ?? 0.7, maxOutputTokens: maxTokens },
            }),
          }
        );
        if (res.status === 429) {
          errors.push(`Gemini ${model}: quota`);
          continue; // next key
        }
        if (!res.ok) {
          errors.push(`Gemini ${model}: ${res.status}`);
          if (res.status === 404) geminiDiscovered = null;
          break; // model-level problem — next model
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? "")
          .join("")
          .trim();
        if (text) return text;
        errors.push(`Gemini ${model}: empty reply`);
        break;
      } catch (e) {
        errors.push(`Gemini ${model}: ${String(e)}`);
      }
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Claude requires the conversation to start with the user and alternate roles.
function normalizeTurns(history: ChatTurn[], user: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const t of [...history, { role: "user" as const, content: user }]) {
    if (!t.content?.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else turns.push({ ...t });
  }
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  return turns;
}

function reportFailure(caller: string, kind: string, errors: string[]): void {
  console.error(`[ai] ${caller} ${kind} failed on every provider:\n${errors.join("\n")}`);
  alertAdminOnce(
    `ai-down-${caller}-${kind}`,
    `🚨 <b>AI is DOWN for ${esc(caller)} (${kind})</b>\n\nEvery provider failed, so students are getting a holding message instead of a real reply.\n\n<code>${esc(errors.slice(0, 8).join("\n").slice(0, 1500))}</code>\n\nMost common fix: make sure <code>ANTHROPIC_API_KEY</code> is set and the Claude account has credit.`
  );
}

export async function aiChat(opts: {
  system?: string;
  history: ChatTurn[];
  user: string;
  maxTokens: number;
  temperature?: number;
  caller: string;
}): Promise<string | null> {
  const turns = normalizeTurns(opts.history, opts.user);
  if (turns.length === 0) return null;
  const errors: string[] = [];

  const viaClaude = await callClaude(opts.system, turns, opts.maxTokens, opts.temperature, errors);
  if (viaClaude) return viaClaude;

  const viaGroq = await callGroq(opts.system, turns, opts.maxTokens, opts.temperature, errors);
  if (viaGroq) return viaGroq;

  const viaGemini = await callGemini(
    opts.system,
    turns.map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.content }] })),
    opts.maxTokens,
    opts.temperature,
    errors
  );
  if (viaGemini) return viaGemini;

  reportFailure(opts.caller, "chat", errors);
  return null;
}

export async function aiVision(opts: {
  prompt: string;
  image: ImageInput;
  maxTokens: number;
  temperature?: number;
  caller: string;
}): Promise<string | null> {
  const errors: string[] = [];
  const mediaType = CLAUDE_IMAGE_TYPES.has(opts.image.mimeType) ? opts.image.mimeType : "image/jpeg";

  const viaClaude = await callClaude(
    undefined,
    [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: opts.image.base64 } },
        { type: "text", text: opts.prompt },
      ],
    }],
    opts.maxTokens,
    opts.temperature,
    errors
  );
  if (viaClaude) return viaClaude;

  const viaGemini = await callGemini(
    undefined,
    [{ role: "user", parts: [{ inline_data: { mime_type: opts.image.mimeType, data: opts.image.base64 } }, { text: opts.prompt }] }],
    opts.maxTokens,
    opts.temperature,
    errors
  );
  if (viaGemini) return viaGemini;

  reportFailure(opts.caller, "vision", errors);
  return null;
}

// Audio/video understanding — only Gemini accepts these inline.
export async function aiMediaToText(opts: { prompt: string; media: ImageInput; maxTokens: number; caller: string }): Promise<string | null> {
  const errors: string[] = [];
  const text = await callGemini(
    undefined,
    [{ role: "user", parts: [{ inline_data: { mime_type: opts.media.mimeType, data: opts.media.base64 } }, { text: opts.prompt }] }],
    opts.maxTokens,
    0.1,
    errors
  );
  if (!text) console.error(`[ai] ${opts.caller} media failed:\n${errors.join("\n")}`);
  return text;
}

export async function transcribeAudio(bytes: Uint8Array, mimeType: string, base64: string): Promise<string | null> {
  const key = envKeys("GROQ_API_KEY", 5)[0];
  if (key) {
    for (const model of listEnv("AMARA_GROQ_WHISPER_MODELS", ["whisper-large-v3-turbo", "whisper-large-v3"])) {
      try {
        const form = new FormData();
        const ext = mimeType.includes("mp4") ? "mp4" : "ogg";
        form.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }), `audio.${ext}`);
        form.append("model", model);
        form.append("response_format", "text");
        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
        });
        if (res.ok) return (await res.text()).trim();
        console.warn(`Groq whisper ${model}: ${res.status}`);
      } catch (e) {
        console.warn(`Groq whisper ${model}:`, e);
      }
    }
  }
  return aiMediaToText({
    prompt: "Transcribe this voice message accurately. Return only the transcription text, nothing else.",
    media: { base64, mimeType },
    maxTokens: 500,
    caller: "voice",
  });
}

// Used by the cron so a dead key, empty credit or retired model is reported before students notice.
export async function aiHealthCheck(): Promise<string[]> {
  const problems: string[] = [];
  const errors: string[] = [];
  const ok = await callClaude(undefined, [{ role: "user", content: "Reply with the single word: ok" }], 16, undefined, errors);
  if (!ok) problems.push(...errors);
  return problems;
}

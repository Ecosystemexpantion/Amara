// Builds, publishes and repairs students' two GitHub Pages sales pages.
// Used by github-oauth (first setup / reconnect) and the cron (repairing 404s, rolling out new designs).
import { NORMAL_TEMPLATE } from "../github-oauth/normal_template.ts";
import { PREMIUM_TEMPLATE } from "../github-oauth/premium_template.ts";
import { LIQUID_GLASS_CSS } from "./liquid-glass.ts";

// Bump when the page design changes — the cron re-publishes every student's pages.
export const PAGES_VERSION = 3;

export const PAGE_REPOS = { normal: "EEM26page", premium: "EEM26premium" } as const;

export type SyncStatus = "ok" | "token_revoked" | "email_unverified" | "error";

export interface SyncResult {
  status: SyncStatus;
  detail: string;
  username?: string;
  normalUrl?: string;
  premiumUrl?: string;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

// Strip Paystack/EmailJS and point every buy button at the student's Payhip link.
export function modifyForStudent(html: string, payhipLink: string): string {
  let h = html;
  h = h.replace(/<script[^>]*paystack[^>]*><\/script>/gi, "");
  h = h.replace(/<script[^>]*emailjs[^>]*><\/script>/gi, "");
  h = h.replace(/emailjs\.init\s*\([^)]*\)\s*;?/g, "");
  h = h.replace(/emailjs\.send\s*\([\s\S]*?\)\s*;?/g, "");
  h = h.replace(
    /<div[^>]+id=["']pay-modal["'][^>]*>[\s\S]*?<\/div>\s*(?=<\/div>|<section|<footer|$)/i,
    ""
  );
  h = h.replace(
    /(<a\b[^>]*class="[^"]*buy-trigger[^"]*"[^>]*)href="[^"]*"/gi,
    `$1href="${payhipLink}" target="_blank"`
  );
  h = h.replace(
    /(<a\b[^>]*href="[^"]*"[^>]*class="[^"]*buy-trigger[^"]*"[^>]*)/gi,
    (m) => m.replace(/href="[^"]*"/, `href="${payhipLink}" target="_blank"`)
  );
  h = h.replace(/function\s+initiatePaystack\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, "");
  h = h.replace(/function\s+openPayModal\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, "");
  h = h.replace(/document\.querySelectorAll\(['"].buy-trigger['"]\)[\s\S]*?}\);?/g, "");
  // Scroll-reveal relies on scripts removed above, so keep content visible.
  h = h.replace(
    "</head>",
    `<style>.reveal{opacity:1!important;transform:none!important;transition:none!important}</style>${LIQUID_GLASS_CSS}</head>`
  );
  return h;
}

export function buildPages(payhipLink: string | null): { normal: string; premium: string } {
  const link = payhipLink || "https://payhip.com";
  return { normal: modifyForStudent(NORMAL_TEMPLATE, link), premium: modifyForStudent(PREMIUM_TEMPLATE, link) };
}

// ── GitHub API ───────────────────────────────────────────────────────────────

function gh(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Amara-Bot/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

async function fail(res: Response, what: string): Promise<never> {
  throw new Error(`${what} → ${res.status} ${(await res.text()).slice(0, 300)}`);
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

// Makes sure the repo exists, is public, and returns its default branch.
async function ensureRepo(token: string, owner: string, repo: string, description: string): Promise<string> {
  let res = await gh(token, `/repos/${owner}/${repo}`);
  if (res.status === 404) {
    await res.body?.cancel();
    res = await gh(token, "/user/repos", {
      method: "POST",
      body: JSON.stringify({ name: repo, description, private: false, auto_init: true }),
    });
    if (!res.ok) await fail(res, `create ${repo}`);
  } else if (!res.ok) {
    await fail(res, `read ${repo}`);
  }
  const data = await res.json();
  if (data.private) {
    const patch = await gh(token, `/repos/${owner}/${repo}`, { method: "PATCH", body: JSON.stringify({ private: false }) });
    if (!patch.ok) await fail(patch, `make ${repo} public`);
    await patch.body?.cancel();
  }
  return data.default_branch || "main";
}

async function putFile(token: string, owner: string, repo: string, branch: string, file: string, content: string): Promise<void> {
  const path = `/repos/${owner}/${repo}/contents/${file}`;
  const existing = await gh(token, `${path}?ref=${encodeURIComponent(branch)}`);
  const sha = existing.ok ? (await existing.json()).sha : (await existing.body?.cancel(), undefined);
  const res = await gh(token, path, {
    method: "PUT",
    body: JSON.stringify({ message: "Update sales page", content: toBase64(content), branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) await fail(res, `upload ${repo}/${file}`);
  await res.body?.cancel();
}

// Turns Pages on (or points it at the right branch) and asks GitHub to rebuild.
async function ensurePages(token: string, owner: string, repo: string, branch: string): Promise<void> {
  const source = { branch, path: "/" };
  const current = await gh(token, `/repos/${owner}/${repo}/pages`);
  if (current.status === 404) {
    await current.body?.cancel();
    const res = await gh(token, `/repos/${owner}/${repo}/pages`, { method: "POST", body: JSON.stringify({ source }) });
    if (!res.ok && res.status !== 409) await fail(res, `enable Pages on ${repo}`);
    await res.body?.cancel();
    return;
  }
  if (!current.ok) await fail(current, `read Pages on ${repo}`);
  const site = await current.json();
  if (site.source?.branch !== branch || site.source?.path !== "/") {
    const res = await gh(token, `/repos/${owner}/${repo}/pages`, { method: "PUT", body: JSON.stringify({ source }) });
    if (!res.ok) await fail(res, `fix Pages source on ${repo}`);
    await res.body?.cancel();
  }
  const build = await gh(token, `/repos/${owner}/${repo}/pages/builds`, { method: "POST" });
  await build.body?.cancel();
}

// Only a failure of a build started by this sync counts; an older failed build is just history.
async function lastBuildError(token: string, owner: string, repo: string, since: number): Promise<string | null> {
  const res = await gh(token, `/repos/${owner}/${repo}/pages/builds/latest`);
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const build = await res.json();
  if (build.status !== "errored" || new Date(build.created_at).getTime() < since) return null;
  return build.error?.message ?? "Pages build failed";
}

export async function publishPage(token: string, owner: string, repo: string, description: string, html: string): Promise<void> {
  const branch = await ensureRepo(token, owner, repo, description);
  // .nojekyll makes GitHub publish the HTML as-is instead of running Jekyll, which fails on some repos.
  await putFile(token, owner, repo, branch, ".nojekyll", "");
  await putFile(token, owner, repo, branch, "index.html", html);
  await ensurePages(token, owner, repo, branch);
}

// deno-lint-ignore no-explicit-any
export async function recordPageSync(db: any, studentId: string, result: SyncResult): Promise<void> {
  const { error } = await db.from("student_pages").upsert({
    student_id: studentId,
    version: result.status === "ok" ? PAGES_VERSION : 0,
    status: result.status,
    detail: result.detail.slice(0, 500),
    synced_at: new Date().toISOString(),
  });
  if (error) console.error("recordPageSync:", error.message);
}

// ── Sync one student ─────────────────────────────────────────────────────────

type PageReport = (agent: string, state: "working" | "done" | "failed", text: string) => Promise<void>;
const noReport: PageReport = async () => {};

// `report` feeds the Day 2 agents on the web page: atlas, forge, pixel, link, beacon, scout.
export async function syncStudentPages(token: string, payhipLink: string | null, report: PageReport = noReport): Promise<SyncResult> {
  await report("atlas", "working", "Signing in to your GitHub account…");
  const me = await gh(token, "/user");
  if (me.status === 401) {
    await me.body?.cancel();
    await report("atlas", "failed", "GitHub access was removed — tap the GitHub link in Telegram again.");
    return { status: "token_revoked", detail: "GitHub access was removed — the student must reconnect GitHub" };
  }
  if (!me.ok) {
    await report("atlas", "failed", "GitHub didn't answer — please try again in a minute.");
    return { status: "error", detail: `GitHub /user → ${me.status}` };
  }
  const username: string = (await me.json()).login;
  await report("atlas", "done", `Connected to GitHub as @${username}.`);

  const startedAt = Date.now() - 5_000;
  let stage = "forge";
  try {
    await report("forge", "working", `Preparing your two repositories on @${username}…`);
    const branches = {
      normal: await ensureRepo(token, username, PAGE_REPOS.normal, "EEM26 Sales Page"),
      premium: await ensureRepo(token, username, PAGE_REPOS.premium, "EEM26 Premium Sales Page"),
    };
    await report("forge", "done", `Repositories ${PAGE_REPOS.normal} and ${PAGE_REPOS.premium} are ready and public.`);

    stage = "pixel";
    await report("pixel", "working", "Designing your normal and premium sales pages…");
    const html = buildPages(payhipLink);
    await report("pixel", "done", "Both pages designed — Liquid Glass look, real student results and proof videos.");

    stage = "link";
    await report("link", "working", "Wiring every buy button to your link…");
    const buttons = (html.normal.match(/buy-trigger/g)?.length ?? 0) + (html.premium.match(/buy-trigger/g)?.length ?? 0);
    await report(
      "link",
      "done",
      payhipLink ? `${buttons} buy buttons now send buyers to your link: ${payhipLink}` : `${buttons} buy buttons wired — your own Payhip link is added on Day 3.`
    );

    stage = "beacon";
    await report("beacon", "working", "Publishing both pages to the internet…");
    for (const kind of ["normal", "premium"] as const) {
      const repo = PAGE_REPOS[kind];
      await putFile(token, username, repo, branches[kind], ".nojekyll", "");
      await putFile(token, username, repo, branches[kind], "index.html", html[kind]);
      await ensurePages(token, username, repo, branches[kind]);
    }
    await report("beacon", "done", "Published on GitHub Pages with a secure HTTPS address.");

    stage = "scout";
    await report("scout", "working", "Inspecting both pages for errors…");
    for (const repo of Object.values(PAGE_REPOS)) {
      const err = await lastBuildError(token, username, repo, startedAt);
      if (err) {
        const unverified = /verif/i.test(err) && /email/i.test(err);
        await report("scout", "failed", unverified ? "GitHub needs you to verify your email first — check your inbox." : `GitHub reported a problem: ${err}`);
        return { status: unverified ? "email_unverified" : "error", detail: `${repo}: ${err}`, username };
      }
    }
    await report("scout", "done", "No errors found — both pages pass inspection.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unverified = /verif/i.test(msg) && /email/i.test(msg);
    await report(stage, "failed", unverified ? "GitHub needs you to verify your email first — check your inbox." : "GitHub hit a problem — Amara has been alerted.");
    return { status: unverified ? "email_unverified" : "error", detail: msg.slice(0, 400), username };
  }

  return {
    status: "ok",
    detail: "published",
    username,
    normalUrl: `https://${username.toLowerCase()}.github.io/${PAGE_REPOS.normal}/`,
    premiumUrl: `https://${username.toLowerCase()}.github.io/${PAGE_REPOS.premium}/`,
  };
}

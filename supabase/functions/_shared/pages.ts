// Builds, publishes and repairs students' two GitHub Pages sales pages.
// Used by github-oauth (first setup / reconnect) and the cron (repairing 404s, rolling out new designs).
import { NORMAL_TEMPLATE } from "../github-oauth/normal_template.ts";
import { PREMIUM_TEMPLATE } from "../github-oauth/premium_template.ts";
import { LIQUID_GLASS_CSS } from "./liquid-glass.ts";

// Bump when the page design changes — the cron re-publishes every student's pages.
export const PAGES_VERSION = 2;

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

async function putIndex(token: string, owner: string, repo: string, branch: string, html: string): Promise<void> {
  const path = `/repos/${owner}/${repo}/contents/index.html`;
  const existing = await gh(token, `${path}?ref=${encodeURIComponent(branch)}`);
  const sha = existing.ok ? (await existing.json()).sha : (await existing.body?.cancel(), undefined);
  const res = await gh(token, path, {
    method: "PUT",
    body: JSON.stringify({ message: "Update sales page", content: toBase64(html), branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) await fail(res, `upload ${repo}/index.html`);
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

async function lastBuildError(token: string, owner: string, repo: string): Promise<string | null> {
  const res = await gh(token, `/repos/${owner}/${repo}/pages/builds/latest`);
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const build = await res.json();
  return build.status === "errored" ? (build.error?.message ?? "Pages build failed") : null;
}

export async function publishPage(token: string, owner: string, repo: string, description: string, html: string): Promise<void> {
  const branch = await ensureRepo(token, owner, repo, description);
  await putIndex(token, owner, repo, branch, html);
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

export async function syncStudentPages(token: string, payhipLink: string | null): Promise<SyncResult> {
  const me = await gh(token, "/user");
  if (me.status === 401) {
    await me.body?.cancel();
    return { status: "token_revoked", detail: "GitHub access was removed — the student must reconnect GitHub" };
  }
  if (!me.ok) return { status: "error", detail: `GitHub /user → ${me.status}` };
  const username: string = (await me.json()).login;

  try {
    const html = buildPages(payhipLink);
    await publishPage(token, username, PAGE_REPOS.normal, "EEM26 Sales Page", html.normal);
    await publishPage(token, username, PAGE_REPOS.premium, "EEM26 Premium Sales Page", html.premium);

    for (const repo of Object.values(PAGE_REPOS)) {
      const err = await lastBuildError(token, username, repo);
      if (err) {
        const unverified = /verif/i.test(err) && /email/i.test(err);
        return { status: unverified ? "email_unverified" : "error", detail: `${repo}: ${err}`, username };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unverified = /verif/i.test(msg) && /email/i.test(msg);
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

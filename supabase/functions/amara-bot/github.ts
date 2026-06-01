// GitHub OAuth URL builder — used by day2.ts to send the authorization link to students.
// All the GitHub API work (repo creation, file upload, Pages enable) runs inside
// the github-oauth Edge Function which is self-contained.

const GITHUB_CLIENT_ID = Deno.env.get("GITHUB_OAUTH_CLIENT_ID") ?? "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";

export function buildGitHubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope:     "repo",
    state:     state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

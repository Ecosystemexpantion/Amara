// Builds web/premium.html (the Premium Tech Stack sales page) from web/premium.src.html,
// inlining the Lucide icons, and the bundle Amara publishes: supabase/functions/_shared/premium-page.ts.
// Run after editing the page: deno run -A scripts/build-premium.ts
const src = await Deno.readTextFile(new URL("../web/premium.src.html", import.meta.url));
const icons = await Deno.readTextFile(new URL("../web/icons-premium.js", import.meta.url));
const html = src.replace("/*ICONS*/", icons.trim());
await Deno.writeTextFile(new URL("../web/premium.html", import.meta.url), html);
await Deno.writeTextFile(
  new URL("../supabase/functions/_shared/premium-page.ts", import.meta.url),
  "// Generated from web/premium.src.html by scripts/build-premium.ts — edit the source, then re-run the script.\n" +
    `export const PREMIUM_PAGE_HTML = ${JSON.stringify(html)};\n`
);
console.log(`premium.html written (${html.length} chars)`);

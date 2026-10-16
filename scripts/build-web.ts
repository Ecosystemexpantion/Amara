// Regenerates supabase/functions/_shared/web-page.ts from web/amara.html.
// Run after editing the page: deno run -A scripts/build-web.ts
const html = await Deno.readTextFile(new URL("../web/amara.html", import.meta.url));
const out =
  "// Generated from web/amara.html by scripts/build-web.ts — edit the HTML, then re-run the script.\n" +
  `export const AMARA_WEB_HTML = ${JSON.stringify(html)};\n`;
await Deno.writeTextFile(new URL("../supabase/functions/_shared/web-page.ts", import.meta.url), out);
console.log(`web-page.ts written (${html.length} chars)`);

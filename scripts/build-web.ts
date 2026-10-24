// Regenerates the published pages bundled into the functions:
//   web/amara.html → supabase/functions/_shared/web-page.ts  (the EEM26 web app)
//   web/chat.html  → supabase/functions/_shared/chat-page.ts (each student's AI sales assistant chat)
// Run after editing a page: deno run -A scripts/build-web.ts
const pages = [
  { src: "../web/amara.html", out: "../supabase/functions/_shared/web-page.ts", name: "AMARA_WEB_HTML" },
  { src: "../web/chat.html", out: "../supabase/functions/_shared/chat-page.ts", name: "SRE_CHAT_HTML" },
];
for (const p of pages) {
  const html = await Deno.readTextFile(new URL(p.src, import.meta.url));
  const out =
    `// Generated from ${p.src.replace("../", "")} by scripts/build-web.ts — edit the HTML, then re-run the script.\n` +
    `export const ${p.name} = ${JSON.stringify(html)};\n`;
  await Deno.writeTextFile(new URL(p.out, import.meta.url), out);
  console.log(`${p.out.split("/").pop()} written (${html.length} chars)`);
}

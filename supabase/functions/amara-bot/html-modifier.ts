// Transforms the EEM26 coach's sales page HTML into a student-personalized version.
// The coach's pages use a Paystack payment modal. For students, we replace all
// buy buttons with direct links to their Payhip store (students sell via Payhip).
export function modifyTemplateForStudent(html: string, payhipLink: string): string {
  let out = html;

  // 1. Remove Paystack CDN script tag
  out = out.replace(
    /<script[^>]*src=["'][^"']*paystack[^"']*["'][^>]*><\/script>/gi,
    ""
  );

  // 2. Remove EmailJS CDN script tag
  out = out.replace(
    /<script[^>]*src=["'][^"']*emailjs[^"']*["'][^>]*><\/script>/gi,
    ""
  );

  // 3. Remove the payment modal div (pay-modal or payOverlay)
  out = out.replace(
    /<div[^>]*id=["'](pay-modal|payOverlay)["'][^>]*>[\s\S]*?<\/div>\s*(?=\n|<script|<\/body)/g,
    ""
  );

  // 4. Convert all buy-trigger anchor tags: replace href="#" with payhip link and remove buy-trigger class
  // Pattern: <a ... href="#" ... class="... buy-trigger ..." ...>
  out = out.replace(
    /<a([^>]*?)href=["']#["']([^>]*?)>/gi,
    (match, before, after) => {
      // Only convert if it's a buy-trigger or dl-btn or float-btn
      if (/buy-trigger|dl-btn|float-btn/i.test(before + after)) {
        const combined = (before + after)
          .replace(/\bonclick=["'][^"']*["']/gi, "")
          .replace(/\bbuy-trigger\b/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        return `<a href="${payhipLink}" target="_blank" rel="noopener noreferrer"${combined ? " " + combined : ""}>`;
      }
      return match;
    }
  );

  // 5. Remove the JavaScript modal functions and Paystack initialization blocks
  // These are in a <script> tag at the bottom of the page
  out = out.replace(
    /\/\/\s*Intercept createElement[\s\S]*?\}\s*\}\s*\)\s*\(\s*\)\s*;/g,
    ""
  );

  // Remove openPayModal / closePayModal / initiatePaystack functions
  out = out.replace(
    /function\s+(?:openPayModal|closePayModal|initiatePaystack)\s*\([\s\S]*?\n\}/g,
    ""
  );

  // Remove payOverlay click handler and payNowBtn listener blocks
  out = out.replace(
    /(?:payOverlay|payNowBtn|payModalClose|document\.getElementById\(['"](pay-modal|payOverlay)['"]\))[\s\S]*?;(?:\s*\n)/g,
    ""
  );

  // Remove emailjs.init line
  out = out.replace(/emailjs\.init\([^)]*\);?\s*\n?/g, "");

  // Remove the buy-trigger querySelectorAll event listener block
  out = out.replace(
    /document\.querySelectorAll\(['"]\.buy-trigger['"]\)[\s\S]*?\}\s*\)\s*;/g,
    ""
  );

  // 6. Add a simple redirect script to ensure all buy clicks go to payhip
  const redirectScript = `
<script>
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('.buy-trigger,.dl-btn,.float-btn,.nav-btn').forEach(function(el){
    el.href="${payhipLink}";
    el.target="_blank";
    el.onclick=null;
  });
});
</script>`;

  out = out.replace("</body>", redirectScript + "\n</body>");

  return out;
}

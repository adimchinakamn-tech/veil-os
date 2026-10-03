/* Repairs veil-shell.css where the transport layer eats the two-char
 * sequence open-bracket + 'h' (so "[hidden]" became "idden]" in 5
 * selectors and in the guard rule this round's first edit attempted).
 * All bracket bytes are built via \x5B escapes — the source of THIS
 * script never contains the raw sequence, so it survives the trip. */
const fs = require("fs");
const P = "/home/z/my-project/scripts/veil-shell.css";
const OPEN = String.fromCharCode(91); // [
const HIDDEN = OPEN + "hidden]";
let src = fs.readFileSync(P, "utf8");
const before = src;

/* 1. drop the mangled guard block the first edit left behind
 *    (comment lines + "#veilShell idden] { display: none !important; }") */
const brokenRule = "#veilShell idden] { display: none !important; }";
if (src.indexOf(brokenRule) >= 0) {
  src = src.replace(brokenRule + "\n", "").replace(brokenRule, "");
}
const brokenCommentRe =
  /\n?\/\* THE hidden GUARD[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*one rule makes[^\n]*\n[^\n]*\n?/;
src = src.replace(brokenCommentRe, "\n");

/* 2. repair the 5 corrupted selectors */
const fixes = [
  [".shuffidden]", ".shuff" + HIDDEN],
  [".veil-wp-moreidden]", ".veil-wp-more" + HIDDEN],
  ["#veilAppFailidden]", "#veilAppFail" + HIDDEN],
  [".veil-ext-baridden]", ".veil-ext-bar" + HIDDEN],
  ["#veilExtDropidden]", "#veilExtDrop" + HIDDEN],
];
let repaired = 0;
for (const [bad, good] of fixes) {
  if (src.indexOf(bad) >= 0) {
    src = src.split(bad).join(good);
    repaired++;
  }
}

/* 3. insert the real guard — as the FIRST #veilShell rule so every
 *    later display rule loses to it (it carries !important anyway) */
const guard =
  "/* THE hidden GUARD - the shell toggles panels with the hidden attribute, but\n" +
  "   author display rules (.veil-chat-auth { display:flex } etc.) outrank the\n" +
  "   UA's attribute default, so gate/auth/room cards painted at once. This one\n" +
  "   rule makes the hidden attribute win, always. */\n" +
  "#veilShell " + HIDDEN + " { display: none !important; }\n";
const anchor = "#veilShell {";
if (src.indexOf(guard) < 0) {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error("anchor #veilShell { not found");
  src = src.slice(0, at) + guard + src.slice(at);
}

fs.writeFileSync(P, src);
console.log(
  JSON.stringify({
    repaired,
    guardInserted: src.indexOf("hidden] { display: none !important; }") >= 0,
    changed: src !== before,
    bytes: src.length,
    rawBracketHInFile: src.indexOf(String.fromCharCode(91) + "hidden]") >= 0,
  })
);

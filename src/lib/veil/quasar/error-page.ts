/**
 * Quasar Error Pages
 * ------------------
 * Branded, self-contained error pages rendered when the proxy fails to
 * reach a target. Served from the /p/ scope so they appear inside the
 * proxied iframe.
 */

import { QUASAR_VERSION } from "./version";

export function errorPageHtml(status: number, message: string, target: string, hint = ""): string {
  const safeTarget = target
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const safeMessage = message.replace(/</g, "&lt;");
  const safeHint = hint.replace(/</g, "&lt;");
  const safeVersion = QUASAR_VERSION.replace(/[^a-zA-Z0-9.\-]/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} — Quasar</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #09090b;
    color: #e4e4e7;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 560px;
    background: rgba(24, 24, 27, 0.85);
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 40px 36px;
    text-align: center;
    box-shadow: 0 24px 80px rgba(0,0,0,.5);
  }
  .orb {
    width: 64px; height: 64px; margin: 0 auto 20px;
    border-radius: 50%;
    background: conic-gradient(from 120deg, #7c3aed, #d946ef, #f59e0b, #7c3aed);
    filter: blur(0.5px);
    opacity: .9;
    animation: spin 6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 20px; font-weight: 700; letter-spacing: .02em; }
  .code {
    display: inline-block; margin: 14px 0 6px;
    font-size: 13px; font-weight: 700; color: #f0abfc;
    background: rgba(217, 70, 239, .12);
    border: 1px solid rgba(217, 70, 239, .3);
    padding: 3px 10px; border-radius: 999px;
    letter-spacing: .06em;
  }
  p.msg { margin-top: 14px; font-size: 14px; color: #a1a1aa; line-height: 1.6; }
  .target {
    margin-top: 18px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: #71717a;
    background: #131316;
    border: 1px solid #232326;
    border-radius: 8px;
    padding: 10px 12px;
    word-break: break-all;
    text-align: left;
  }
  .hint { margin-top: 10px; font-size: 13px; color: #d4d4d8; }
  .actions { margin-top: 26px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  button {
    cursor: pointer;
    font: inherit; font-size: 14px; font-weight: 600;
    padding: 10px 20px; border-radius: 10px;
    border: 1px solid #3f3f46;
    background: #18181b; color: #e4e4e7;
    transition: all .15s ease;
  }
  button:hover { border-color: #7c3aed; color: #fff; }
  button.primary {
    background: linear-gradient(135deg, #7c3aed, #a855f7);
    border: none; color: #fff;
  }
  button.primary:hover { filter: brightness(1.1); }
  .foot { margin-top: 26px; font-size: 11px; color: #52525b; letter-spacing: .12em; text-transform: uppercase; }
  .copied { color: #34d399 !important; }
</style>
</head>
<body>
  <main class="card">
    <div class="orb" aria-hidden="true"></div>
    <h1>Quasar couldn't load this page</h1>
    <span class="code">HTTP ${status}</span>
    <p class="msg">${safeMessage}</p>
    ${safeHint ? `<p class="hint">${safeHint}</p>` : ""}
    <div class="target">${safeTarget}</div>
    <div class="actions">
      <button class="primary" onclick="location.reload()">Retry</button>
      <button onclick="window.top.location.href='/'">Quasar Home</button>
      <button id="q-copy" onclick="return (function(b){try{navigator.clipboard.writeText(document.querySelector('.target').textContent+'\\n'+document.querySelector('p.msg').textContent).then(function(){b.textContent='Copied!';b.classList.add('copied');setTimeout(function(){b.textContent='Copy details';b.classList.remove('copied');},1600);});}catch(e){}return false;})(this)">Copy details</button>
    </div>
    <div class="foot">Quasar Proxy Engine v${safeVersion}</div>
  </main>
</body>
</html>`;
}

export function errorPageResponse(status: number, message: string, target: string, hint = ""): Response {
  return new Response(errorPageHtml(status, message, target, hint), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-quasar-error": "1",
    },
  });
}

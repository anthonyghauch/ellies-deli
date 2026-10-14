/* Ellie's Deli — shared helpers. Loaded after config.js on every page. */

const API_URL = String(window.ELLIES_API || '').trim();
const DEMO_MODE = !API_URL;

/**
 * Call a backend function. Demo mode uses the page's window.DEMO fake backend instead.
 * Google sometimes fails to hand back a finished answer (404/5xx), so retry a couple of times.
 * Every backend call is safe to repeat (placeOrder dedupes by requestId).
 */
async function call(fn, ...args) {
  if (DEMO_MODE) return window.DEMO[fn](...args);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 700 * attempt));
    let res;
    try {
      // text/plain body = "simple" request, so Apps Script needs no CORS preflight
      res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ fn, args }) });
    } catch (e) {
      lastError = new Error("Can't reach the server. Check your connection and try again.");
      continue;
    }
    if (!res.ok) { lastError = new Error('Server error (' + res.status + '). Please try again.'); continue; }
    let data;
    try { data = await res.json(); } catch (e) { lastError = new Error('Server sent a bad reply. Please try again.'); continue; }
    if (!data.ok) throw new Error(data.error || 'Something went wrong');
    return data.result;
  }
  throw lastError;
}

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function storage(kind) {
  return {
    get(k) { try { return window[kind].getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { window[kind].setItem(k, v); } catch (e) {} },
    del(k) { try { window[kind].removeItem(k); } catch (e) {} },
  };
}

/* ---- Home-screen app: Chrome/Edge get the browser's install prompt, iPhone and Mac Safari get the steps ---- */
const APP = (() => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  return {
    ios, android, prompt: null,
    phone: ios || android,
    // Safari on a Mac can "Add to Dock" (no install prompt there, so we show the steps)
    macSafari: !ios && /Macintosh/.test(ua) && /Version\/[\d.]+ Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua),
    // Chrome, Edge & co. on a computer can install it as an app (Firefox can't)
    desktopChrome: !ios && !android && /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox/.test(ua),
    installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    // Instagram, GroupMe & co. open links in their own browser, which can't add to the home screen
    inApp: /FBAN|FBAV|Instagram|GroupMe|Snapchat|LinkedInApp|Line\//.test(ua) || (ios && !/Safari\//.test(ua)) || (android && /; wv\)/.test(ua)),
  };
})();
const SHARE_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>';

/** Can we offer to install here? (Firefox on a computer can't install apps.) */
APP.offer = () => !APP.installed && (APP.phone || APP.macSafari || APP.desktopChrome || !!APP.prompt);

// Chrome / Edge: keep their install prompt for our own button instead of their banner
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); APP.prompt = e; });

/** Show the browser's install prompt. true = installed, false = declined, null = no prompt here (show the steps). */
async function promptInstall() {
  const p = APP.prompt;
  if (!p) return null;
  APP.prompt = null;
  p.prompt();
  try { return (await p.userChoice).outcome === 'accepted'; } catch (e) { return false; }
}

/** How to install `name` on this device, as HTML. */
function installSteps(name) {
  if (APP.inApp) return `<p>Open this page in ${APP.ios ? 'Safari' : 'Chrome'} first</p>
    This app's built-in browser can't add it. Tap the <b>⋯</b> menu, choose <b>Open in ${APP.ios ? 'Safari' : 'browser'}</b>, then try again.`;
  if (APP.ios) return `<p>On iPhone</p><ol>
    <li>Tap the <b>Share</b> button ${SHARE_ICON}. In Safari it's at the bottom of the screen (or under <b>⋯</b>).</li>
    <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
    <li>Tap <b>Add</b>. ${name} shows up next to your apps.</li></ol>`;
  if (APP.macSafari) return `<p>On a Mac (Safari)</p><ol>
    <li>In the menu bar at the top of the screen, click <b>File</b>.</li>
    <li>Click <b>Add to Dock</b>, then <b>Add</b>. ${name} shows up in your Dock.</li></ol>`;
  if (!APP.android) return `<p>On a computer (Chrome or Edge)</p><ol>
    <li>Click the <b>install</b> icon at the right end of the address bar.</li>
    <li>No icon? Open the browser menu (<b>⋮</b> or <b>⋯</b>). In Chrome: <b>Cast, save and share</b>, then <b>Install page as app</b>. In Edge: <b>Apps</b>, then <b>Install this site as an app</b>.</li>
    <li>Click <b>Install</b>. ${name} opens in its own window.</li></ol>`;
  return `<p>On Android</p><ol>
    <li>Tap the browser menu <b>⋮</b> (top right).</li>
    <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
    <li>Tap <b>Install</b>. ${name} shows up next to your apps.</li></ol>`;
}

if (DEMO_MODE) {
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.textContent = "Demo mode: fake data, nothing is saved. Paste your Google link into config.js to go live.";
  document.body.prepend(bar);
}

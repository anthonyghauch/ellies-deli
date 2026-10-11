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

if (DEMO_MODE) {
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.textContent = "Demo mode: fake data, nothing is saved. Paste your Google link into config.js to go live.";
  document.body.prepend(bar);
}

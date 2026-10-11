/**
 * Ellie's Deli — backend (Google Apps Script).
 *
 * The website (site/ folder, hosted on GitHub Pages) talks to this script through doPost().
 * All data lives in one Google Sheet inside a Google Drive folder ("Ellie's Deli"):
 *   Dashboard    — revenue, orders & sandwiches per night, most popular items, charts
 *   Orders       — one row per order (night, customer, items, total, Paid / Ready checkboxes)
 *   Order Items  — one row per item ordered (feeds the popularity stats)
 *   Menu         — items, prices, ingredients, Available checkbox (also switchable from the admin page)
 *
 * The admin PIN is NOT stored in this file (the code is public on GitHub).
 * Set it in Apps Script: Project Settings → Script properties → ADMIN_PIN.
 */

const CONFIG = {
  NAME: "Ellie's Deli",
  FOLDER_NAME: "Ellie's Deli",
  FOLDER_ID: '',                     // optional: ID of an existing Drive folder to keep the sheet in
  SPREADSHEET_NAME: "Ellie's Deli — Orders",
  NIGHT_CUTOFF_HOUR: 6,              // orders placed before 6am count toward the previous night
  PAYMENT_METHODS: ['Card', 'Cash'],
  PAYMENT_NOTE: 'Pay by card or cash when you pick up in the basement.',
  MAX_QTY_PER_ITEM: 5,               // more than 5 of the same item = order in person
  READY_EMAIL: true,                 // email the customer when you tick Ready
  READY_MESSAGE: 'Come down to the basement to pick it up.',
};

const ORDER_HEADERS = ['Order ID', 'Placed at', 'Night', 'Name', 'Room', 'Email', 'Items',
  'Sandwiches', 'Total', 'Payment', 'Notes', 'Paid', 'Ready', 'Ready email sent'];
const ITEM_HEADERS = ['Order ID', 'Night', 'Item', 'Category', 'Qty', 'Unit price', 'Line total'];
const MENU_HEADERS = ['Item', 'Category', 'Price', 'Available', 'Description'];
const COL = { EMAIL: 6, PAID: 12, READY: 13, NOTIFIED: 14 };
const MENU_COL = { AVAILABLE: 4 };

const SEED_MENU = [
  ['The Classic', 'Sandwiches', 1, true, 'Colby Jack'],
  ['The Porky', 'Sandwiches', 2, true, 'Colby Jack, Bacon Bits'],
  ['The Piggy', 'Sandwiches', 2, true, 'Colby Jack, Pepperoni'],
  ['The Hammy', 'Sandwiches', 2, true, 'Colby Jack, Ham'],
  ['The Jack', 'Sandwiches', 2, true, 'Pepper Jack, Pepperoni, Jalapeños'],
  ['The Deece', 'Sandwiches', 3, true, 'Colby Jack, Havarti, Ham, Bacon Bits'],
  ['The Frad', 'Sandwiches', 3, true, 'Colby Jack, Pepper Jack, Ham, Bacon Bits, Jalapeños'],
  ['The Kitchen Sink', 'Sandwiches', 4, true, 'Colby Jack, Pepper Jack, Havarti, Bacon Bits, Pepperoni, Ham, Jalapeños'],
  ['The Nutellie', 'Sandwiches', 1, true, 'Toasted Nutella'],
  ['The Duke', 'Sandwiches', 2, true, 'Toasted Nutella, Bacon Bits'],
  ['Soda', 'Drinks', 1, true, ''],
  ['Arnold Palmer / Arizona Iced Tea', 'Drinks', 1, true, ''],
  ['Gatorade', 'Drinks', 1, true, ''],
  ['Celsius', 'Drinks', 2, true, ''],
];

/* --------------------------------------------------------------------- API */

// Everything the website is allowed to call.
const API = {
  getMenu, placeOrder, getOrderStatus,
  checkPin, getOrders, setOrderFlag, setOpen, getSheetUrl, getAdminMenu, setItemAvailable,
};

/** The website sends POST {fn, args} as plain text (no CORS preflight) and gets JSON back. */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = Object.prototype.hasOwnProperty.call(API, req.fn) ? API[req.fn] : null;
    if (!fn) throw new Error('Unknown action');
    out = { ok: true, result: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
  }
  return json_(out);
}

function doGet() {
  return json_({ ok: true, result: CONFIG.NAME + ' API is running' });
}

/** Run this once from the editor to create the Drive folder + spreadsheet. */
function setup() {
  const ss = getSpreadsheet_();
  Logger.log('Spreadsheet ready: ' + ss.getUrl());
  if (!adminPin_()) Logger.log('Now set ADMIN_PIN in Project Settings → Script properties.');
  return ss.getUrl();
}

/** Run from the editor to check which address the "order ready" emails come from. */
function sendTestEmail() {
  const me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: me,
    subject: CONFIG.NAME + ' test email',
    body: 'It works! "Your order is ready" emails will be sent from ' + me + '.',
    name: CONFIG.NAME,
  });
  Logger.log('Test email sent to ' + me);
}

/* ---------------------------------------------------------- customer calls */

function getMenu() {
  return {
    open: isOpen_(),
    items: readMenu_().map(m => ({
      name: m.name, category: m.category, price: m.price, description: m.description, available: m.available,
    })),
    paymentMethods: CONFIG.PAYMENT_METHODS,
    paymentNote: CONFIG.PAYMENT_NOTE,
    maxQty: CONFIG.MAX_QTY_PER_ITEM,
  };
}

function placeOrder(order) {
  order = order || {};
  if (!isOpen_()) throw new Error("Sorry, we're not taking orders right now.");

  const name = clean_(order.name, 60);
  const room = clean_(order.room, 40);
  const email = clean_(order.email, 100).toLowerCase();
  const notes = clean_(order.notes, 300);
  if (!name) throw new Error('Please enter your name.');
  if (!room) throw new Error('Please enter your room.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email.');
  const payment = CONFIG.PAYMENT_METHODS.indexOf(order.payment) >= 0
    ? order.payment : CONFIG.PAYMENT_METHODS[0];

  // Prices always come from the Menu sheet, never from the browser.
  const menu = {};
  readMenu_().forEach(m => { menu[m.name] = m; });
  const lines = [];
  const soldOut = [];
  (order.items || []).forEach(it => {
    const m = menu[it && it.name];
    const qty = Math.min(Math.floor(Number(it && it.qty)), CONFIG.MAX_QTY_PER_ITEM);
    if (!m || !(qty > 0)) return;
    if (!m.available) { soldOut.push(m.name); return; }
    lines.push({ name: m.name, category: m.category, qty: qty, price: m.price });
  });
  if (soldOut.length) throw new Error('Sorry, ' + soldOut.join(' and ') + ' just sold out. Please update your order.');
  if (!lines.length) throw new Error('Your order is empty.');

  const total = round2_(lines.reduce((s, l) => s + l.qty * l.price, 0));
  const sandwiches = lines.filter(l => isSandwich_(l.category)).reduce((s, l) => s + l.qty, 0);
  const itemsText = lines.map(l => l.qty + '× ' + l.name).join(', ');

  // The website retries when Google drops a reply; the same requestId must not create a second order.
  const requestId = clean_(order.requestId, 64);
  const cache = CacheService.getScriptCache();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const already = requestId && cache.get('req_' + requestId);
    if (already) return JSON.parse(already);

    const ss = getSpreadsheet_();
    const now = new Date();
    const night = serviceNight_(now);
    const nightKey = fmt_(night, 'yyyyMMdd');
    const orders = ss.getSheetByName('Orders');
    const row = orders.getLastRow() + 1;

    // Tonight's next number: the higher of our counter and what's already in the sheet,
    // so numbering keeps going if the script is ever moved to another Google account.
    const props = PropertiesService.getScriptProperties();
    let maxSoFar = Number(props.getProperty('SEQ_' + nightKey) || 0);
    if (row > 2) {
      orders.getRange(2, 1, row - 2, 1).getValues().forEach(([v]) => {
        const s = String(v);
        if (s.indexOf(nightKey + '-') === 0) maxSoFar = Math.max(maxSoFar, Number(s.split('-')[1]) || 0);
      });
    }
    const number = maxSoFar + 1;
    props.setProperty('SEQ_' + nightKey, String(number));
    const id = nightKey + '-' + number;
    orders.getRange(row, 1, 1, ORDER_HEADERS.length).setValues([[
      id, now, night, safe_(name), safe_(room), email, itemsText,
      sandwiches, total, payment, safe_(notes), false, false, '',
    ]]);
    orders.getRange(row, COL.PAID, 1, 2).insertCheckboxes();

    const items = ss.getSheetByName('Order Items');
    items.getRange(items.getLastRow() + 1, 1, lines.length, ITEM_HEADERS.length).setValues(
      lines.map(l => [id, night, l.name, l.category, l.qty, l.price, round2_(l.qty * l.price)]));

    SpreadsheetApp.flush();
    const result = { id: id, number: number, total: total, items: itemsText, payment: payment,
      email: email, paymentNote: CONFIG.PAYMENT_NOTE };
    if (requestId) cache.put('req_' + requestId, JSON.stringify(result), 21600);
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Polled by the customer's order page. Only reveals ready / paid, nothing personal. */
function getOrderStatus(id) {
  id = String(id || '');
  if (!/^\d{8}-\d+$/.test(id)) return null;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('st_' + id);
  if (hit) return JSON.parse(hit);
  const sh = getSpreadsheet_().getSheetByName('Orders');
  const cell = findOrder_(sh, id);
  if (!cell) return null;
  const v = sh.getRange(cell.getRow(), COL.PAID, 1, 2).getValues()[0];
  const status = { paid: v[0] === true, ready: v[1] === true };
  cache.put('st_' + id, JSON.stringify(status), 30);
  return status;
}

/* ------------------------------------------------------------- admin calls */

function checkPin(pin) {
  checkPin_(pin);
  return true;
}

/** Orders for one night (yyyy-MM-dd). Defaults to tonight. */
function getOrders(pin, night) {
  checkPin_(pin);
  const target = night || fmt_(serviceNight_(new Date()), 'yyyy-MM-dd');
  const sh = getSpreadsheet_().getSheetByName('Orders');
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, ORDER_HEADERS.length).getValues();
  const orders = rows
    .filter(r => r[0] && toDay_(r[2]) === target)
    .map(r => ({
      id: String(r[0]),
      number: Number(String(r[0]).split('-')[1]) || 0,
      time: r[1] instanceof Date ? fmt_(r[1], 'h:mm a') : String(r[1]),
      name: String(r[3]), room: String(r[4]), email: String(r[5]),
      items: String(r[6]), sandwiches: Number(r[7]) || 0, total: Number(r[8]) || 0,
      payment: String(r[9]), notes: String(r[10]),
      paid: r[11] === true, ready: r[12] === true, notified: !!r[13],
    }));
  return { night: target, open: isOpen_(), orders: orders };
}

/**
 * field is 'paid' or 'ready'. Ticking Ready emails the customer (once per order).
 * Returns { emailed, emailError }.
 */
function setOrderFlag(pin, id, field, value) {
  checkPin_(pin);
  const col = field === 'paid' ? COL.PAID : field === 'ready' ? COL.READY : 0;
  if (!col) throw new Error('Unknown field');
  value = value === true;
  const sh = getSpreadsheet_().getSheetByName('Orders');
  const cell = findOrder_(sh, id);
  if (!cell) throw new Error('Order not found: ' + id);
  const row = cell.getRow();
  sh.getRange(row, col).setValue(value);

  const r = sh.getRange(row, 1, 1, ORDER_HEADERS.length).getValues()[0];
  CacheService.getScriptCache().put('st_' + id,
    JSON.stringify({ paid: r[COL.PAID - 1] === true, ready: r[COL.READY - 1] === true }), 30);

  const result = { emailed: false, emailError: null };
  if (field === 'ready' && value && CONFIG.READY_EMAIL && !r[COL.NOTIFIED - 1]) {
    try {
      sendReadyEmail_(r);
      sh.getRange(row, COL.NOTIFIED).setValue(new Date());
      result.emailed = true;
    } catch (err) {
      result.emailError = err.message;
    }
  }
  return result;
}

function setOpen(pin, open) {
  checkPin_(pin);
  PropertiesService.getScriptProperties().setProperty('OPEN', open ? 'true' : 'false');
  return open === true;
}

function getSheetUrl(pin) {
  checkPin_(pin);
  return getSpreadsheet_().getUrl();
}

/** Full menu, including sold-out items, for the admin Menu tab. */
function getAdminMenu(pin) {
  checkPin_(pin);
  return readMenu_().map(m => ({ name: m.name, category: m.category, price: m.price, available: m.available }));
}

/** Mark a menu item available / sold out. Writes the Available checkbox in the Menu sheet. */
function setItemAvailable(pin, name, available) {
  checkPin_(pin);
  const sh = getSpreadsheet_().getSheetByName('Menu');
  const cell = sh.getRange('A2:A').createTextFinder(String(name)).matchEntireCell(true).findNext();
  if (!cell) throw new Error('Menu item not found: ' + name);
  sh.getRange(cell.getRow(), MENU_COL.AVAILABLE).setValue(available === true);
  return available === true;
}

/* ------------------------------------------------------------------ email */

function sendReadyEmail_(r) {
  const to = String(r[COL.EMAIL - 1]).trim();
  if (!to) throw new Error('no email on this order');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error("Google's daily email limit reached");
  const number = String(r[0]).split('-')[1];
  const first = String(r[3]).replace(/^'/, '').split(' ')[0];
  const total = '$' + Number(r[8]).toFixed(2);
  const body = 'Hi ' + first + ',\n\nYour order is ready! ' + CONFIG.READY_MESSAGE + '\n\n' +
    'Order #' + number + ': ' + r[6] + '\nTotal: ' + total + ' (' + r[9] + ')\n\n' +
    CONFIG.PAYMENT_NOTE + '\n\n' + CONFIG.NAME;
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;max-width:480px;color:#10261f">' +
    '<div style="background:#0f7a5f;color:#f3cb9c;padding:16px 20px;border-radius:12px 12px 0 0;' +
    'font:bold 22px Georgia,serif;letter-spacing:2px">' + esc_(CONFIG.NAME.toUpperCase()) + '</div>' +
    '<div style="border:1px solid #cde6dc;border-top:0;padding:20px;border-radius:0 0 12px 12px">' +
    '<div style="font-size:13px;color:#56706a">Order #' + esc_(number) + '</div>' +
    '<div style="font-size:24px;font-weight:bold;color:#0f7a5f;margin:4px 0 12px">Your order is ready!</div>' +
    '<p>Hi ' + esc_(first) + ', ' + esc_(CONFIG.READY_MESSAGE) + '</p>' +
    '<p style="background:#e8f4ef;padding:12px;border-radius:8px">' + esc_(r[6]) +
    '<br><b>Total: ' + total + '</b> · ' + esc_(r[9]) + '</p>' +
    '<p style="font-size:13px;color:#56706a">' + esc_(CONFIG.PAYMENT_NOTE) + '</p></div></div>';
  MailApp.sendEmail({
    to: to,
    subject: 'Your ' + CONFIG.NAME + ' order #' + number + ' is ready',
    body: body,
    htmlBody: htmlBody,
    name: CONFIG.NAME,
  });
}

/* ---------------------------------------------------------------- storage */

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      // Never quietly start a second spreadsheet: that would split the order history.
      throw new Error("Can't open the orders spreadsheet. Share it with " + Session.getEffectiveUser().getEmail() +
        ' (Editor), or delete SPREADSHEET_ID in Script properties to create a new one.');
    }
  }
  const ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  DriveApp.getFileById(ss.getId()).moveTo(getFolder_());
  buildSheets_(ss);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getFolder_() {
  if (CONFIG.FOLDER_ID) return DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
}

function buildSheets_(ss) {
  const dash = ss.getSheets()[0].setName('Dashboard');
  const orders = ss.insertSheet('Orders');
  const items = ss.insertSheet('Order Items');
  const menu = ss.insertSheet('Menu');

  writeHeader_(orders, ORDER_HEADERS);
  orders.getRange('B:B').setNumberFormat('ddd m/d h:mm am/pm');
  orders.getRange('C:C').setNumberFormat('ddd m/d/yyyy');
  orders.getRange('I:I').setNumberFormat('$0.00');
  orders.getRange('N:N').setNumberFormat('h:mm am/pm');
  orders.setColumnWidth(6, 200);
  orders.setColumnWidth(7, 320);
  orders.setColumnWidth(11, 220);

  writeHeader_(items, ITEM_HEADERS);
  items.getRange('B:B').setNumberFormat('ddd m/d/yyyy');
  items.getRange('F:G').setNumberFormat('$0.00');

  writeHeader_(menu, MENU_HEADERS);
  menu.getRange(2, 1, SEED_MENU.length, MENU_HEADERS.length).setValues(SEED_MENU);
  menu.getRange(2, MENU_COL.AVAILABLE, 200, 1).insertCheckboxes();
  menu.getRange(2, MENU_COL.AVAILABLE, SEED_MENU.length, 1).check();
  menu.getRange('C:C').setNumberFormat('$0.00');
  menu.setColumnWidth(1, 220);
  menu.setColumnWidth(5, 420);
  menu.getRange('G1').setValue('Tip: items whose Category starts with "Sandwich" count as sandwiches. ' +
    'Uncheck Available (or use the admin page) to mark an item sold out.')
    .setFontStyle('italic').setFontColor('#56706a');

  buildDashboard_(dash);
}

function buildDashboard_(dash) {
  const green = '#0f7a5f';
  dash.getRange('A1').setValue(CONFIG.NAME + ' — Dashboard').setFontSize(18).setFontWeight('bold').setFontColor(green);

  const kpis = [
    ['Total revenue', '=SUM(Orders!I2:I)', '$0.00'],
    ['Collected (paid)', '=SUMIF(Orders!L2:L,TRUE,Orders!I2:I)', '$0.00'],
    ['Still owed', '=B3-B4', '$0.00'],
    ['Orders', '=COUNTA(Orders!A2:A)', '0'],
    ['Sandwiches sold', '=SUM(Orders!H2:H)', '0'],
    ['Average order', '=IFERROR(B3/B6,0)', '$0.00'],
    ['Nights open', '=COUNTUNIQUE(Orders!C2:C)', '0'],
    ['Avg sandwiches / night', '=IFERROR(B7/B9,0)', '0.0'],
    ['Best seller', '=IFERROR(INDEX(I4:I,1),"—")', '@'],
  ];
  dash.getRange('A2').setValue('Totals').setFontWeight('bold');
  kpis.forEach((k, i) => {
    dash.getRange(3 + i, 1).setValue(k[0]);
    dash.getRange(3 + i, 2).setFormula(k[1]).setNumberFormat(k[2]).setFontWeight('bold');
  });
  dash.getRange(3, 1, kpis.length, 2).setBackground('#e8f4ef');

  dash.getRange('D2').setValue('By night').setFontWeight('bold');
  dash.getRange('D3').setFormula(
    "=QUERY(Orders!A2:M,\"select C, count(A), sum(H), sum(I) where A is not null group by C order by C desc " +
    "label C 'Night', count(A) 'Orders', sum(H) 'Sandwiches', sum(I) 'Revenue'\",0)");
  dash.getRange('D:D').setNumberFormat('ddd m/d/yyyy');
  dash.getRange('G:G').setNumberFormat('$0.00');

  dash.getRange('I2').setValue('Most popular items').setFontWeight('bold');
  dash.getRange('I3').setFormula(
    "=QUERY('Order Items'!A2:G,\"select C, sum(E), sum(G) where C is not null group by C order by sum(E) desc " +
    "label C 'Item', sum(E) 'Qty sold', sum(G) 'Revenue'\",0)");
  dash.getRange('K:K').setNumberFormat('$0.00');

  [dash.getRange('D3:G3'), dash.getRange('I3:K3')].forEach(r =>
    r.setFontWeight('bold').setBackground(green).setFontColor('#ffffff'));
  dash.setColumnWidth(1, 170);
  dash.setColumnWidth(4, 120);
  dash.setColumnWidth(9, 220);
  dash.setFrozenRows(1);

  const nightly = dash.newChart().asColumnChart()
    .addRange(dash.getRange('D3:D60'))
    .addRange(dash.getRange('F3:F60'))
    .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS)
    .setTitle('Sandwiches per night')
    .setColors([green])
    .setLegendPosition(Charts.Position.NONE)
    .setPosition(14, 1, 0, 0)
    .build();
  dash.insertChart(nightly);

  const popular = dash.newChart().asBarChart()
    .addRange(dash.getRange('I3:J13'))
    .setTitle('Top 10 items')
    .setColors([green])
    .setLegendPosition(Charts.Position.NONE)
    .setPosition(14, 6, 0, 0)
    .build();
  dash.insertChart(popular);
}

function writeHeader_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#0f7a5f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function readMenu_() {
  const sh = getSpreadsheet_().getSheetByName('Menu');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, MENU_HEADERS.length).getValues()
    .filter(r => String(r[0]).trim() && Number(r[2]) >= 0)
    .map(r => ({
      name: String(r[0]).trim(),
      category: String(r[1]).trim() || 'Other',
      price: round2_(Number(r[2]) || 0),
      available: r[3] === true,
      description: String(r[4] || '').trim(),
    }));
}

/* ---------------------------------------------------------------- helpers */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function findOrder_(sh, id) {
  return sh.getRange('A2:A').createTextFinder(String(id)).matchEntireCell(true).findNext();
}

function isOpen_() {
  return PropertiesService.getScriptProperties().getProperty('OPEN') !== 'false';
}

function adminPin_() {
  return String(PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '').trim();
}

/** Wrong PINs are counted; after 20 in a row the admin login locks for 15 minutes. */
function checkPin_(pin) {
  const real = adminPin_();
  if (!real) throw new Error('No admin PIN set yet. Add ADMIN_PIN in Apps Script → Project Settings → Script properties.');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pin_fails') || 0);
  if (fails >= 20) throw new Error('Too many wrong PINs. Try again in 15 minutes.');
  if (String(pin) !== real) {
    cache.put('pin_fails', String(fails + 1), 900);
    throw new Error('Wrong PIN');
  }
}

/** The night an order belongs to: anything before NIGHT_CUTOFF_HOUR rolls back a day. */
function serviceNight_(when) {
  const shifted = new Date(when.getTime() - CONFIG.NIGHT_CUTOFF_HOUR * 3600 * 1000);
  return Utilities.parseDate(fmt_(shifted, 'yyyy-MM-dd'), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isSandwich_(category) {
  return /^sandwich/i.test(String(category));
}

function toDay_(v) {
  return v instanceof Date ? fmt_(v, 'yyyy-MM-dd') : String(v);
}

function fmt_(date, pattern) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), pattern);
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Stop text like "=HYPERLINK(...)" or "+1 574..." being treated as a formula. */
function safe_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

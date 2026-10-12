# Ellie's Deli — online ordering

Grilled cheese & toasted sandwiches, ordered online. Customers scan a QR code, order on their phone, and get an email when it's ready. You run the kitchen from one compact admin page. Every order lands in a Google Sheet in your Google Drive.

Free to run: the website is hosted on **GitHub Pages**, and the backend runs on **Google Apps Script** with **Google Sheets** for data.

```
site/            the website (goes on GitHub Pages)
  index.html       customer page: menu, cart, checkout, live "your order is ready" screen
  admin.html       kitchen page: compact order rows (Paid / Ready), Menu tab (sold out on/off)
  poster.html      printable QR-code poster with the menu
  config.js        ← paste your Google Apps Script link here
  brand.css, common.js, favicon.svg
backend/         the Google side (copy into Apps Script)
  Code.gs          saves orders to Sheets, sends "ready" emails, builds the stats
  appsscript.json  project settings
```

Open `site/index.html` or `site/admin.html` straight from your computer to try them. Until `config.js` has a link they run in **demo mode** with fake data (demo PIN `1234`) and show a yellow banner.

## 1. Google backend (one time, about 10 minutes)

1. Go to **script.google.com**, then click **New project**. Name it "Ellie's Deli".
2. Replace everything in `Code.gs` with `backend/Code.gs`.
3. Open **Project Settings** (gear icon):
   - Turn on **Show "appsscript.json"**, then paste in `backend/appsscript.json`.
   - Under **Script properties**, add `ADMIN_PIN` with your kitchen PIN. Use 6 or more digits. The code is public on GitHub, so the PIN lives here instead of in the code.
4. Back in the editor, pick **setup** in the function dropdown, click **Run**, and allow the permissions it asks for (Sheets, Drive, email).
   This creates the Drive folder **Ellie's Deli**, with the spreadsheet **Ellie's Deli — Orders** inside it.
5. Click **Deploy**, then **New deployment**, then the gear icon, then **Web app**. Set Execute as **Me** and Who has access **Anyone**, then click **Deploy**. Copy the **Web app URL** (it ends in `/exec`).
6. Paste that URL into `site/config.js`:
   ```js
   window.ELLIES_API = 'https://script.google.com/macros/s/…/exec';
   ```
   Commit and push. The yellow demo banner disappears.

After changing `Code.gs` later, publish it with **Deploy**, then **Manage deployments**, then the edit icon, then **Version: New version**. This keeps the same URL.

**How it's set up today:** the Apps Script runs on the Notre Dame account (aghauch@nd.edu), so "order ready" emails come from that address, whichever admin ticks Ready. The spreadsheet lives in the personal Gmail Drive and is shared (Editor) with the ND account. The script finds it through the `SPREADSHEET_ID` script property.

**Before graduating** (ND accounts get closed): create the Apps Script project again on a personal account, paste `backend/Code.gs`, and set the `SPREADSHEET_ID` and `ADMIN_PIN` script properties. Then run `setup` (it reuses the existing sheet), deploy, and put the new `/exec` link in `site/config.js`. The spreadsheet doesn't move.

## 2. Website on GitHub Pages

1. In the GitHub repo, go to **Settings**, then **Pages**.
2. Under **Build and deployment**, choose **GitHub Actions**. The included workflow publishes the `site/` folder on every push.
3. The site goes live at `https://<your-username>.github.io/ellies-deli/`:
   - Customers: that address
   - Kitchen: `…/admin.html` (bookmark it on your phone)
   - Poster: `…/poster.html`

### Your own domain (optional, about $10–12 a year)

`elliesdeli.com` is taken. `ellies-deli.com`, `elliesdeli.net`, `elliesdeli.org` and `elliesdeli.app` were all free when checked.

1. Buy one (Porkbun, Namecheap or Cloudflare).
2. In the repo, go to **Settings**, then **Pages**, then **Custom domain**, and enter it (for example `ellies-deli.com`).
3. At the registrar, add the DNS records GitHub shows you, then tick **Enforce HTTPS**.

## 3. QR poster

Open `poster.html` on your live site. It fills in the site's address automatically, or you can paste another link. Scan the QR code with your phone to check it, then click **Print poster**. It prints one letter-size page: the logo, the QR code, how ordering works, and the full menu.

Tip: if the QR code points at your own domain, you can move the site later without reprinting.

## Running a night

- **Taking orders** switch (admin page): turn it on when you open and off when the kitchen closes. Customers then see "Kitchen's closed".
- **Orders tab**: one compact row per order, oldest first. It refreshes every 15 seconds, and new orders flash.
  - **Ready**: tick it when the order is made. The customer gets an email (✉ shows once it's sent, and only one is sent per order), and their order page switches to "Your order is ready!" with a chime.
  - **Paid**: tick it when they pay at pickup. The stats bar shows Collected and Owed.
  - **Done tab**: once an order is both Paid and Ready it moves from Orders to **Done**, so the Orders tab only shows what still needs doing. Untick a box in Done to send it back.
  - The **Unpaid** and **To make** filters, search, and the date picker let you look back at past nights.
- **Menu tab**: switch any item to **Sold out**. Customers see it greyed out straight away and can't order it. Prices, names and ingredients are edited in the **Menu** tab of the spreadsheet.
- **Delete an order** (trash icon at the end of its row): for cancelled or test orders. It asks first, then removes the order from the spreadsheet for good. If the customer still has their order page open, it switches to "Order cancelled".
- **Customers can cancel** from their order page until you tick **Ready** (or Paid). After that the button disappears and the backend refuses. Each order has a private cancel key, so nobody can cancel someone else's order. The kitchen page shows "Order #7 was cancelled by the customer" and drops it from the list.
- **Place in line**: while an order waits, the customer's page shows "3 orders ahead of you", then "You're next!". It counts tonight's earlier orders that aren't Ready yet, so ticking **Ready** moves the line forward for everyone.
- **Hungry Man deal** (switch at the top of the Menu tab): every 2 sandwiches + 1 drink takes $1 off, and it stacks (4 sandwiches + 2 drinks = $2 off). Customers see a banner, the discount in their cart, and a nudge like "Add a drink to save $1". The backend calculates the discount, so it can't be faked. It's saved in the **Discount** column of Orders, the order's Items text, and the Dashboard's "Hungry Man discounts" total. Change the rules with the `DEAL_*` settings in `Code.gs`.

## The spreadsheet (Google Drive → Ellie's Deli → Ellie's Deli — Orders)

- **Dashboard**: total revenue, collected vs. still owed, orders, sandwiches sold, average order, best seller, a by-night table, most popular items, and charts.
- **Orders**: one row per order: night, time, name, email, items, total, payment, notes, Paid, Ready, when the ready email went out, and the deal discount. (The Room column is only filled for older orders; the form no longer asks for it.)
- **Order Items**: one row per item, which feeds the popularity stats.
- **Menu**: items, category, price, Available, ingredients.

Orders placed after midnight, up to 6am, count toward the previous night (`NIGHT_CUTOFF_HOUR`). To keep the sheet in a Drive folder you already have, put that folder's ID in `FOLDER_ID` in `Code.gs` before running `setup`.

Email limit: a personal Gmail account sends about 100 emails a day, which is plenty for a night. If it ever runs out, the admin page tells you.

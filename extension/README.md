# lc/tracker sync (Chrome / Edge extension)

Reads your LeetCode submissions in your own browser and sends them to the tracker (decisions #55, #56).
LeetCode blocks logged-in requests from AWS, so this is the main sync; a backup Lambda polls the public
recent-accepted list on prod.

## Install

1. `npm run build -w extension` (from the repo root). This makes `extension/dist`.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked**
   and choose `extension/dist`.
3. On the tracker's Home page, click **Connect extension** and copy the token.
4. Click the extension's icon (it opens the options), pick **Prod** or **Dev**, paste the token, **Save**.

Stay logged in to LeetCode in that browser. After rebuilding, click the reload arrow on the extension's card.

The manifest's `key` fixes the extension ID (`aiamgbbmklpoedchoheiejleeopcnfca`) so the tracker's
Sync now can reach it; only the two tracker sites may send it messages.

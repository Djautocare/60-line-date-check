# DateCheck — daily 60-line checks

A mobile-friendly website with username/password staff accounts, an admin portal, phone-camera EAN-13 scanning and PostgreSQL storage.

## Workflow

1. Admin imports each area’s product names/descriptions, **6-digit PLUs**, **areas** and optional **risk levels**, with no EAN required. There is no 60-product catalogue limit.
2. Admin marks products **High risk**, **Normal** or **Low risk**. The daily list picks **60 unique products**, using risk to adjust selection odds. Admins can keep random selection across the whole catalogue or save a per-store split between areas in **Daily selection**.
3. The first daily check generates one random selection per store for that **Europe/London calendar date**. Staff assigned to the same store see the same list. It is saved and reused, including after server restarts. Products do not repeat within a selection, but may appear again on a later day.
4. Staff start or resume their store’s shared daily check and verify each expected EAN-13 using the camera. Confirmed variants are accepted. Unknown EANs need a neutral physical-product confirmation; only a barcode confirmed for another product triggers a red three-second warning showing its name and PLU, then scanning resumes.
5. They select **Okay**, **Out of date**, or **Not stickered**, or **Rotation issue**. Out of date and Not stickered require a whole quantity from 1 to 9,999. Rotation issue is a flagged line without a quantity; report totals count flagged lines. Okay records zero issue items.
6. Before scanning, use **Off sale / Out of stock** if there is no stock to check. This saves the line without a barcode or quantity and moves to the next outstanding line. A check can be finished once every line is scanned and recorded or marked Off sale. Off-sale lines remain separate from Okay and quality issues, and count as recorded rather than inspected. Off sale affects that check only; it does not remove the product from the catalogue or future daily selections. Reports include PLU, area, risk at selection, result, issue quantity, verification method and timestamps, with CSV export.

The daily list is generated on demand when the first person starts, rather than by a midnight scheduled task. Later changes to products or risk levels do not replace an already generated daily list. Each store has one shared check and completion per day. Results record the individual who checked each line. Catalogue details are copied into check lines so reports retain their original product information.

## Windows setup

Use **Node.js 24 LTS** (minimum 22.13) and your existing PostgreSQL installation.

### 1. Create a separate PostgreSQL database

In pgAdmin, right-click **Databases → Create → Database**, name it `datecheck60`, and save. Do not create another PostgreSQL installation or add these tables to the InventoryOS database.

For a dedicated database login, open Query Tool while connected to the `postgres` database and run these statements individually, replacing the example password:

```sql
CREATE ROLE datecheck60_app WITH LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_PASSWORD';
CREATE DATABASE datecheck60 OWNER datecheck60_app;
```

Use either the pgAdmin creation route or the SQL route; do not create the database twice. If you already created `datecheck60` as `postgres`, you can change its owner in pgAdmin to `datecheck60_app`.

The application creates its own tables on first startup. Its migration runs transactionally; future schema changes belong in additional versioned migrations.

### 2. Download this repository

Keep it in a permanent directory, such as `C:\DateCheck60`. Open PowerShell in that directory:

```powershell
npm install
npm run build
Copy-Item .env.example .env
notepad .env
```

Set:

```dotenv
PORT=3001
APP_ORIGIN=http://localhost:3001
DB_HOST=localhost
DB_PORT=5432
DB_USER=datecheck60_app
DB_PASSWORD='YOUR_POSTGRESQL_PASSWORD'
DB_NAME=datecheck60
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YOUR_STRONG_PASSWORD_AT_LEAST_12_CHARACTERS
ADMIN_NAME=Your name
COOKIE_SECURE=false
```

Enter the actual PostgreSQL password in `DB_PASSWORD` and keep it in quotes so characters such as `#` are preserved. These separate fields do not need URL encoding. `DB_USER` must match the login that owns or has access to the database. If you created the database using your existing `postgres` account, use `DB_USER=postgres` and that account's password. Existing `DATABASE_URL` configurations still work; separate fields take precedence when `DB_PASSWORD` is set. Keep `.env` on your PC; it is ignored by Git. The admin username/password are used only to create the first administrator. Changing these values later does not change an existing password. After first startup, remove `ADMIN_PASSWORD` from `.env` and change the account password within the app.

Run `npm run check:db` to confirm the username, host, port and database (the password is hidden) and test the connection. A failure here does not change any database passwords. Check the displayed host and port against pgAdmin's **server → Properties → Connection** and your working InventoryOS configuration.

Run `npm start`, then visit **http://localhost:3001**. Sign in with your configured username and password.

### 3. Install the Windows scheduled task

Double-click **windows\Install-60-Line-Date-Check-Task.cmd**. It registers **60 Line Date Check Backend** in Task Scheduler for the current Windows account and starts automatically when that account signs in.

- **windows\Launch-60-Line-Date-Check.cmd** starts the installed task.
- **windows\Stop-60-Line-Date-Check.cmd** stops the task and its own Node backend process.

This does not stop InventoryOS or PostgreSQL. The scripts reference their own absolute project directory and PID. Keep the directory in place after installing the task; reinstall the task if you move it. Logs appear in `logs`; runtime PID files appear in `runtime`. Both directories are ignored by Git. A Windows sign-out stops an interactive scheduled task; this setup starts at sign-in, not before sign-in at boot. PostgreSQL must also be running, normally as its Windows service.

You can still run or stop the server manually with `npm start` and **Ctrl+C**. Do not start a manual server and the scheduled task together on the same port.

## Using the phone camera

Phone camera access needs an **HTTPS website** and browser permission. `http://localhost` works for desktop testing, but `http://YOUR-PC-IP:3001` usually cannot access a phone camera.

For the same local-PC approach as InventoryOS, add a separate Cloudflare Tunnel hostname for DateCheck pointing to `http://localhost:3001`. Once your new hostname is set up, update `.env`:

```dotenv
APP_ORIGIN=https://YOUR-DATECHECK-HOSTNAME
COOKIE_SECURE=true
```

Restart the backend and open that HTTPS address in Safari or Chrome on your phone. Set the hostname and tunnel in your own Cloudflare account; this repository does not provision DNS or a tunnel. The backend serves both the built website and the API, so both use the same hostname. Cloudflare Pages alone cannot run this Node/PostgreSQL backend.

The scanner uses the rear camera, with a bundled ZXing decoder for EAN-13, plus photo scanning and manual entry fallbacks. Live decoding uses only the square guide, correctly mapped to source pixels even when the camera preview crops the image. The area outside the guide is dimmed and excluded from live decoding. A bounded decoder searches past false start markers from nearby packaging, requires matching results across three image rows, and confirms the same EAN on two consecutive camera frames. A local row-threshold fallback helps shaded or low-contrast labels. Put the full barcode and its blank side margins inside the square and move closer so the label fills it. It searches horizontal, vertical, upside-down and diagonal barcode orientations using additional rotated decoding passes. The camera scans diagonals over successive frames to limit phone CPU use; photo scanning tries all angles. Keep the complete barcode and its blank side margins visible, in focus and sufficiently lit. In-plane rotation support does not compensate for a hidden barcode or an extreme perspective angle. Camera frames stay on the device; only the decoded barcode and verification method reach the server. Torch controls appear only when offered by the camera. Real-device camera accuracy still needs a phone test on your HTTPS hostname.

## Mobile layout

The mobile navigation fits all account tabs within the screen. The page is constrained to the viewport and horizontal overscroll is disabled. Wide tables retain their own contained scroll area so all columns remain available without moving the page sideways. Mobile form controls use 16px text to avoid input-focus zoom. Viewport settings request a fixed 1× scale and touch gestures allow single-finger scrolling without pinch zoom. Browsers can override viewport zoom restrictions, particularly iOS Safari and accessibility settings. These screen-only styles do not affect the printed report layout.

## Catalogue and risk-based selection

Products can be created with only a description/name, six-digit PLU and area. EAN is optional. In **Product catalogue → Import an area without EANs**, download a blank template or choose a CSV. For tomorrow’s paper lists, upload each area’s photos in the chat to extract a CSV; the app does not perform image OCR. Review and edit each PLU, description and area in the preview, then press **Confirm import**. No data is imported merely by choosing a file.

```csv
name,plu,area
```

`description` or `product name` can replace `name`. `section` can replace `area`, or set a default area before choosing the CSV. Optional columns are `ean` and `risk` (`high`, `normal`, `low`). Keep PLUs and barcodes as text to retain leading zeros. Imports update by PLU and keep approved EAN variants and risk when omitted. Duplicate PLUs in a file are rejected, as are ambiguous existing duplicate-PLU records; edit those individually. A conflicting EAN never moves to another PLU automatically. Imports are atomic and accept up to 2,000 rows within the request-size limit. A 900-line EAN-free import and a subsequent 60-product selection are covered by integration tests.

### Barcode learning and mixed cases

A product can have several approved EAN-13s. Existing catalogue EANs migrate as approved. For an unknown EAN, staff confirm the actual pack matches the selected PLU and description before recording dates. This is provisional verification, not an approved assignment. A candidate is created in **Barcode reviews** with the scanned EAN, proposed PLU/name, area and count of completed daily checks.

The first EAN automatically confirms after four distinct **completed daily checks** with an inspected result for that candidate. Repeated scans, repeated saves or repeated Finish requests in one check count once. Practice, off-sale, unfinished checks and rotation rechecks do not add learning evidence. If the same EAN is pending against different products, an admin must resolve the conflict. Once a product has approved EANs, any new unknown variant always requires admin approval, even after four checks. An unknown barcode alone does not prove a mixed case.

Approved variants of the expected product pass. A barcode approved for another product produces a red warning naming that product and its PLU for three seconds, clears the current verification and then resumes scanning. Unknown barcodes do not flash red. Denied proposals stay unverified and require admin help. The backend revalidates ownership when saving and finishing, so an intervening admin assignment cannot silently approve the wrong line. Manual and photo scans use the same rules.

### Admin scan-to-review and assignment

Open **Barcode reviews → Scan to review / assign**, or enter an EAN manually. Pending proposals for that EAN open immediately with their PLU, name and area, and **Confirm this variant / Deny link** buttons. Resolved reviews disappear immediately. Multiple proposed products remain separate choices; approving one EAN owner rejects its other pending proposals. Approved EANs cannot be silently reassigned to a different product.

If the EAN is unassigned, enter a six-digit PLU, choose the displayed product/name/area, then **Confirm assignment**. Alternatively, scan (or enter) an already approved variant’s EAN to show its PLU and product name, then confirm linking the original EAN as another variant. An unassigned reference barcode requires using the PLU route instead. Only admins can approve, deny or assign links. **Edit by scanning** opens approved products for editing and routes unknown EANs to Barcode reviews. Additional approved variants are retained when catalogue details are edited.

### Daily product split

Open **Daily selection → Selection method → Choose a count for each area**. Enter the required daily lines for **Short life**, **Long life**, **Ambient produce**, **Chilled produce** and **Bread**, then choose **Save daily split**. Other imported areas also appear automatically. Counts must be whole numbers totalling **60**; the screen shows the running total and each area's catalogue size. Set an area to **0** to exclude it. The server rejects counts larger than the available products in an area. New areas have a count of zero until included in the saved split.

The split belongs to the selected store. Store admins manage their own split; the protected owner must choose a store in the header first. **Random across the whole catalogue** restores the original behaviour. Existing stores stay in this mode until a split is saved. Settings use the existing PostgreSQL `settings` table; no new database or migration is required.

The selection uses weights High = 3, Normal = 1, Low = 0.5 with weighted random sampling without replacement. With a split, risk affects which products are selected **within each area**, while the area counts remain exact. These are relative weights, not guaranteed check frequencies. Products can return on consecutive days. If an area's count equals its catalogue size, all its products are included regardless of risk. Selected areas are shuffled together. Removing catalogue products can make a saved split impossible; in that case a new list is blocked with an explanation until the counts or catalogue are corrected.

Saving settings does not replace today's saved list, even after an unfinished report is deleted. The new split applies to the next day whose list has not been generated. The table shows today's actual area totals separately. Practice checks use their own random sample and ignore area quotas.

### Owner-only regeneration

The protected original owner (`@admin` in the original setup) can select a store, open **Daily selection → Owner controls → Regenerate today's list**, and confirm. Save any split edits first. This explicitly replaces that store's current daily selection using the saved area split and risk weights. A fresh check with 60 unrecorded lines opens even if the previous check was completed or its report was deleted. Products may be picked again; a random draw does not guarantee 60 different products from the previous list.

The confirmation explains that the current day's check/report, recorded results, linked rotation rechecks and that check's barcode-learning observations are permanently removed. Approved EAN assignments remain. Other stores, earlier dates and practice checks are preserved. Staff should refresh or reopen the daily check; stale line/finish requests cannot update the replacement check because it has new IDs. A repeated request based on the old check is rejected. If the saved split cannot be satisfied, the original check and results remain intact. Other admins and staff cannot regenerate, including through the API.

Add at least 60 products to start a daily check. An admin can run a clearly labelled **practice check** with a smaller catalogue to test the workflow; it never counts as the daily 60-line check.

## Reports and rotation rechecks

Reports can be filtered by a single date, a Monday–Sunday week (choose any date in that week), a calendar month, an inclusive custom date range, or a relative time period (last 7, 30 or 90 days, this month, this year). Administrators can also filter by Checked by, using each account's ID so duplicate display names remain distinct. Staff can access shared daily reports for their assigned store. Practice records stay private to their creator and store admins. Older records remain available through pagination. Download filtered summary exports every matching report, including matches beyond the current page. Opening and returning from a report preserves the filters. Individual report views, CSV downloads and printed reports group lines in this order: Out of date, Not stickered, Rotation issue, Okay, Off sale, then Pending. Original line numbers are kept in CSV files, with check order retained within each group. In a report view, use the three-dot Report options menu for Download CSV or Print report. Administrators also have a Delete report option in that menu. It asks for confirmation, then permanently removes the selected report, its lines and all linked rotation rechecks and history in one database transaction. Other reports, catalogue products, accounts and the shared daily selection are kept. Staff cannot delete reports, including through the API. Printing opens the browser print dialog with an A4 landscape layout, report details and issue totals, repeating table headers and all product rows.

**Rotation rechecks** is shared by colleagues in the same store. The owner can view all stores or filter to one store. Finishing a real daily check queues each Rotation issue for the next London calendar day. Practice checks do not create follow-ups. These are additional to the daily 60 products. Overdue rechecks remain visible until recorded. Future rechecks cannot be completed early.

Choose a due product, scan its expected EAN-13 (or use the recorded manual fallback), then select **Okay now** or **Still a rotation issue**. If no stock is available, **Off sale / Out of stock** is available before scanning and schedules another follow-up for the next day. No quantity is required. Okay now and Still a rotation issue require the person saving the result to verify the barcode themselves. Off sale is explicitly recorded as not scanned. Still a rotation issue schedules another recheck for the day after it is recorded, including when checking an overdue item. Okay now stops the follow-up. Saved results appear in Recheck history with the original flagged date and person, the recheck result, scan method, and who checked it and when. Original reports are preserved. Each flagged line has its own follow-up history.

## Accounts and access

The original bootstrap administrator (for example `@admin`, display name Administrator) is the **protected owner**, identified by its persisted account ID. Renaming another account “admin” does not grant ownership. The owner can view **All stores**, select any store in the header filter, create/rename stores, and manage accounts and reports across stores. Other admins cannot demote, disable, reset the password of, remove or move the owner. The owner changes its own password in Account settings.

Store admins manage staff and other admins assigned to their own store. Create an account directly in the selected store, or use **Add an existing account** to search by exact username and add an unassigned account. An account has one store membership. Store admins cannot take an account from another store; the owner can explicitly transfer it, with confirmation. **Remove from store** clears membership and revokes sessions while retaining the account and all historical reports. Disabled accounts remain disabled when assigned. An unassigned account can sign in and change its password but cannot access checks, reports or the catalogue until assigned.

Daily selections, results, report filters, printing/downloads and rotation rechecks follow the check’s store ID. Moving a person does not move their old reports. Staff share the daily results and finished state; a new person joining the store resumes the same check. Each inspected result requires the person saving it to scan first. The check screen refreshes shared progress every ten seconds and on focus; revision checks reject stale changes from another screen. A completed daily check remains completed even if an admin deletes its report. An unfinished deleted check can be restarted with that day’s saved selection.

The Aldi product catalogue, risk settings and approved barcode knowledge remain shared across stores. All assigned store admins can maintain them. No email address is required for accounts.

Passwords use salted scrypt hashes. Sessions use random opaque tokens stored as hashes, an eight-hour expiry and HttpOnly/SameSite cookies. Authentication is checked on the server for every request; admins are checked on every privileged action. Password changes/resets revoke existing sessions. Login failures are rate limited. Enable secure cookies when using HTTPS. There is no public self-registration.

## Development and checks

In one terminal: `npm start`. In another: `npm run dev` (Vite at localhost:5173). For that local development session, set `APP_ORIGIN=http://localhost:5173` and `COOKIE_SECURE=false` before starting the backend. Vite proxies `/api` to port 3001.

```powershell
npm run typecheck
npm test
npm run build
```

Automated workflow tests use a temporary PostgreSQL-compatible test database and do not require your production database. Back up `datecheck60` with pgAdmin or `pg_dump`; do not treat GitHub as a database backup. To install updates, stop the backend, download the updated source in the same directory, run `npm install` and `npm run build`, and launch the backend again. Your `.env` and PostgreSQL records stay separate from source.

## Updating an existing installation

Off sale uses migration 4 to extend the daily-check and recheck result options. The migration applies automatically at startup and preserves existing data. Risk levels and the Rotation issue result use database migration 2. Next-day rotation rechecks use migration 3, which also queues rotation issues from previously completed daily checks using the day after their completion in London time. Existing products and historical check lines start at Normal risk. Existing daily selections, catalogue entries, accounts and reports are preserved. Migration 1 is unchanged. Stop the DateCheck backend, copy the updated repository files into the same folder while keeping `.env`, run `npm run build`, and relaunch the backend. The migration is applied automatically at startup. Existing selections are not regenerated; the new weighting applies to the next day whose list has not yet been generated.

## Barcode-learning upgrade (migration 5)

Migration 5 runs automatically on backend startup. It permits blank catalogue EANs, seeds existing EANs as approved variants, adds pending proposals and completed-check evidence, and links check lines to catalogue IDs while preserving historical snapshots. There is no new PostgreSQL database to create. It does not rebuild today’s saved selection. Keep a normal database backup before upgrading.

To activate on the Windows PC: stop the DateCheck backend, replace the source with the updated repository while keeping `.env`, run `npm install` and `npm run build` in `C:\datecheck60`, then launch the DateCheck backend task again and refresh the browser. The InventoryOS backend and Cloudflare tunnel configuration do not change. Check **Product catalogue** and **Barcode reviews** after restart. Real-camera behaviour still needs a phone test on the installed HTTPS site.

## Store upgrade (migration 6)

No new PostgreSQL database is needed. Migration 6 runs automatically on backend startup and preserves all accounts, catalogue entries, selections, reports and barcode knowledge. Existing data is grouped in **Existing store — set number**. Sign in as the original owner, open **Admin portal → Stores**, choose that existing store and save its real number. Create further stores there, then choose each store in the header filter to create/add/transfer people.

If the old version contains several individual daily checks for one date, all reports are kept. One becomes the shared daily check, preferring an already completed check, then the earliest started check. Historical data is never split by the old optional free-text location. Assigning a number to the existing store keeps its ID and history intact. The current check does not regenerate when a store is renamed.

Install the update by stopping the backend, keeping a database backup and `.env`, replacing the repository source, running `npm install` and `npm run build` in `C:\datecheck60`, then starting the backend again. Refresh each device so it loads the updated frontend.

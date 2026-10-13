# DateCheck — daily 60-line checks

A mobile-friendly website with username/password staff accounts, an admin portal, phone-camera EAN-13 scanning and PostgreSQL storage.

## Workflow

1. Admin scans each catalogue product and enters its name, **6-digit PLU** and **area**. There is no 60-product catalogue limit.
2. Admin sets how many products to select from each area. The total must be **60**, and each area must have enough distinct products.
3. The first daily check generates one random selection for that **Europe/London calendar date**. All staff see the same list. It is saved and reused, including after server restarts. Products do not repeat within a selection, but may appear again on a later day.
4. Staff start or resume their own daily check and verify each expected EAN-13 using the camera. A mismatched barcode is rejected by the backend.
5. They select **Okay**, **Out of date**, or **Not stickered**. Issues require a whole quantity from 1 to 9,999. Okay records zero issue items.
6. A check can only be finished after every line is verified and recorded. Reports include PLU, area, result, issue quantity, verification method and timestamps, with CSV export.

The daily list is generated on demand when the first person starts, rather than by a midnight scheduled task. Later changes to products or quotas do not replace an already generated daily list. Each staff member has a separate check record. Catalogue details are copied into check lines so reports retain their original product information.

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

The scanner uses the rear camera, with a bundled ZXing decoder for EAN-13, plus photo scanning and manual entry fallbacks. Camera frames stay on the device; only the decoded barcode and verification method reach the server. Torch controls appear only when offered by the camera. Real-device camera accuracy still needs a phone test on your HTTPS hostname.

## Catalogue and daily split

Use Product catalogue to scan and add products. Keep area spelling consistent (the form suggests existing areas). EAN-13 check digits are validated. PLUs are exactly six digits, including any leading zeros.

CSV imports use these columns:

```csv
name,ean,plu,area
```

Use text formatting for numeric-looking identifiers to preserve leading zeros. Importing an existing EAN updates that product's name, PLU and area. The app accepts up to 2,000 rows in each import.

After adding products, open **Daily area split** and allocate 60 lines. An admin can run a clearly labelled **practice check** with a smaller catalogue to test the workflow; it never counts as the daily 60-line check.

## Accounts and access

Admins create staff usernames, names, temporary passwords and access levels. No email address is required. Staff can change passwords in Account settings; an administrator can reset other staff passwords and disable accounts. Staff can see only their own reports; admins can see all reports. The original owner account cannot be disabled or demoted by another administrator.

Passwords use salted scrypt hashes. Sessions use random opaque tokens stored as hashes, an eight-hour expiry and HttpOnly/SameSite cookies. Authentication is checked on the server for every request; admins are checked on every privileged action. Password changes/resets revoke existing sessions. Login failures are rate limited. Enable secure cookies when using HTTPS. There is no public self-registration.

## Development and checks

In one terminal: `npm start`. In another: `npm run dev` (Vite at localhost:5173). For that local development session, set `APP_ORIGIN=http://localhost:5173` and `COOKIE_SECURE=false` before starting the backend. Vite proxies `/api` to port 3001.

```powershell
npm run typecheck
npm test
npm run build
```

Automated workflow tests use a temporary PostgreSQL-compatible test database and do not require your production database. Back up `datecheck60` with pgAdmin or `pg_dump`; do not treat GitHub as a database backup. To install updates, stop the backend, download the updated source in the same directory, run `npm install` and `npm run build`, and launch the backend again. Your `.env` and PostgreSQL records stay separate from source.

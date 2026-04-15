# ReplyPals Comprehensive Documentation

This document serves as the complete, single-source-of-truth reference for the **ReplyPals** application architecture, detailing every component across the Browser Extension, Public Website, Backend API, and Database Infrastructure.

---

## 1. System Overview

ReplyPals is an AI writing assistant explicitly designed for non-native English speakers. It allows users to write text natively (or in broken English), select it, and rewrite it into professional, casual, or confident tones instantly using Generative AI. 

The application is built on four core pillars:
1. **Browser Extension:** A Chrome Extension (Manifest V3) that injects a UI into websites (via `content.js`) and provides a Side Panel (`popup.html`) for deeper interactions like Tone selection, Voice recording, and AI chat.
2. **Public Website:** A responsive web application built with Tailwind CSS, hosting the marketing pages, user authentication (`login.html`, `signup.html`), and a secure `dashboard.html` for tracking writing statistics and managing subscriptions.
3. **Backend API:** A FastAPI Python backend that acts as the middleware. It handles secure communication with the AI providers (Google Gemini, OpenAI, Anthropic), processes payments via Stripe, and updates user metrics.
4. **Database (Supabase):** The core data layer, utilizing PostgreSQL to store User Profiles, Usage Statistics, License Keys, and handling centralized User Authentication.

---

## 2. Browser Extension Architecture

The Chrome extension acts as the primary user interface. It provides in-page rewrite capabilities and a persistent Side Panel.

### `manifest.json`
- Operates on **Manifest V3**.
- Defines permissions: `storage`, `activeTab`, `scripting`, `sidePanel`, `contextMenus`.
- Defines `externally_connectable` rules to allow the ReplyPals website (`https://*.replypals.in/*`) to pass authentication tokens directly to the extension.

### `content.js` (The Injected UI)
- **Role:** Injected into all web pages `<all_urls>`.
- **Behavior:** Listens for user text selection. Once text is selected, it dynamically injects an "Inline Popup" element near the cursor.
- **Features:** 
  - Capable of reading the DOM context (e.g., extracting emails from Gmail blocks to generate smart replies).
  - Handles replacing the original selected text with the rewritten AI output automatically.
  - Injects CSS globally but scoped tightly under ReplyPals-specific Shadow DOMs or highly specific class names to prevent style leakage.

### `background.js` (The Service Worker)
- **Role:** The central router for the extension. It runs persistently in the background.
- **Key Responsibilities:**
  1. **Message Routing:** Listens to `chrome.runtime.onMessage` from `content.js` and `popup.js`.
  2. **API Communication:** Executes `fetch` requests to the Backend API (`/rewrite`, `/generate`) so that content scripts do not face CORS restrictions.
  3. **Token Management:** Listens to `chrome.runtime.onMessageExternal` to receive the Supabase JWT from the website dashboard. It stores this token in `chrome.storage.local` and attaches it as a `Bearer` token to API requests.
  4. **Analytics:** Sends usage metrics to Mixpanel.
  5. **Context Menus:** Registers the right-click "Rewrite with ReplyPals" menu item.

### `popup.html` & `popup.js` (The Side Panel)
- **Role:** A dedicated UI panel that opens on the right side of the browser.
- **Features:**
  - Displays recent rewrites, templates, and voice-to-text recording capabilities.
  - Shares a Voice Engine module (`voice-engine.js`) alongside the content script to allow dictation.

---

## 3. Web Application Architecture

The public website serves as the onboarding hub, authentication gateway, and user management portal.

### Authentication Flow (`login.html`, `signup.html`, `auth-callback.html`)
- **Library:** `@supabase/supabase-js` (loaded via CDN).
- **Mechanism:** Implements Supabase Authentication using the PKCE (Proof Key for Code Exchange) flow.
- **Signup / Login:** Supports Email/Password and Google OAuth.
- **OAuth Callback:** `auth-callback.html` intercepts the redirect from Google or Email Magic Links. It extracts the access tokens from the URL hash parameters, initiates the session locally, and then hits the Backend API (`/account/register`) to ensure the user row is initialized synchronously, before redirecting to the Dashboard.

### `dashboard.html` (User Portal)
- **Role:** Protected page accessible only when a valid Supabase session is present.
- **Key Actions:**
  - **Data Fetching:** Fetches live `.getSession()` data and queries the API for `/account/status` and `/account/stats` using the JWT Bearer token.
  - **Extension Syncing:** Immediately invokes `chrome.runtime.sendMessage` to the user's installed Chrome Extension ID, passing the JWT automatically so the extension is mutually authenticated.
  - **Statistics Display:** Uses `Chart.js` to render the user's historical AI writing improvement over time based on the "Native Sound Score".
  - **Billing:** Directly links to Stripe Customer Portal URLs fetched from the backend.

---

## 4. Backend API Architecture

The FastAPI application (`api/main.py`) handles all complex business logic, rate-limiting, and 3rd party API integrations.

### Core Endpoints
- **`POST /rewrite`:** 
  - Receives text, tone, and language. 
  - Calls the Generative AI (Gemini Flash). 
  - Scores the text out of 100 for native fluency.
  - Identifies the user via the `Authorization: Bearer` header.
  - Updates the `user_profiles` rolling average score and total usage count organically.
- **`POST /account/register`:** 
  - Called by the website during signup.
  - Uses an `upsert` mechanism to create or update a user profile. Links pre-existing Stripe licenses or free-tier quotas dynamically to the newly created Supabase `user_id`.
- **`GET /account/status`:** 
  - Resolves whether the user operates on a Free, Starter, Pro, or Team tier. Returns remaining quotas and masked license keys.
- **`GET /account/stats`:** 
  - Returns aggregated data (Chart arrays grouped by day, top tone preferences, total rewrites) ensuring data structures perfectly match the Tailwind dashboard expectations.

### Security & Rate Limiting
- Uses `slowapi` to enforce strict rate limits per IP/User (e.g., `30/minute` on `/rewrite`).
- Parses JSON Web Tokens (JWT) natively via `PyJWT` checking against the `SUPABASE_JWT_SECRET` to validate signatures without needing active database lookups for every request.

---

## 5. Database Architecture (Supabase / PostgreSQL)

ReplyPals utilizes Supabase as a Backend-as-a-Service, leveraging PostgreSQL, Row Level Security, and Triggers.

### Core Tables
1. **`user_profiles`**
   - Central repository for authenticated users.
   - Stores `total_rewrites`, `avg_score`, and `scores_log` (a JSONB array containing historical scoring data).
2. **`free_users`**
   - A legacy/fallback table for tracking usage quotas (5 rewrites) for users who might rely solely on email tracking without a full account.
3. **`licenses`**
   - Tied to Stripe webhooks. Tracks active subscriptions, renewal dates, and the specific tier plan (Starter, Pro, Team). Maps back to a `user_id` when the user authenticates.
4. **`api_logs` & `rewrite_logs`**
   - Privacy-centric logging tables. Only metadata (payload size, tone, language, response speed, HTTP status) is stored. **Actual user input strings are strictly discarded post-processing.**

### Triggers & Webhooks
- **Auth Triggers:** `handle_new_user` trigger binds to Supabase's internal `auth.users` system to instantiate a `user_profiles` row immediately upon database insertion.
- **Stripe Webhooks:** Background jobs receive `checkout.session.completed` and `invoice.paid` payloads, automatically updating the `licenses` table.

---

## 6. Development & Deployment Operations

- **Environment Config:** Relies on `.env` files mapping `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, and `GEMINI_API_KEY`.
- **CORS Handling:** The FastAPI backend securely permits interactions across local extensions (`chrome-extension://*`) and production web deployments (`https://replypals.in`).
- **Dependencies:** API leverages standard ASGI stacks (`uvicorn`, `fastapi`, `httpx`, `pydantic`).

### Error Handling & Degradation
- If the backend is offline, the Chrome extension safely degrades, catching `fetch` network failures and displaying beautiful standard UI Toasts rather than failing silently.
- Authentication tokens expire naturally; the extension dynamically fails safely if unauthorized, prompting users to re-login via the Dashboard.

---

*This document captures the holistic state of the ReplyPals ecosystem. It aligns the extension background scripts with secure HTTP API calls, synchronized by unified Supabase identity tokens.*

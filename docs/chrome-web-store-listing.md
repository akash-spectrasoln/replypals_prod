# Chrome Web Store — ReplyPals listing (copy-paste)

Use these strings in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) when you publish or update the extension.

---

## Short description (max 132 characters)

**Copy this line:**

```
ReplyPals rewrites text in place—tone, clarity, replies & drafts. Voice uses Chrome only; optional sign-in for plans.
```

*(Character count: under 132. Trim words if the form still complains.)*

**Alternate (shorter):**

```
Rewrite any text with better English tones—emails, chats, posts. Voice stays in Chrome; optional account for plans.
```

---

## Detailed description (store “Description” / full text)

You may paste and lightly edit the HTML the dashboard allows; plain paragraphs work.

```
ReplyPals helps you write clearer, more natural English anywhere you type—email, chat, social, forms, and long documents.

WHAT YOU GET
• Rewrite selected text or the whole field in your chosen tone (confident, polite, formal, friendly, and more).
• Quick actions: improve, shorten, adjust tone, generate a reply, or write from scratch (posts, blogs, messages—not just email).
• Custom instructions: tell ReplyPals exactly what you want (e.g. “turn this into a LinkedIn post” or “make a prompt from this sentence”).
• Optional voice input: speech is handled by Chrome’s built-in speech recognition on your device; audio is not uploaded to ReplyPals for recognition.
• Free tier with fair usage limits; upgrade on replypals.in for higher limits and team features.

HOW IT WORKS
Select text or focus a field, open ReplyPals from the toolbar or side panel, pick an action, and insert or copy the result.

PRIVACY IN SHORT
Text you send for rewriting is processed by our service to return a result and is not used to train public models. See our Privacy Policy on replypals.in for details.

ReplyPals is built for professionals and learners who want their English to sound natural and confident.
```

---

## Single purpose (if the form asks for a “single purpose” statement)

```
ReplyPals has one purpose: to help users rewrite and generate English text in the browser with tone control and optional voice input, using ReplyPals servers only when the user requests an AI rewrite or generation.
```

---

## Permission justifications (Developer Dashboard → Privacy / permissions)

Align wording with your actual `manifest.json`. Replace `<id>` with your extension ID after publishing.

| Permission / capability | Suggested justification |
|-------------------------|-------------------------|
| **storage** | Saves your preferences (tone, usage counters, optional session token if you sign in) locally on your device. |
| **clipboardWrite** | Lets you copy generated text to the clipboard when you choose Copy. |
| **activeTab** | Lets the extension read or update text only in the tab where you actively use ReplyPals. |
| **scripting** | Injects the ReplyPals UI and content script on pages where you use the extension. |
| **sidePanel** | Shows the ReplyPals panel docked to the browser window when you open it. |
| **contextMenus** | Adds optional right-click menu entries to rewrite selected text. |
| **host_permissions `<all_urls>`** | Required so ReplyPals can assist in web-based editors (email, chat, docs, social sites). No background tracking of browsing; access is tied to user actions in the active tab. |

---

## Data disclosure / Privacy practices (form-style answers)

Use together with your live **Privacy Policy** URL (`https://www.replypals.in/privacy` or your canonical URL).

**What data is collected?**

- **Account data (optional):** If the user creates an account or signs in, we process email and authentication data needed to provide subscription and sync (as described on the site).
- **Usage and billing:** Plan tier, license or subscription status, and aggregated usage needed to enforce limits and billing.
- **Content sent for AI features:** Text the user submits for rewrite or generation is sent to ReplyPals servers to produce a response. It is not sold to third parties for advertising.

**How is user data used?**

- To perform rewrites and generations the user requests.
- To operate accounts, subscriptions, support, and abuse prevention.
- To improve reliability and product metrics in aggregated form, consistent with the Privacy Policy.

**Is data sold?**

- User data is not sold to third parties for cross-site advertising. Use your legal team’s exact wording if you add analytics vendors; disclose them in the Privacy Policy.

**Remote code**

- The extension loads its packaged JavaScript from the extension bundle; AI requests go to your documented API over HTTPS. State that you do not fetch arbitrary remote executable code if that remains true.

---

## Pre-submit checklist

- [ ] **Manifest** — Version bumped; `name`, `description`, icons, and permissions match what you declare in the store.
- [ ] **Privacy Policy** — Public URL loads (e.g. `/privacy`); matches data practices and contact email.
- [ ] **Support / contact** — Email or form reachable (e.g. Contact page).
- [ ] **Screenshots** — At least 1; ideally 1280×800 or 640×400 (follow current store image specs).
- [ ] **Promotional tile** — Small tile 440×280 if required for listing visibility.
- [ ] **Justifications** — Every permission and “broad host” access has a clear, honest justification.
- [ ] **Single purpose** — One clear user-facing purpose; no unrelated functionality bundled.
- [ ] **Testing** — Fresh Chrome profile: install unpacked or packed `.zip`; test rewrite, generate, sign-in (if applicable), and upgrade link.
- [ ] **Production build** — Use your build script so API URL and tokens in `background.js` are correct (no `__REPLYPAL_API_URL__` placeholders).
- [ ] **Externally connectable** — Website domains match production; extension ID added to server `ALLOWED_ORIGINS` / OAuth as documented.

After approval, note your **extension ID** and finish any remaining server-side allowlists (Stripe redirects, Supabase auth URLs, etc.).

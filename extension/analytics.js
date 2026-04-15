// ═══════════════════════════════════════════
// ReplyPals — Analytics (Mixpanel HTTP API)
// ═══════════════════════════════════════════
// PRIVACY: Only metadata is tracked (tone, score, site hostname, feature used).
// User text content is NEVER tracked.

const MIXPANEL_TOKEN = (typeof __MIXPANEL_TOKEN__ !== 'undefined') ? __MIXPANEL_TOKEN__ : ''; // Injected by scripts/build.sh

async function track(event, properties = {}) {
    try {
        // Get or create anonymous distinct_id
        const stored = await chrome.storage.local.get('replypalUserId');
        let userId = stored.replypalUserId;
        if (!userId) {
            userId = crypto.randomUUID();
            await chrome.storage.local.set({ replypalUserId: userId });
        }

        const payload = {
            event,
            properties: {
                token: MIXPANEL_TOKEN,
                distinct_id: userId,
                time: Math.floor(Date.now() / 1000),
                $insert_id: crypto.randomUUID(),
                ...properties
            }
        };

        const encoded = btoa(JSON.stringify(payload));
        await fetch(`https://api.mixpanel.com/track?data=${encoded}`, {
            method: 'GET'
        });
    } catch {
        // Analytics failure must never affect app behavior
    }
}

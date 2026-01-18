// Minimal install init
chrome.runtime.onInstalled.addListener(async () => {
  const { enabled } = await chrome.storage.local.get(["enabled"]);
  if (typeof enabled === "undefined") {
    await chrome.storage.local.set({ enabled: false });
  }
});

// In-memory cache (fast). Key = sourceUrl
const oembedCache = new Map();

// Message handler for metadata requests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "OEMBED_REQUEST") {
    const url = msg.url;
    if (!url || typeof url !== "string") {
      sendResponse({ ok: false, error: "Missing url" });
      return; // sync response
    }

    // async response
    (async () => {
      try {
        if (oembedCache.has(url)) {
          sendResponse({ ok: true, data: oembedCache.get(url), cached: true });
          return;
        }

        const endpoint =
          "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url);

        const res = await fetch(endpoint, {
          method: "GET",
          // keep it simple; oEmbed doesn't require credentials
        });

        if (!res.ok) {
          sendResponse({ ok: false, error: `oEmbed HTTP ${res.status}` });
          return;
        }

        const data = await res.json();
        // data.title, data.author_name, data.author_url, data.thumbnail_url...
        const out = {
          title: data.title || "",
          author_name: data.author_name || "",
          author_url: data.author_url || "",
          thumbnail_url: data.thumbnail_url || ""
        };

        oembedCache.set(url, out);
        sendResponse({ ok: true, data: out, cached: false });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();

    return true; // IMPORTANT: keep the message channel open for async sendResponse
  }
});

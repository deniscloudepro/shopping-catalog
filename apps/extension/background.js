async function getSettings() {
  const { webAppUrl, apiKey } = await chrome.storage.sync.get(["webAppUrl", "apiKey"]);
  return { webAppUrl, apiKey };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SAVE_ITEM") return undefined;

  (async () => {
    const { webAppUrl, apiKey } = await getSettings();
    if (!webAppUrl) {
      sendResponse({ ok: false, error: "Не настроен адрес Apps Script — открой настройки расширения." });
      return;
    }

    try {
      // Apps Script doPost() can't read custom headers, so the key travels
      // in the body instead.
      const res = await fetch(webAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...message.payload, apiKey }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        sendResponse({ ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` });
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        sendResponse({ ok: false, error: data.error || "Apps Script вернул ошибку" });
        return;
      }

      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});

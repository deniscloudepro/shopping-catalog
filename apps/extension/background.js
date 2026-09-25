async function getSettings() {
  const { apiUrl, apiKey } = await chrome.storage.sync.get(["apiUrl", "apiKey"]);
  return { apiUrl, apiKey };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SAVE_ITEM") return undefined;

  (async () => {
    const { apiUrl, apiKey } = await getSettings();
    if (!apiUrl) {
      sendResponse({ ok: false, error: "Не настроен адрес сайта — открой настройки расширения." });
      return;
    }

    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-Api-Key": apiKey } : {}),
        },
        body: JSON.stringify(message.payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        sendResponse({ ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` });
        return;
      }

      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});

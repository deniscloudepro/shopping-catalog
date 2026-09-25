const webAppUrlEl = document.getElementById("webAppUrl");
const apiKeyEl = document.getElementById("apiKey");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["webAppUrl", "apiKey"], ({ webAppUrl, apiKey }) => {
  webAppUrlEl.value = webAppUrl || "";
  apiKeyEl.value = apiKey || "";
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    webAppUrl: webAppUrlEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
  });
  statusEl.textContent = "Сохранено";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
});

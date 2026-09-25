const apiUrlEl = document.getElementById("apiUrl");
const apiKeyEl = document.getElementById("apiKey");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["apiUrl", "apiKey"], ({ apiUrl, apiKey }) => {
  apiUrlEl.value = apiUrl || "";
  apiKeyEl.value = apiKey || "";
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    apiUrl: apiUrlEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
  });
  statusEl.textContent = "Сохранено";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
});

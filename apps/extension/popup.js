const statusEl = document.getElementById("status");
const formEl = document.getElementById("form");
const resultEl = document.getElementById("result");
const titleEl = document.getElementById("title");
const priceEl = document.getElementById("price");
const currencyEl = document.getElementById("currency");
const imageEl = document.getElementById("image");
const previewEl = document.getElementById("preview");

let currentUrl = "";
let currentSiteName = null;

// Runs inside the inspected page (via chrome.scripting.executeScript), so it
// must be self-contained — no references to variables from this file.
function extractFromPage() {
  function parsePrice(raw) {
    if (!raw) return null;
    const cleaned = String(raw)
      .replace(/[^\d.,]/g, "")
      .replace(/,(?=\d{3}\b)/g, "");
    const num = parseFloat(cleaned.replace(",", "."));
    return Number.isFinite(num) ? num : null;
  }

  function findProductJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent || "{}");
        const nodes = Array.isArray(json) ? json : json["@graph"] || [json];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const type = node["@type"];
          const types = Array.isArray(type) ? type : [type];
          if (types.some((t) => typeof t === "string" && t.toLowerCase() === "product")) {
            return node;
          }
        }
      } catch {
        // ignore malformed JSON-LD
      }
    }
    return null;
  }

  function meta(prop) {
    const el = document.querySelector(`meta[property="${prop}"]`);
    return el ? el.getAttribute("content") : null;
  }

  function absolutize(url) {
    if (!url) return null;
    try {
      return new URL(url, location.href).toString();
    } catch {
      return null;
    }
  }

  const product = findProductJsonLd();

  let title = (product && product.name) || meta("og:title") || document.title;

  let image = null;
  if (product && product.image) {
    image = Array.isArray(product.image) ? product.image[0] : product.image;
  }
  image = image || meta("og:image");

  let price = null;
  let currency = null;
  if (product && product.offers) {
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (offer) {
      price = parsePrice(offer.price);
      currency = offer.priceCurrency || null;
    }
  }
  if (price === null) {
    price = parsePrice(meta("product:price:amount") || meta("og:price:amount"));
  }
  currency = currency || meta("product:price:currency") || meta("og:price:currency");

  const siteName = meta("og:site_name") || location.hostname.replace(/^www\./, "");

  return {
    url: location.href,
    title: (title || location.href).trim(),
    price,
    currency,
    imageUrl: absolutize(image),
    siteName,
  };
}

function renderPreview() {
  if (imageEl.value) {
    previewEl.src = imageEl.value;
    previewEl.hidden = false;
  } else {
    previewEl.hidden = true;
  }
}

imageEl.addEventListener("input", renderPreview);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    statusEl.textContent = "Открой страницу товара в этой вкладке и попробуй снова.";
    return;
  }
  currentUrl = tab.url;

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractFromPage,
  });

  titleEl.value = result.title || "";
  priceEl.value = result.price ?? "";
  currencyEl.value = result.currency || "";
  imageEl.value = result.imageUrl || "";
  currentSiteName = result.siteName || null;
  renderPreview();

  statusEl.hidden = true;
  formEl.hidden = false;
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  resultEl.textContent = "Добавляю…";

  const priceValue = priceEl.value.trim().replace(",", ".");
  const payload = {
    url: currentUrl,
    title: titleEl.value.trim() || currentUrl,
    price: priceValue ? Number(priceValue) : null,
    currency: currencyEl.value.trim() || null,
    imageUrl: imageEl.value.trim() || null,
    siteName: currentSiteName,
    addedBy: "extension",
  };

  const response = await chrome.runtime.sendMessage({ type: "SAVE_ITEM", payload });
  if (response?.ok) {
    resultEl.textContent = "Добавлено в каталог ✅";
  } else {
    resultEl.textContent = `Ошибка: ${response?.error || "не удалось сохранить"}`;
  }
});

init().catch((err) => {
  statusEl.textContent = "Не получилось прочитать страницу: " + err.message;
});

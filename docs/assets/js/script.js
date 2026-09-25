// Edit this if you ever recreate the sheet — it's the only thing this page
// needs to know. The sheet must be shared as "Anyone with the link — Viewer".
const SHEET_ID = "12IKx_4cvxqppXKImV6MsHea90-HTGEuDjSdWi52NyNU";
const SHEET_NAME = "Items";

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value === null || value === undefined ? "" : String(value);
  return div.innerHTML;
}

function formatPrice(price, currency) {
  if (price === null || price === undefined || price === "") return null;
  return currency ? `${price} ${currency}` : `${price}`;
}

async function loadItems() {
  // headers=1 forces Google to always treat row 1 as the header, explicitly —
  // without it, gviz guesses based on the data and gets it wrong when there's
  // only one data row (it can't tell a lone row of text apart from a header).
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(
    SHEET_NAME
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  const match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error("Не удалось распознать ответ Google Sheets");

  const data = JSON.parse(match[1]);
  const rows = data.table && data.table.rows ? data.table.rows : [];

  return rows
    .map((row) => {
      const cells = row.c || [];
      const get = (i) => (cells[i] && cells[i].v !== null && cells[i].v !== undefined ? cells[i].v : null);
      return {
        title: get(1),
        price: get(2),
        currency: get(3),
        url: get(4),
        imageUrl: get(5),
        siteName: get(6),
      };
    })
    .filter((item) => item.title && item.url)
    .reverse();
}

function cardHtml(item) {
  const price = formatPrice(item.price, item.currency);
  const image = item.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" />`
    : `<span class="placeholder">нет фото</span>`;

  return `
    <a class="card" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
      <div class="card-image">${image}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        ${price ? `<div class="card-price">${escapeHtml(price)}</div>` : ""}
        ${item.siteName ? `<div class="card-site">${escapeHtml(item.siteName)}</div>` : ""}
      </div>
    </a>
  `;
}

async function render() {
  const contentEl = document.getElementById("content");
  const countEl = document.getElementById("count");

  try {
    const items = await loadItems();
    countEl.textContent = `${items.length} товаров`;

    if (items.length === 0) {
      contentEl.innerHTML =
        '<div class="empty-state">Пока пусто. Пришли ссылку на товар боту в Telegram или добавь через расширение — он появится здесь.</div>';
      return;
    }

    contentEl.innerHTML = `<div class="grid">${items.map(cardHtml).join("")}</div>`;
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<div class="empty-state">Не получилось загрузить каталог: ${escapeHtml(
      err.message
    )}</div>`;
  }
}

render();

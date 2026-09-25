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

// Items Claude adds on request live in the repo itself — pushing to main is
// the whole deploy. Cache-busted so a fresh push shows up on reload.
async function loadRepoItems() {
  const res = await fetch(`items.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`items.json: HTTP ${res.status}`);
  return res.json();
}

// gviz returns datetime cells as "Date(2026,8,25,11,30,0)" (month 0-based).
function toTime(value) {
  if (!value) return 0;
  const m = String(value).match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (m) return Date.UTC(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

async function loadItems() {
  const [repo, sheet] = await Promise.allSettled([loadRepoItems(), loadSheetItems()]);
  if (repo.status === "rejected" && sheet.status === "rejected") throw repo.reason;
  if (repo.status === "rejected") console.warn(repo.reason);
  if (sheet.status === "rejected") console.warn(sheet.reason);

  const all = [
    ...(repo.status === "fulfilled" ? repo.value : []),
    ...(sheet.status === "fulfilled" ? sheet.value : []),
  ].filter((item) => item.title && item.url);

  return all.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
}

async function loadSheetItems() {
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
        createdAt: get(0),
        title: get(1),
        price: get(2),
        currency: get(3),
        url: get(4),
        imageUrl: get(5),
        siteName: get(6),
      };
    })
    .filter((item) => item.title && item.url);
}

async function loadCategories() {
  try {
    const res = await fetch(`categories.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`categories.json: HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(err);
    return [];
  }
}

const UNCATEGORIZED = { id: "other", name: "Без категории", subcategories: [] };

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

function gridHtml(items) {
  return `<div class="grid">${items.map(cardHtml).join("")}</div>`;
}

function pluralItems(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} товар`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} товара`;
  return `${n} товаров`;
}

function chipHtml(href, label, count, active) {
  return `<a class="chip${active ? " chip--active" : ""}" href="${href}">${escapeHtml(label)}${
    count !== null ? ` <span class="chip-count">${count}</span>` : ""
  }</a>`;
}

// Selection lives in the URL hash (#clothing or #clothing/the-north-face),
// so a section can be bookmarked or shared.
function currentSelection() {
  const [cat, sub] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { cat: cat || null, sub: sub || null };
}

function categorySectionHtml(category, items, sub, showEmpty) {
  const bySub = (id) => items.filter((i) => (i.subcategory || null) === id);
  const parts = [];

  for (const s of category.subcategories) {
    if (sub && sub !== s.id) continue;
    const subItems = bySub(s.id);
    if (!subItems.length && !showEmpty) continue;
    parts.push(`
      <section class="subsection">
        <h3>${escapeHtml(s.name)} <span class="section-count">${pluralItems(subItems.length)}</span></h3>
        ${subItems.length ? gridHtml(subItems) : '<div class="section-empty">Пока пусто</div>'}
      </section>
    `);
  }

  const known = new Set(category.subcategories.map((s) => s.id));
  const rest = items.filter((i) => !i.subcategory || !known.has(i.subcategory));
  if (!sub && rest.length) {
    parts.push(`
      <section class="subsection">
        ${category.subcategories.length ? `<h3>Разное <span class="section-count">${pluralItems(rest.length)}</span></h3>` : ""}
        ${gridHtml(rest)}
      </section>
    `);
  }

  if (!parts.length) return '<div class="section-empty">Пока пусто</div>';
  return parts.join("");
}

function renderCatalog(categories, items) {
  const contentEl = document.getElementById("content");
  const known = new Set(categories.map((c) => c.id));
  const itemsOf = (catId) =>
    items.filter((i) => (catId === UNCATEGORIZED.id ? !known.has(i.category) : i.category === catId));

  const allCategories = itemsOf(UNCATEGORIZED.id).length ? [...categories, UNCATEGORIZED] : categories;
  let { cat, sub } = currentSelection();
  const selected = allCategories.find((c) => c.id === cat) || null;
  if (!selected) sub = null;

  const tabs = [
    chipHtml("#", "Все", items.length, !selected),
    ...allCategories.map((c) => chipHtml(`#${c.id}`, c.name, itemsOf(c.id).length, selected === c)),
  ].join("");

  let body;
  if (selected) {
    const subTabs = selected.subcategories.length
      ? `<nav class="chips chips--sub">${[
          chipHtml(`#${selected.id}`, "Все", null, !sub),
          ...selected.subcategories.map((s) =>
            chipHtml(`#${selected.id}/${s.id}`, s.name, null, sub === s.id)
          ),
        ].join("")}</nav>`
      : "";
    body = subTabs + categorySectionHtml(selected, itemsOf(selected.id), sub, true);
  } else if (items.length === 0) {
    body =
      '<div class="empty-state">Пока пусто. Пришли товар Claude, боту в Telegram или добавь через расширение — он появится здесь.</div>';
  } else {
    body = allCategories
      .filter((c) => itemsOf(c.id).length)
      .map(
        (c) => `
        <section class="section">
          <h2><a href="#${c.id}">${escapeHtml(c.name)}</a> <span class="section-count">${pluralItems(
            itemsOf(c.id).length
          )}</span></h2>
          ${categorySectionHtml(c, itemsOf(c.id), null, false)}
        </section>
      `
      )
      .join("");
  }

  contentEl.innerHTML = `<nav class="chips">${tabs}</nav>${body}`;
}

async function render() {
  const contentEl = document.getElementById("content");
  const countEl = document.getElementById("count");

  try {
    const [categories, items] = await Promise.all([loadCategories(), loadItems()]);
    countEl.textContent = pluralItems(items.length);
    renderCatalog(categories, items);
    window.addEventListener("hashchange", () => {
      renderCatalog(categories, items);
      window.scrollTo(0, 0);
    });
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<div class="empty-state">Не получилось загрузить каталог: ${escapeHtml(
      err.message
    )}</div>`;
  }
}

render();

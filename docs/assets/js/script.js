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
  const amount = typeof price === "number" ? price.toLocaleString("ru-RU") : price;
  return currency ? `${amount} ${currency}` : `${amount}`;
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

  all.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
  all.forEach((item, i) => (item.id = i));
  return all;
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
    <button type="button" class="card" data-item="${item.id}">
      <div class="card-image">${image}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        ${price ? `<div class="card-price">${escapeHtml(price)}</div>` : ""}
        ${item.siteName ? `<div class="card-site">${escapeHtml(item.siteName)}</div>` : ""}
      </div>
    </button>
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
  // With a single category (the public view) there is nothing to switch between.
  const only = allCategories.length === 1 ? allCategories[0] : null;
  const selected = only || allCategories.find((c) => c.id === cat) || null;
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

  contentEl.innerHTML = `${only ? "" : `<nav class="chips">${tabs}</nav>`}${body}`;
}

// ---------- Item details dialog ----------

let state = { categories: [], items: [] };

function categoryPath(item) {
  const cat = state.categories.find((c) => c.id === item.category);
  if (!cat) return null;
  const sub = cat.subcategories.find((s) => s.id === item.subcategory);
  return sub ? `${cat.name} → ${sub.name}` : cat.name;
}

function formatDate(value) {
  const t = toTime(value);
  return t ? new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : null;
}

function galleryHtml(item) {
  const photos = item.images && item.images.length ? item.images : item.imageUrl ? [item.imageUrl] : [];
  if (!photos.length) return `<div class="dialog-image"><span class="placeholder">нет фото</span></div>`;

  const slides = photos
    .map(
      (src, i) =>
        `<div class="gallery-slide"><img src="${escapeHtml(src)}" alt="" ${i ? 'loading="lazy"' : ""} /></div>`
    )
    .join("");
  if (photos.length === 1) return `<div class="gallery"><div class="gallery-track">${slides}</div></div>`;

  const dots = photos
    .map((_, i) => `<button type="button" class="gallery-dot${i ? "" : " is-active"}" data-slide="${i}" aria-label="Фото ${i + 1}"></button>`)
    .join("");
  return `
    <div class="gallery">
      <div class="gallery-track">${slides}</div>
      <button type="button" class="gallery-nav gallery-nav--prev" data-step="-1" aria-label="Предыдущее фото">‹</button>
      <button type="button" class="gallery-nav gallery-nav--next" data-step="1" aria-label="Следующее фото">›</button>
      <div class="gallery-dots">${dots}</div>
    </div>
  `;
}

// Swipe comes from CSS scroll-snap; this only wires the arrows/dots and keeps
// the active dot in sync with the scroll position.
function setupGallery(root) {
  const track = root.querySelector(".gallery-track");
  const dots = [...root.querySelectorAll(".gallery-dot")];
  if (!track || !dots.length) return;

  const current = () => Math.round(track.scrollLeft / track.clientWidth);
  const goTo = (i) => track.scrollTo({ left: Math.max(0, Math.min(dots.length - 1, i)) * track.clientWidth, behavior: "smooth" });

  track.addEventListener("scroll", () => {
    const i = current();
    dots.forEach((d, k) => d.classList.toggle("is-active", k === i));
  }, { passive: true });
  root.querySelectorAll("[data-step]").forEach((btn) =>
    btn.addEventListener("click", () => goTo(current() + Number(btn.dataset.step)))
  );
  dots.forEach((d) => d.addEventListener("click", () => goTo(Number(d.dataset.slide))));
}

function dialogHtml(item) {
  const price = formatPrice(item.price, item.currency);
  const path = categoryPath(item);
  const added = formatDate(item.createdAt);

  return `
    <button type="button" class="dialog-close" data-action="close" aria-label="Закрыть">×</button>
    ${galleryHtml(item)}
    <div class="dialog-body">
      <h2 class="dialog-title">${escapeHtml(item.title)}</h2>
      <div class="dialog-price">${price ? escapeHtml(price) : "Цена не указана"}</div>
      <dl class="dialog-meta">
        ${path ? `<dt>Раздел</dt><dd>${escapeHtml(path)}</dd>` : ""}
        ${item.siteName ? `<dt>Магазин</dt><dd>${escapeHtml(item.siteName)}</dd>` : ""}
        ${added ? `<dt>Добавлен</dt><dd>${escapeHtml(added)}</dd>` : ""}
      </dl>
      <a class="btn btn--primary" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Открыть в магазине ↗</a>
    </div>
  `;
}

function openItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  const dialog = document.getElementById("item-dialog");
  dialog.innerHTML = dialogHtml(item);
  setupGallery(dialog);
  if (!dialog.open) dialog.showModal();
}

function setupDialog() {
  const dialog = document.getElementById("item-dialog");
  document.addEventListener("click", (event) => {
    const card = event.target.closest(".card[data-item]");
    if (card) openItem(Number(card.dataset.item));
  });
  dialog.addEventListener("click", (event) => {
    // A click on the backdrop lands on the <dialog> itself.
    if (event.target === dialog || event.target.closest('[data-action="close"]')) dialog.close();
  });
}

// ---------- Public vs owner view ----------
//
// Visitors see only categories marked "public": true in categories.json.
// The owner opens the site once with ?owner=<key> and this browser then shows
// everything (?owner=off forgets it). This only hides items on the page — the
// data itself stays in the public repo and items.json.

const OWNER_KEY_SHA256 = "5a91c4575a8805a4d5af43d1c44418cbf8d6f8b9f8e49f919cb0728d4fef8c6b";
const OWNER_FLAG = "catalog-owner";

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolveOwner() {
  const params = new URLSearchParams(location.search);
  const key = params.get("owner");
  if (key !== null) {
    if (key === "off") storageSet(OWNER_FLAG, null);
    else if ((await sha256Hex(key)) === OWNER_KEY_SHA256) storageSet(OWNER_FLAG, "1");
    params.delete("owner");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
  return storageGet(OWNER_FLAG) === "1";
}

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode etc. — the owner view just won't be remembered.
  }
}

async function render() {
  const contentEl = document.getElementById("content");
  const countEl = document.getElementById("count");

  try {
    const [allCategories, allItems, isOwner] = await Promise.all([loadCategories(), loadItems(), resolveOwner()]);
    const categories = isOwner ? allCategories : allCategories.filter((c) => c.public);
    const visible = new Set(categories.map((c) => c.id));
    const items = isOwner ? allItems : allItems.filter((i) => visible.has(i.category));
    state = { categories, items };
    setupDialog();
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

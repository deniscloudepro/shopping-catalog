import * as cheerio from "cheerio";

export interface ScrapedProduct {
  url: string;
  title: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function absolutize(maybeUrl: string | undefined, base: string): string | null {
  if (!maybeUrl) return null;
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return null;
  }
}

export function parsePrice(raw: string | undefined | number): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw;
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/,(?=\d{3}\b)/g, "");
  const normalized = cleaned.replace(",", ".");
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

/**
 * JSON-LD `image` is usually a string or a flat array of strings, but some
 * shops (e.g. technodom.kz) nest it one level deeper (`[["url1", "url2"]]`) —
 * walk arbitrarily nested arrays to find the first real URL either way.
 */
function firstImageUrl(image: unknown): string | null {
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    for (const item of image) {
      const found = firstImageUrl(item);
      if (found) return found;
    }
  }
  return null;
}

function findProductInJsonLd(json: unknown): Record<string, unknown> | null {
  const candidates: unknown[] = Array.isArray(json)
    ? json
    : typeof json === "object" && json !== null && "@graph" in (json as Record<string, unknown>)
      ? (json as { "@graph": unknown[] })["@graph"]
      : [json];

  for (const node of candidates) {
    if (!node || typeof node !== "object") continue;
    const type = (node as Record<string, unknown>)["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && t.toLowerCase() === "product")) {
      return node as Record<string, unknown>;
    }
  }
  return null;
}

const SIZE_SUFFIX = /-(\d+)x(\d+)[a-z]?(\.[a-z0-9]+)$/i;

function largestVariant($: cheerio.CheerioAPI, url: string): string {
  const m = url.match(SIZE_SUFFIX);
  if (!m) return url;
  const stem = url.slice(0, m.index);
  let best = { url, area: Number(m[1]) * Number(m[2]) };
  $("img, a")
    .toArray()
    .flatMap((el) => ["src", "data-src", "data-largeimg", "href"].map((a) => $(el).attr(a)))
    .forEach((candidate) => {
      if (!candidate?.startsWith(stem)) return;
      const cm = candidate.slice(stem.length).match(/^-(\d+)x(\d+)(\.[a-z0-9]+)$/i);
      if (!cm) return;
      const area = Number(cm[1]) * Number(cm[2]);
      if (area > best.area) best = { url: candidate, area };
    });
  return best.url;
}

const PLACEHOLDER_IMAGE = /vk-image|placeholder|no[-_]?image|default[-_]?(image|og)|logo/i;

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/₸|тг\.?|тенге/i, "KZT"],
  [/₽|руб\.?/i, "RUB"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/\$/, "USD"],
  [/\b(KZT|RUB|USD|EUR|GBP|UAH|BYN|UZS|KGS)\b/i, ""],
];

function currencyFromText(text: string): string | null {
  for (const [re, code] of CURRENCY_SYMBOLS) {
    const m = text.match(re);
    if (m) return code || m[1].toUpperCase();
  }
  return null;
}

/**
 * Last resort for shops with no structured data at all: the price as shown
 * on the page, in an element whose class mentions "price" and whose text has
 * a currency. On sale items the current price is preferred over the crossed-
 * out one.
 */
function findVisiblePrice($: cheerio.CheerioAPI): { price: number; currency: string | null } | null {
  const looksLikePrice = (text: string) =>
    /\d/.test(text) && text.length <= 40 && currencyFromText(text) !== null;
  const textOf = (el: Parameters<typeof $>[0]) => $(el).text().replace(/\s+/g, " ").trim();

  const priceEls = $('[class*="price" i]')
    .toArray()
    // Crossed-out old prices (WooCommerce wraps them in <del>).
    .filter((el) => $(el).closest("del, s, strike").length === 0)
    .filter((el) => looksLikePrice(textOf(el)));
  const candidates = priceEls
    // Innermost matches only, so a wrapper holding "₸ 103 990₸ 83 190" is
    // skipped while "16 900 <span class=currencySymbol>KZT</span>" is kept.
    .filter((el) => !priceEls.some((other) => other !== el && $(el).find(other).length > 0))
    .map((el) => ({ cls: ($(el).attr("class") ?? "").toLowerCase(), text: textOf(el) }));

  const isOld = (cls: string) => /old|regular|was|before|strike|cross|compare/.test(cls);
  const isCurrent = (cls: string) => /actual|current|sale|special|final|new/.test(cls);
  const best =
    candidates.find((c) => isCurrent(c.cls) && !isOld(c.cls)) ??
    candidates.find((c) => !isOld(c.cls)) ??
    candidates[0];
  if (!best) return null;

  const price = parsePrice(best.text);
  return price === null ? null : { price, currency: currencyFromText(best.text) };
}

export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }

  return parseProductHtml(await res.text(), res.url || url);
}

/**
 * Extracts product data from already-downloaded HTML — e.g. a page the user
 * saved in their own browser, for sites that block our server-side fetch.
 */
export function parseProductHtml(html: string, pageUrl: string): ScrapedProduct {
  const $ = cheerio.load(html);
  let finalUrl = pageUrl;
  if (!finalUrl) {
    finalUrl =
      $('link[rel="canonical"]').attr("href") ??
      $('meta[property="og:url"]').attr("content") ??
      "";
  }

  let title: string | null = null;
  let price: number | null = null;
  let currency: string | null = null;
  let imageUrl: string | null = null;
  let siteName: string | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (title && price) return;
    try {
      const json = JSON.parse($(el).contents().text());
      const product = findProductInJsonLd(json);
      if (!product) return;

      if (!title && typeof product.name === "string") title = product.name;

      if (!imageUrl) imageUrl = firstImageUrl(product.image);

      const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
      if (offers && typeof offers === "object") {
        const offer = offers as Record<string, unknown>;
        if (price === null) price = parsePrice(offer.price as string | number | undefined);
        if (!currency && typeof offer.priceCurrency === "string") currency = offer.priceCurrency;
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  });

  if (!title) {
    const pageTitle =
      $('meta[property="og:title"]').attr("content") ??
      ($("title").first().text().trim() || null);
    // og:title is often padded with SEO text ("… купить по выгодной цене |
    // SHOP"); the page's <h1> is usually the clean product name. Trust
    // the <h1> when the page title contains it, or when it's the page's only
    // <h1> (some shops use a category-wide og:title), so a logo h1 is ignored.
    const h1s = $("h1");
    const h1 = h1s
      .first()
      .text()
      .replace(/\s+/g, " ")
      .replace(/\s+в\s+(Алматы|Астане|Казахстане)$/i, "")
      .trim();
    title = h1 && (pageTitle?.includes(h1) || h1s.length === 1) ? h1 : pageTitle;
  }

  if (!imageUrl) {
    imageUrl = $('meta[property="og:image"]').attr("content") ?? null;
  }

  // og:image is often a social-media crop (e.g. limpopo.kz "…-600x315w.jpg"
  // cuts the product off). If the page also has the same picture in other
  // sizes, take the biggest one.
  if (imageUrl) imageUrl = largestVariant($, imageUrl);

  // Some shops put a site-wide social/placeholder picture in og:image; use the
  // product gallery's main photo instead.
  if (!imageUrl || PLACEHOLDER_IMAGE.test(imageUrl)) {
    const galleryImg = $(
      'img[itemprop="image"], img[id^="main_image"], .woocommerce-product-gallery__image img, .product-gallery img'
    )
      .toArray()
      .map((el) => $(el).attr("data-src") ?? $(el).attr("src"))
      .find((src) => src && !src.startsWith("data:"));
    if (galleryImg) imageUrl = galleryImg;
  }

  if (!siteName) {
    siteName = $('meta[property="og:site_name"]').attr("content") ?? null;
  }

  if (price === null) {
    const ogPrice =
      $('meta[property="product:price:amount"]').attr("content") ??
      $('meta[property="og:price:amount"]').attr("content");
    price = parsePrice(ogPrice);
  }

  if (!currency) {
    currency =
      $('meta[property="product:price:currency"]').attr("content") ??
      $('meta[property="og:price:currency"]').attr("content") ??
      null;
  }

  if (price === null) {
    const itemprop = $('[itemprop="price"]').first();
    price = parsePrice(itemprop.attr("content") ?? (itemprop.text().trim() || undefined));
    if (!currency) currency = $('[itemprop="priceCurrency"]').first().attr("content") ?? null;
  }

  if (price === null) {
    const visible = findVisiblePrice($);
    if (visible) {
      price = visible.price;
      currency ??= visible.currency;
    }
  }

  if (!siteName) {
    try {
      siteName = new URL(finalUrl).hostname.replace(/^www\./, "");
    } catch {
      siteName = null;
    }
  }

  return {
    url: finalUrl,
    title: (title ?? finalUrl).toString().trim(),
    price,
    currency,
    imageUrl: absolutize(imageUrl ?? undefined, finalUrl),
    siteName,
  };
}

function decodeQuotedPrintable(input: string): Buffer {
  const bytes: number[] = [];
  const text = input.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(ch, "latin1"));
    }
  }
  return Buffer.from(bytes);
}

function parseMimeHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  // Unfold continuation lines before splitting.
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

/**
 * Pulls the main HTML document (and its original URL) out of a "Save page
 * as → Single file" web archive (.mht / .mhtml), as produced by Chrome/Edge.
 * Returns null if the input doesn't look like MHTML.
 */
export function extractHtmlFromMhtml(raw: Buffer): { html: string; url: string | null } | null {
  // Headers and QP-encoded bodies are ASCII, so latin1 round-trips every byte.
  const text = raw.toString("latin1");
  const headerEnd = text.search(/\r?\n\r?\n/);
  if (headerEnd < 0) return null;
  const topHeaders = parseMimeHeaders(text.slice(0, headerEnd));
  const boundary = topHeaders["content-type"]?.match(/boundary="?([^";]+)"?/i)?.[1];
  if (!boundary) return null;

  for (const part of text.split(`--${boundary}`).slice(1)) {
    const sep = part.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const headers = parseMimeHeaders(part.slice(0, sep).replace(/^\r?\n/, ""));
    const contentType = headers["content-type"] ?? "";
    if (!/text\/html/i.test(contentType)) continue;

    const body = part.slice(sep).replace(/^\r?\n\r?\n/, "");
    const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase();
    const bytes =
      encoding === "quoted-printable"
        ? decodeQuotedPrintable(body)
        : encoding === "base64"
          ? Buffer.from(body.replace(/\s+/g, ""), "base64")
          : Buffer.from(body, "latin1");

    const charset = contentType.match(/charset="?([^";]+)"?/i)?.[1] ?? "utf-8";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      html = bytes.toString("utf8");
    }

    const url =
      topHeaders["snapshot-content-location"] ?? headers["content-location"] ?? null;
    return { html, url };
  }
  return null;
}

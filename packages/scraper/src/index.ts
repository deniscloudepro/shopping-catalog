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

  const html = await res.text();
  const $ = cheerio.load(html);
  const finalUrl = res.url || url;

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

      const image = product.image;
      if (!imageUrl) {
        if (typeof image === "string") imageUrl = image;
        else if (Array.isArray(image) && typeof image[0] === "string") imageUrl = image[0];
      }

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
    title =
      $('meta[property="og:title"]').attr("content") ??
      $("title").first().text().trim() ??
      null;
  }

  if (!imageUrl) {
    imageUrl = $('meta[property="og:image"]').attr("content") ?? null;
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

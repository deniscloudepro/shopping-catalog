/**
 * Adds a product to docs/items.json — the catalog file the site reads
 * straight from the repo. Deploying is just committing and pushing to main.
 *
 *   npx tsx scripts/add-item.ts <product URL | saved page .mht/.html>
 *   npx tsx scripts/add-item.ts --json '{"title":"…","price":123,"currency":"KZT","url":"…","imageUrl":"…"}'
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  scrapeProduct,
  parseProductHtml,
  extractHtmlFromMhtml,
  type ScrapedProduct,
} from "@catalog/scraper";

const ITEMS_FILE = resolve(import.meta.dirname, "../docs/items.json");

interface CatalogItem extends ScrapedProduct {
  createdAt: string;
}

async function productFromArg(args: string[]): Promise<ScrapedProduct> {
  if (args[0] === "--json") {
    const data = JSON.parse(args[1]);
    if (!data.title || !data.url) throw new Error("--json needs at least title and url");
    return {
      url: data.url,
      title: data.title,
      price: data.price ?? null,
      currency: data.currency ?? null,
      imageUrl: data.imageUrl ?? null,
      siteName: data.siteName ?? new URL(data.url).hostname.replace(/^www\./, ""),
    };
  }

  const input = args[0];
  if (!input) throw new Error("Usage: add-item.ts <url | file.mht | file.html> | --json '{…}'");
  if (/^https?:\/\//i.test(input)) return scrapeProduct(input);

  const raw = readFileSync(input);
  const mhtml = /\.html?$/i.test(input) ? null : extractHtmlFromMhtml(raw);
  return parseProductHtml(mhtml?.html ?? raw.toString("utf8"), mhtml?.url ?? "");
}

const product = await productFromArg(process.argv.slice(2));
if (!product.url) throw new Error("Could not determine the product URL");

const items: CatalogItem[] = JSON.parse(readFileSync(ITEMS_FILE, "utf8"));
const normalize = (u: string) => u.replace(/\/+$/, "");
const existing = items.findIndex((i) => normalize(i.url) === normalize(product.url));
const item: CatalogItem = {
  ...product,
  createdAt: existing >= 0 ? items[existing].createdAt : new Date().toISOString(),
};

if (existing >= 0) items[existing] = item;
else items.push(item);

writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2) + "\n");
console.log(existing >= 0 ? "Updated:" : "Added:", item);

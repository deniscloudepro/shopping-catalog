/**
 * Adds a product to docs/items.json — the catalog file the site reads
 * straight from the repo. Deploying is just committing and pushing to main.
 *
 *   npx tsx scripts/add-item.ts [--category id] [--subcategory id] <product URL | saved page .mht/.html>
 *   npx tsx scripts/add-item.ts [--category id] [--subcategory id] --json '{"title":"…","price":123,"currency":"KZT","url":"…","imageUrl":"…"}'
 *
 * Category/subcategory ids come from docs/categories.json.
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  scrapeProduct,
  parseProductHtml,
  extractHtmlFromMhtml,
  extractMhtmlImages,
  imageKey,
  type ScrapedProduct,
} from "@catalog/scraper";

const ITEMS_FILE = resolve(import.meta.dirname, "../docs/items.json");
const CATEGORIES_FILE = resolve(import.meta.dirname, "../docs/categories.json");
const IMAGES_DIR = resolve(import.meta.dirname, "../docs/images");

interface CatalogItem extends ScrapedProduct {
  category?: string;
  subcategory?: string;
  createdAt: string;
}

interface Category {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
}

function takeOption(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  const [, value] = args.splice(idx, 2);
  if (!value) throw new Error(`${name} needs a value`);
  return value;
}

const args = process.argv.slice(2);
const categoryId = takeOption(args, "--category");
const subcategoryId = takeOption(args, "--subcategory");

const categories: Category[] = JSON.parse(readFileSync(CATEGORIES_FILE, "utf8"));
const category = categoryId ? categories.find((c) => c.id === categoryId) : undefined;
if (categoryId && !category) {
  throw new Error(`Unknown category "${categoryId}". Known: ${categories.map((c) => c.id).join(", ")}`);
}
if (subcategoryId && !category?.subcategories.some((s) => s.id === subcategoryId)) {
  throw new Error(`Unknown subcategory "${subcategoryId}" for category "${categoryId}" — add it to docs/categories.json first`);
}

/**
 * A saved .mht page contains the photos the browser had loaded. Copy those into
 * docs/images and point the product at them, so the photos don't depend on the
 * shop's servers (hotlinks break: Sportmarafon blocks them, others expire).
 * Photos the page didn't embed stay as remote links.
 */
function hostEmbeddedPhotos(product: ScrapedProduct, raw: Buffer): ScrapedProduct {
  const embedded = extractMhtmlImages(raw);
  const slug = createHash("md5").update(product.url).digest("hex").slice(0, 8);
  const photos = product.images.length ? product.images : product.imageUrl ? [product.imageUrl] : [];
  let hosted = 0;
  const images = photos.map((url, n) => {
    const hit = embedded.get(imageKey(url));
    if (!hit) return url;
    mkdirSync(IMAGES_DIR, { recursive: true });
    const ext = hit.type.includes("png") ? "png" : hit.type.includes("webp") ? "webp" : "jpg";
    const name = `p-${slug}-${n + 1}.${ext}`;
    writeFileSync(resolve(IMAGES_DIR, name), hit.data);
    hosted++;
    return `images/${name}`;
  });
  if (hosted) console.log(`Hosted ${hosted} of ${images.length} photos from the saved page`);
  return hosted ? { ...product, images, imageUrl: images[0] ?? product.imageUrl } : product;
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
      images: data.images ?? [],
      siteName: data.siteName ?? new URL(data.url).hostname.replace(/^www\./, ""),
    };
  }

  const input = args[0];
  if (!input) throw new Error("Usage: add-item.ts <url | file.mht | file.html> | --json '{…}'");
  if (/^https?:\/\//i.test(input)) return scrapeProduct(input);

  const raw = readFileSync(input);
  const mhtml = /\.html?$/i.test(input) ? null : extractHtmlFromMhtml(raw);
  const parsed = parseProductHtml(mhtml?.html ?? raw.toString("utf8"), mhtml?.url ?? "");
  return mhtml ? hostEmbeddedPhotos(parsed, raw) : parsed;
}

const product = await productFromArg(args);
if (!product.url) throw new Error("Could not determine the product URL");

const items: CatalogItem[] = JSON.parse(readFileSync(ITEMS_FILE, "utf8"));
const normalize = (u: string) => u.replace(/\/+$/, "");
const existing = items.findIndex((i) => normalize(i.url) === normalize(product.url));
const previous = existing >= 0 ? items[existing] : undefined;
const item: CatalogItem = {
  ...product,
  category: categoryId ?? previous?.category,
  subcategory: categoryId ? subcategoryId : previous?.subcategory,
  createdAt: existing >= 0 ? items[existing].createdAt : new Date().toISOString(),
};

if (existing >= 0) items[existing] = item;
else items.push(item);

writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2) + "\n");
console.log(existing >= 0 ? "Updated:" : "Added:", item);

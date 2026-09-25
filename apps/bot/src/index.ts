import "dotenv/config";
import { Telegraf, type Context } from "telegraf";
import { appendItemRow } from "@catalog/sheets";
import { scrapeProduct, parsePrice } from "@catalog/scraper";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("Missing required env var BOT_TOKEN");

const bot = new Telegraf(token);
const URL_REGEX = /https?:\/\/\S+/i;

interface ProductData {
  url: string;
  title: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

// Chats that failed auto-parsing and are now expected to reply with
// manual product details (title / price / photo) instead of a new link.
const awaitingManualEntry = new Map<number, { url: string }>();

function formatPrice(price: number | null, currency: string | null): string {
  if (price === null) return "цена не найдена";
  return currency ? `${price} ${currency}` : `${price}`;
}

function getAddedBy(ctx: Context): string {
  const from = ctx.from;
  if (!from) return "unknown";
  return from.username ? `@${from.username}` : String(from.id);
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parseManualEntry(url: string, text: string): ProductData {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const imageLine = lines.find((line) => /^https?:\/\/\S+/i.test(line));
  const nonImageLines = lines.filter((line) => line !== imageLine);

  const title = nonImageLines[0] ?? url;
  const priceLine = nonImageLines[1];

  const price = priceLine ? parsePrice(priceLine) : null;
  const currencyMatch = priceLine?.match(/[a-zA-Zа-яА-Я]{2,5}/);

  return {
    url,
    title,
    price,
    currency: currencyMatch ? currencyMatch[0].toUpperCase() : null,
    imageUrl: imageLine ?? null,
    siteName: hostnameOf(url),
  };
}

async function persistItem(ctx: Context, addedBy: string, product: ProductData) {
  try {
    await appendItemRow({ ...product, addedBy, createdAt: new Date() });
  } catch (err) {
    console.error("Failed to append to Google Sheets", err);
    await ctx.reply(
      "Не получилось сохранить товар — проверь настройки Google Sheets (GOOGLE_SHEETS_ID / сервисный аккаунт) и попробуй ещё раз."
    );
    return;
  }

  const caption = `${product.title}\n${formatPrice(product.price, product.currency)}${
    product.siteName ? `\n${product.siteName}` : ""
  }`;

  if (product.imageUrl) {
    await ctx.replyWithPhoto(product.imageUrl, { caption }).catch(async () => {
      await ctx.reply(`${caption}\n\nДобавлено в каталог ✅`);
    });
  } else {
    await ctx.reply(`${caption}\n\nДобавлено в каталог ✅`);
  }
}

bot.start((ctx) =>
  ctx.reply(
    "Привет! Пришли ссылку на товар — я добавлю его в таблицу и на сайт-каталог."
  )
);

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();
  const addedBy = getAddedBy(ctx);

  const awaiting = awaitingManualEntry.get(chatId);
  if (awaiting) {
    awaitingManualEntry.delete(chatId);
    const product = parseManualEntry(awaiting.url, text);
    await persistItem(ctx, addedBy, product);
    return;
  }

  const match = text.match(URL_REGEX);
  if (!match) {
    await ctx.reply("Не вижу ссылки в сообщении. Пришли ссылку на товар.");
    return;
  }
  const url = match[0];

  await ctx.sendChatAction("typing");

  let product: ProductData;
  try {
    product = await scrapeProduct(url);
  } catch (err) {
    console.error("Scrape failed", err);
    awaitingManualEntry.set(chatId, { url });
    await ctx.reply(
      "Не получилось автоматически достать данные с этой страницы (сайт блокирует ботов).\n\n" +
        "Пришли вручную одним сообщением, каждое поле на отдельной строке:\n" +
        "Название\nЦена (например 4990 KZT)\nСсылка на фото (необязательно)"
    );
    return;
  }

  await persistItem(ctx, addedBy, product);
});

bot.catch((err) => console.error("Bot error", err));

bot.launch();
console.log("Bot started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

import { google } from "googleapis";

const SHEET_NAME = "Items";
const HEADER = ["Date", "Title", "Price", "Currency", "URL", "Image", "Site", "Added by"];

export interface SheetItem {
  title: string;
  price: number | null;
  currency: string | null;
  url: string;
  imageUrl: string | null;
  siteName: string | null;
  addedBy: string | null;
  createdAt: Date;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function getAuth() {
  const email = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  // Private keys stored in .env have literal "\n" sequences instead of newlines.
  const key = getEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * New spreadsheets come with a default tab (e.g. "Sheet1"), not one named
 * "Items" — create it (and the header row) the first time we touch the sheet.
 */
async function ensureSheetReady(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = meta.data.sheets?.map((s) => s.properties?.title) ?? [];

  if (!titles.includes(SHEET_NAME)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
  }

  const range = `${SHEET_NAME}!A1:H1`;
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => null);
  if (existing?.data.values?.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

/**
 * Appends a row for the item and returns the 1-based row number it landed on,
 * so the caller can store it (e.g. Item.sheetRow) for future reference.
 */
export async function appendItemRow(item: SheetItem): Promise<number | null> {
  const spreadsheetId = getEnv("GOOGLE_SHEETS_ID");
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  await ensureSheetReady(sheets, spreadsheetId);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          item.createdAt.toISOString(),
          item.title,
          item.price ?? "",
          item.currency ?? "",
          item.url,
          item.imageUrl ?? "",
          item.siteName ?? "",
          item.addedBy ?? "",
        ],
      ],
    },
  });

  const updatedRange = response.data.updates?.updatedRange;
  const match = updatedRange?.match(/!A(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export interface CatalogItem {
  rowNumber: number;
  title: string;
  price: number | null;
  currency: string | null;
  url: string;
  imageUrl: string | null;
  siteName: string | null;
  addedBy: string | null;
}

/**
 * Reads every item row from the sheet (skipping the header), newest first.
 * This is the site's only data source — there is no separate database.
 */
export async function listItems(): Promise<CatalogItem[]> {
  const spreadsheetId = getEnv("GOOGLE_SHEETS_ID");
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  await ensureSheetReady(sheets, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:H`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = response.data.values ?? [];

  const items: CatalogItem[] = [];
  rows.forEach((row, index) => {
    const [, title, price, currency, url, imageUrl, siteName, addedBy] = row;
    if (!title || !url) return;
    items.push({
      rowNumber: index + 2, // +1 for 0-index, +1 for the header row
      title: String(title),
      price: typeof price === "number" ? price : price ? Number(price) || null : null,
      currency: currency ? String(currency) : null,
      url: String(url),
      imageUrl: imageUrl ? String(imageUrl) : null,
      siteName: siteName ? String(siteName) : null,
      addedBy: addedBy ? String(addedBy) : null,
    });
  });

  return items.reverse();
}

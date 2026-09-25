// Deploy this as a Google Apps Script Web App (see README section "Google
// Apps Script"). It's the write endpoint the browser extension posts to —
// runs entirely on Google's infra, no server of our own needed.

const SHEET_ID = "12IKx_4cvxqppXKImV6MsHea90-HTGEuDjSdWi52NyNU";
const SHEET_NAME = "Items";

// Same value as EXTENSION_API_KEY in apps/bot/.env — anyone posting here
// must send it back in the request body, or the row is rejected.
const API_KEY = "PASTE_YOUR_EXTENSION_API_KEY_HERE";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.apiKey !== API_KEY) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }
    if (!body.url || !body.title) {
      return jsonResponse({ ok: false, error: "Missing url or title" });
    }

    const sheet = getOrCreateSheet();
    sheet.appendRow([
      new Date().toISOString(),
      body.title,
      body.price || "",
      body.currency || "",
      body.url,
      body.imageUrl || "",
      body.siteName || "",
      body.addedBy || "extension",
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Date", "Title", "Price", "Currency", "URL", "Image", "Site", "Added by"]);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

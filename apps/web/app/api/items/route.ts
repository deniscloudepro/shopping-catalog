import { NextRequest, NextResponse } from "next/server";
import { appendItemRow, type SheetItem } from "@catalog/sheets";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
};

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.EXTENSION_API_KEY;
  if (!expected) return false;
  return req.headers.get("x-api-key") === expected;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string" || typeof body.title !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: CORS_HEADERS });
  }

  const item: SheetItem = {
    url: body.url,
    title: body.title,
    price: typeof body.price === "number" && Number.isFinite(body.price) ? body.price : null,
    currency: typeof body.currency === "string" && body.currency ? body.currency : null,
    imageUrl: typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : null,
    siteName: typeof body.siteName === "string" && body.siteName ? body.siteName : null,
    addedBy: typeof body.addedBy === "string" && body.addedBy ? body.addedBy : "extension",
    createdAt: new Date(),
  };

  try {
    const rowNumber = await appendItemRow(item);
    return NextResponse.json({ ok: true, rowNumber }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Failed to append to Google Sheets", err);
    return NextResponse.json(
      { error: "Не получилось записать в Google Таблицу" },
      { status: 502, headers: CORS_HEADERS }
    );
  }
}

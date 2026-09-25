import { listItems, type CatalogItem } from "@catalog/sheets";

export const dynamic = "force-dynamic";

function formatPrice(price: number | null, currency: string | null) {
  if (price === null) return null;
  return currency ? `${price} ${currency}` : `${price}`;
}

export default async function HomePage() {
  let items: CatalogItem[] = [];
  let loadError: string | null = null;

  try {
    items = await listItems();
  } catch (err) {
    console.error("Failed to load items from Google Sheets", err);
    loadError = "Не получилось загрузить каталог — проверь настройки Google Sheets на сервере.";
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Мой каталог</h1>
        <span>{items.length} товаров</span>
      </div>

      {loadError ? (
        <div className="empty-state">{loadError}</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          Пока пусто. Пришли ссылку на товар боту в Telegram или добавь через расширение — он
          появится здесь.
        </div>
      ) : (
        <div className="grid">
          {items.map((item) => {
            const price = formatPrice(item.price, item.currency);
            return (
              <a
                key={item.rowNumber}
                className="card"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                <div className="card-image">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={item.title} loading="lazy" />
                  ) : (
                    <span className="placeholder">нет фото</span>
                  )}
                </div>
                <div className="card-body">
                  <div className="card-title">{item.title}</div>
                  {price && <div className="card-price">{price}</div>}
                  {item.siteName && <div className="card-site">{item.siteName}</div>}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

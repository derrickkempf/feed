// Fourthwall Storefront API adapter.
// Docs: https://docs.fourthwall.com/storefront/overview
// The storefront token (ptkn_...) is a public, read-only catalog token.

const TOKEN = import.meta.env.VITE_FW_STOREFRONT_TOKEN;
const CHECKOUT_DOMAIN = import.meta.env.VITE_FW_CHECKOUT_DOMAIN; // e.g. my-shop.fourthwall.com
const API = "https://storefront-api.fourthwall.com/v1";

export const fourthwallEnabled = () => Boolean(TOKEN);

export async function getAllProducts() {
  if (!TOKEN) return [];
  const products = [];
  let page = 0;
  let hasMore = true;
  while (hasMore && page < 20) {
    const res = await fetch(`${API}/collections/all/products?storefront_token=${TOKEN}&page=${page}&size=50`);
    if (!res.ok) throw new Error(`Fourthwall ${res.status}`);
    const data = await res.json();
    products.push(...(data.results || []));
    hasMore = data.paging?.hasNextPage;
    page++;
  }
  return products.map((p) => ({
    slug: p.slug,
    name: p.name,
    price: formatPrice(p),
    variantId: p.variants?.[0]?.id || null,
    url: CHECKOUT_DOMAIN ? `https://${CHECKOUT_DOMAIN}/products/${p.slug}` : null,
  }));
}

function formatPrice(p) {
  const v = p.variants?.[0]?.unitPrice;
  if (!v) return "";
  const amount = v.value ?? v.amount;
  const currency = v.currency || "USD";
  if (amount == null) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// Create a cart, return the hosted-checkout URL. Falls back to the product URL.
export async function checkoutUrl(product) {
  if (TOKEN && CHECKOUT_DOMAIN && product.variantId) {
    try {
      const res = await fetch(`${API}/carts?storefront_token=${TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ variantId: product.variantId, quantity: 1 }] }),
      });
      if (res.ok) {
        const cart = await res.json();
        if (cart?.id) return `https://${CHECKOUT_DOMAIN}/checkout/?cartCurrency=USD&cartToken=${cart.id}`;
      }
    } catch {}
  }
  return product.url || null;
}

import { recalculateOperationalProductSales, type OperationalSaleLedgerInput } from "./tracker-accounting.ts";

export type OperationalProduct = {
  id: string;
  quantity: number;
  purchasePriceOre: number;
  purchaseShippingOre: number;
  operationalPurchasePriceOre?: number | null;
  operationalPurchaseShippingOre?: number | null;
};

export type OperationalSale = OperationalSaleLedgerInput & { productId: string };

export function operationalSalesById(products: OperationalProduct[], sales: OperationalSale[]) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const salesByProduct = new Map<string, OperationalSale[]>();
  for (const sale of sales) {
    const productSales = salesByProduct.get(sale.productId) ?? [];
    productSales.push(sale); salesByProduct.set(sale.productId, productSales);
  }
  const results = new Map<string, ReturnType<typeof recalculateOperationalProductSales>["sales"][number]>();
  for (const [productId, productSales] of salesByProduct) {
    const product = productsById.get(productId);
    if (!product) continue;
    for (const sale of recalculateOperationalProductSales(product, productSales).sales) results.set(sale.id, sale);
  }
  return results;
}

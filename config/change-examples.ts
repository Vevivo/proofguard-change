export const SOURCE_BEFORE = "Express orders arrive the next business day. Standard delivery: 2–4 business days. Unit price: TRY 240.";
export const SOURCE_CHANGED = "Express orders are dispatched the next business day; transit takes 2–4 business days. Standard delivery: 2–4 business days. Unit price: TRY 240.";
export const SOURCE_WORDING = "Express orders are delivered on the next business day. Standard shipping takes 2–4 business days. The unit price remains TRY 240.";
export const EXAMPLE_ACTIONS = [
  { id: "event-order", label: "Purchase for tomorrow’s event", condition: "Express delivery must arrive the next business day. Next-day dispatch alone is not sufficient.", tool: "prepare_purchase_order", target: "event-team", payload: { shipping: "express", quantity: 10, unit_price_try: 240, required_arrival: "next_business_day" } },
  { id: "stock-order", label: "Warehouse restock", condition: "Standard delivery must take no more than 4 business days and the unit price must be TRY 240.", tool: "prepare_purchase_order", target: "stock-team", payload: { shipping: "standard", quantity: 25, unit_price_try: 240 } },
  { id: "price-report", label: "Price comparison report", condition: "The unit price must be TRY 240. This report does not depend on delivery time or the express option.", tool: "prepare_price_report", target: "procurement-team", payload: { unit_price_try: 240, currency: "TRY" } },
];

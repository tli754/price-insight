export type InventoryAlertColor = 'error' | 'warning' | 'success' | 'neutral'

export interface InventoryAlertResult {
  text: string
  color: InventoryAlertColor
  days: number | null
}

export function calcInventoryAlert(
  inventoryQuantity: number | null | undefined,
  sold7d: number | null | undefined,
  sold30d: number | null | undefined,
  sold90d: number | null | undefined
): InventoryAlertResult | null {
  if (inventoryQuantity == null) return null
  if (inventoryQuantity === 0) return { text: 'Out of stock', color: 'error', days: 0 }
  if (!sold90d) return { text: 'No recent sales', color: 'neutral', days: null }

  const dailyRate90 = sold90d / 90
  const dailyRate30 = (sold30d ?? 0) / 30
  const dailyRate7 = (sold7d ?? 0) / 7
  const estimatedDailySalesRate = (sold30d ?? 0) < 3
    ? dailyRate90
    : dailyRate7 * 0.50 + dailyRate30 * 0.35 + dailyRate90 * 0.15

  const days = Math.floor(inventoryQuantity / estimatedDailySalesRate)
  if (days > 90) return { text: '90+ days stock remaining', color: 'success', days }
  if (days <= 15) return { text: `Critical — about ${days} days left`, color: 'error', days }
  if (days <= 30) return { text: `Low stock — about ${days} days left`, color: 'warning', days }
  return { text: `About ${days} days stock remaining`, color: 'success', days }
}

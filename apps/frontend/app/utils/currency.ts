export function formatCurrencyDisplay(price: number | null, currency: string): string {
  if (price == null) return '—'
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: currency || 'NZD',
    minimumFractionDigits: 2
  }).format(price)
}

export function formatCurrencyRaw(extracted: number | null, raw: string | null, currency: string | null): string {
  if (raw) return raw
  if (extracted == null) return '—'
  return [currency, extracted].filter(Boolean).join(' ')
}

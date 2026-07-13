// Types for the leads dashboard. These mirror the PINNED API contract exposed by
// the leads service (Agent D) via the Nitro proxy `/leads-api/**` → leads `/api/**`.

// Full lifecycle status set (score-gated pipeline). Kept as a const tuple so it
// can drive both the TS union and the runtime `USelect` options.
export const LIFECYCLE_STATUSES = [
  'new',
  'scored',
  'analysed',
  'contacted',
  'meet',
  'customer',
  'rejected',
] as const

export type LeadStatus = (typeof LIFECYCLE_STATUSES)[number]

// GET /leads-api/leads → { items: LeadListItem[], total, page, pageSize }
export interface LeadListItem {
  id: string
  domain: string
  companyName: string
  platform: string | null
  country: string | null
  vertical: string | null
  status: LeadStatus
  scoreOverall: number | null
  reasons: string[]
  primaryEmail: string | null
}

export interface LeadListResponse {
  items: LeadListItem[]
  total: number
  page: number
  pageSize: number
}

// PATCH /leads-api/leads/:id/status body { status } → { ok: true, status }
export interface LeadStatusUpdateResponse {
  ok: true
  status: LeadStatus
}

// POST /leads-api/leads/import (multipart xlsx upload) → ImportSummary
export interface LeadImportSummary {
  total: number
  rejected: number
  scored: number
  byReason: Record<string, number>
}

// GET /leads-api/leads/:id → full company document. The exact shape is owned by
// the leads service; these are the fields the detail page reads defensively.
export interface LeadScoreComponent {
  label: string
  value: number
}

export interface LeadContact {
  name?: string | null
  role?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
}

export interface LeadSignal {
  label: string
  value?: string | number | boolean | null
  detail?: string | null
}

export interface LeadDetail {
  id: string
  domain: string
  companyName: string
  platform: string | null
  country: string | null
  vertical: string | null
  status: LeadStatus
  scoreOverall: number | null
  reasons: string[]
  primaryEmail: string | null
  scoreComponents?: LeadScoreComponent[]
  contacts?: LeadContact[]
  signals?: LeadSignal[]
  createdAt?: string
  updatedAt?: string
  // The leads service may return additional fields; keep the type open.
  [key: string]: unknown
}

const NZ_TZ = "Pacific/Auckland";

/**
 * Returns the start and end of today in Pacific/Auckland time as UTC Dates.
 * Handles both NZST (UTC+12) and NZDT (UTC+13) automatically.
 */
export function getTodayNZRange(): { from: Date; to: Date } {
  const now = new Date();
  const nzDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: NZ_TZ }).format(now);

  // Try NZDT (+13) first (summer), then NZST (+12) (winter).
  for (const offset of ["+13:00", "+12:00"]) {
    const candidate = new Date(`${nzDateStr}T00:00:00${offset}`);
    if (new Intl.DateTimeFormat("en-CA", { timeZone: NZ_TZ }).format(candidate) === nzDateStr) {
      return {
        from: candidate,
        to: new Date(candidate.getTime() + 24 * 60 * 60 * 1000 - 1),
      };
    }
  }

  // Fallback — should never be reached for NZ timezone.
  const from = new Date(`${nzDateStr}T00:00:00+12:00`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

/** Returns a Date 24 hours before now — used for scheduled rolling-window discovery. */
export function getLast24Hours(now = new Date()): Date {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/** Returns a Date 36 hours before now. */
export function getLast36Hours(now = new Date()): Date {
  return new Date(now.getTime() - 36 * 60 * 60 * 1000);
}

/**
 * Extracts a human-readable message from a failed `$fetch` error.
 * The backend returns errors as `{ error: { code, message } }`, which
 * `$fetch` exposes on `error.data`. Falls back to the provided default.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: { message?: string }; message?: string } })?.data
  return data?.error?.message ?? data?.message ?? fallback
}

/** Advisory usage accompanying mail responses. Native writes enforce the cap. */
export interface StorageWarning {
  threshold: 90 | 95 | 99 | 100;
  used_bytes: number;
  limit_bytes: number;
  cleanup_url?: string;
  billing_url?: string;
}

/** Read from a custom fetch response without consuming its body. */
export function storageWarningFromHeaders(headers: Headers): StorageWarning | undefined {
  if (headers.get("x-extrovert-storage-status") !== "available") return;
  const threshold = Number(headers.get("x-extrovert-storage-threshold"));
  if (!headers.has("x-extrovert-storage-used-bytes") || !headers.has("x-extrovert-storage-limit-bytes")) return;
  const used = Number(headers.get("x-extrovert-storage-used-bytes"));
  const limit = Number(headers.get("x-extrovert-storage-limit-bytes"));
  if (![90, 95, 99, 100].includes(threshold) || !Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(limit) || limit < 0) return;
  const link = (name: string): string | undefined => {
    const raw = headers.get(name); if (!raw || raw.length > 2048) return;
    try { const url = new URL(raw); if (url.protocol === "https:" && !url.username && !url.password) return url.href; } catch { /* Invalid advisory metadata is omitted. */ }
  };
  return { threshold: threshold as StorageWarning["threshold"], used_bytes: used, limit_bytes: limit, cleanup_url: link("x-extrovert-storage-cleanup-url"), billing_url: link("x-extrovert-storage-billing-url") };
}

/** Which company the user belongs to. Persisted per browser; sent with every API call. */
const KEY = 'brandcopilot.brandId';
const listeners = new Set<(id: string) => void>();

export function getBrandId(): string {
  try {
    return localStorage.getItem(KEY) || new URLSearchParams(location.search).get('brand') || 'xero';
  } catch {
    return 'xero';
  }
}

export function setBrandId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  listeners.forEach((l) => l(id));
}

export function onBrandChange(l: (id: string) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export type EmissionIntent = { key: string; fingerprint: string };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function emissionIntentSlot(userId: string, companyId: string) { return `nfse.emission-intent.v1:${userId}:${companyId}`; }
export function readEmissionIntent(storage: StorageLike, slot: string): EmissionIntent | null {
  const value = storage.getItem(slot);
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!/^[a-z0-9:_-]{8,160}$/i.test(parsed.key) || !/^[a-f0-9]{64}$/.test(parsed.fingerprint)) throw new Error('Solicitação local inconsistente. Procure o suporte antes de reenviar.');
  return { key: parsed.key, fingerprint: parsed.fingerprint };
}
/** Only opaque IDs and a digest live in sessionStorage, never fiscal payloads. */
export async function getEmissionIntent(storage: StorageLike, slot: string, payloadJson: string): Promise<EmissionIntent> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadJson));
  const fingerprint = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
  const previous = readEmissionIntent(storage, slot);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error('Existe uma solicitação anterior. Verifique seu resultado antes de enviar dados diferentes.');
    return previous;
  }
  const intent = { key: crypto.randomUUID(), fingerprint };
  storage.setItem(slot, JSON.stringify(intent));
  return intent;
}
export function clearEmissionIntent(storage: StorageLike, slot: string, key: string) {
  if (readEmissionIntent(storage, slot)?.key === key) storage.removeItem(slot);
}

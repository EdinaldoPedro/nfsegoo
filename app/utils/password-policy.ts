export const MAX_PASSWORD_BYTES = 72;

export function passwordPolicyError(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'Informe uma senha.';
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) return 'A senha deve ter no máximo 72 bytes.';
  if (value.length < 8 || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return 'A senha deve ter pelo menos 8 caracteres, 1 letra maiúscula, 1 número e 1 caractere especial.';
  }
  return null;
}

export interface NationalAddressLike {
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  codigoIbge?: string | null;
}

export interface NationalAddressValidation {
  valid: boolean;
  missing: string[];
  message?: string;
}

const REQUIRED_FIELDS: Array<{ key: keyof NationalAddressLike; label: string }> = [
  { key: 'cep', label: 'CEP' },
  { key: 'logradouro', label: 'logradouro' },
  { key: 'numero', label: 'número' },
  { key: 'bairro', label: 'bairro' },
  { key: 'cidade', label: 'cidade' },
  { key: 'uf', label: 'UF' },
  { key: 'codigoIbge', label: 'código IBGE' },
];

export const PF_ADDRESS_REQUIRED_CODE = 'TOMADOR_PF_ENDERECO_OBRIGATORIO';

export function validateNationalAddress(address: NationalAddressLike): NationalAddressValidation {
  const missing = REQUIRED_FIELDS
    .filter(({ key }) => !String(address?.[key] || '').trim())
    .map(({ label }) => label);

  if (missing.length > 0) {
    return {
      valid: false,
      missing,
      message: `Endereço incompleto: informe ${missing.join(', ')}.`,
    };
  }

  const cep = String(address.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) {
    return { valid: false, missing: [], message: 'CEP inválido. Informe 8 dígitos.' };
  }

  const codigoIbge = String(address.codigoIbge || '').replace(/\D/g, '');
  if (codigoIbge.length !== 7) {
    return { valid: false, missing: [], message: 'Código IBGE inválido. Consulte o CEP novamente.' };
  }

  const uf = String(address.uf || '').trim();
  if (!/^[A-Za-z]{2}$/.test(uf)) {
    return { valid: false, missing: [], message: 'UF inválida. Informe a sigla com 2 letras.' };
  }

  return { valid: true, missing: [] };
}

export function hasCompleteNationalAddress(address: NationalAddressLike) {
  return validateNationalAddress(address).valid;
}

export function getPfAddressRequiredMessage(address: NationalAddressLike) {
  const validation = validateNationalAddress(address);
  if (validation.valid) return '';
  return `O endereço completo da pessoa física é obrigatório para emitir. ${validation.message} Atualize o cadastro do cliente antes de continuar.`;
}

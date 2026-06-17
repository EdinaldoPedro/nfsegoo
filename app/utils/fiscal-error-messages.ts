export const NBS_EXPORTACAO_SUPPORT_MESSAGE =
  'Esta emissao para o exterior exige um codigo NBS vinculado ao servico. Abra um ticket em Suporte pelo botao Ajuda e informe a empresa, o tomador e a atividade/CNAE para que nossa equipe vincule o NBS correto internamente antes do reenvio.';

function stringifySafe(value: unknown) {
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
}

export function isErroNbsExportacao(value: unknown) {
  const text = stringifySafe(value).toLowerCase();

  return (
    text.includes('e0318') ||
    text.includes('item da nbs') ||
    (text.includes('nbs') && (text.includes('exportacao') || text.includes('exporta')))
  );
}

export function getMensagemErroFiscalCliente(value: unknown) {
  if (isErroNbsExportacao(value)) {
    return {
      message: NBS_EXPORTACAO_SUPPORT_MESSAGE,
      needsSupport: true,
      reasonType: 'NBS_EXPORTACAO',
    };
  }

  return null;
}

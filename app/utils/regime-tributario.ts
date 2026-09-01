export const REGIMES_TRIBUTARIOS_SUPORTADOS = [
  'MEI',
  'SIMPLES',
  'LUCRO_PRESUMIDO',
] as const;

export type RegimeTributarioSuportado = typeof REGIMES_TRIBUTARIOS_SUPORTADOS[number];

const regimesSuportados = new Set<string>(REGIMES_TRIBUTARIOS_SUPORTADOS);

export function normalizarRegimeTributario(regime: unknown): RegimeTributarioSuportado | null {
  const normalizado = String(regime || '').trim().toUpperCase();
  return regimesSuportados.has(normalizado) ? normalizado as RegimeTributarioSuportado : null;
}

export function assertRegimeTributarioSuportado(regime: unknown): RegimeTributarioSuportado {
  const normalizado = normalizarRegimeTributario(regime);
  if (normalizado) return normalizado;

  const semRegime = !String(regime || '').trim();
  throw Object.assign(
    new Error(semRegime ? 'Regime tributario nao informado.' : 'Regime tributario nao atendido pelo SaaS.'),
    {
      status: 400,
      code: semRegime ? 'REGIME_TRIBUTARIO_OBRIGATORIO' : 'REGIME_TRIBUTARIO_NAO_SUPORTADO',
      userAction: semRegime
        ? 'Selecione o Regime Tributario nas Configuracoes da Empresa antes de emitir.'
        : 'O SaaS atende MEI, Simples Nacional e Lucro Presumido. Revise o cadastro da empresa antes de emitir.',
    },
  );
}

// These terms describe access to this SaaS, not legal ownership of a CNPJ.
export const OWNERSHIP_TERMS_VERSION = '2026-09-03-v1';
export const OWNERSHIP_TERMS = [
  'A conta destinatária assumirá o cadastro e terá acesso ao histórico fiscal, vendas e carteira de tomadores desta empresa no SaaS. Isto não altera a titularidade jurídica do CNPJ.',
  'A conta destinatária será responsável pelas novas operações no modo de cobrança por responsável único. Contratos, faturas, pedidos e créditos anteriores não serão transferidos nem apagados.',
  'Os vínculos anteriores de operadores e contadores serão revogados, preservando seu registro histórico. A conta anterior perderá o acesso; obtenha antes os documentos que esteja autorizado a conservar.',
  'O certificado A1 e a senha armazenados serão removidos desta configuração, sem transferência da chave privada. A empresa voltará à homologação e o novo responsável deverá configurar seu certificado e autorizar produção novamente.',
  'Notas, XMLs, vendas, tomadores e sequências DPS serão preservados. Não haverá emissão, cancelamento de nota ou cobrança automática nesta transferência.',
  'O aceite não conclui a transferência. A administração ainda deve conferir consentimentos, evidências, capacidade do plano e inexistência de operações fiscais pendentes. Qualquer participante pode rejeitar antes da conclusão.',
] as const;

export type OwnershipView = {
  id: string; empresaId: string; documento: string; razaoSocial: string;
  recipient: { id: string; nome: string; email: string };
  mode: string; status: string; termsVersion: string; termsHash: string;
  createdAt: string; expiresAt: string; finishedAt: string | null;
  requiredConsents: { key: string; label: string; accepted: boolean }[];
  canConsent: boolean; canReject: boolean; canCancel: boolean; canFinalize: boolean;
  initiatorId?: string; caseTicketId?: string; evidenceMessageId?: string; justification?: string;
};

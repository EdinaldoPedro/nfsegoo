export const legalUpdatedAt = process.env.NEXT_PUBLIC_LEGAL_UPDATED_AT || "3 de junho de 2026";
export const termsVersion = process.env.NEXT_PUBLIC_TERMS_VERSION || "terms-2026-06-03-draft-1";
export const privacyVersion = process.env.NEXT_PUBLIC_PRIVACY_VERSION || "privacy-2026-06-03-draft-1";

export const companyLegalName = process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME || "NFSe Goo";
export const companyLegalCnpj = process.env.NEXT_PUBLIC_LEGAL_COMPANY_CNPJ || "";
export const companyLegalAddress = process.env.NEXT_PUBLIC_LEGAL_COMPANY_ADDRESS || "";
export const privacyOfficerName = process.env.NEXT_PUBLIC_PRIVACY_OFFICER_NAME || "";
export const privacyContactEmail = process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL || "privacidade@nfsegoo.com.br";
export const supportContactEmail = process.env.NEXT_PUBLIC_SUPPORT_CONTACT_EMAIL || "suporte@nfsegoo.com.br";
export const legalDocumentsApproved = process.env.NEXT_PUBLIC_LEGAL_DOCUMENTS_APPROVED === "true"
  && !termsVersion.includes("draft") && !privacyVersion.includes("draft")
  && Boolean(companyLegalCnpj && companyLegalAddress && privacyOfficerName);

export const legalNotice = legalDocumentsApproved ? null
  : "Aviso: este documento descreve o escopo operacional e as praticas atuais da plataforma, mas ainda precisa de aprovacao juridica e identificacao completa do controlador. A comercializacao deve permanecer bloqueada ate configurar razao social, CNPJ, endereco, encarregado/DPO, canais, versoes finais e a confirmacao de aprovacao.";

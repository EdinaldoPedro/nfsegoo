export interface SocialRetentionFlag {
  retido: boolean;
  valor: number;
}

export interface IbsCbsPilotConfig {
  ibsCbsPilotoAtivo?: boolean | null;
  ibsCbsMeiAtivo?: boolean | null;
  ibsCbsSimplesAtivo?: boolean | null;
  ibsCbsLucroPresumidoAtivo?: boolean | null;
}

export interface IbsCbsPilotControl {
  masterEnabled: boolean;
  regimeEnabled: boolean;
  enabled: boolean;
}

export interface FederalRetentionEligibility {
  domesticLegalEntity: boolean;
  crsfAndIrrf: boolean;
  inss: boolean;
  reason: 'DOMESTIC_PJ' | 'PF' | 'EXTERIOR' | 'REGIME_SIMPLES' | 'UNKNOWN_RECIPIENT';
}

export function getFederalRetentionEligibility(regime: string, recipientType?: string, recipientCountry?: string): FederalRetentionEligibility {
  const normalizedRegime = String(regime || '').trim().toUpperCase();
  const type = String(recipientType || '').trim().toUpperCase();
  const country = String(recipientCountry || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const foreignCountry = Boolean(country) && !['BR', 'BRASIL', 'BRAZIL', '1058'].includes(country);
  const isForeign = type === 'EXT' || foreignCountry;
  const isPf = type === 'PF';

  // Compatibilidade para jobs antigos: quando não há classificação do tomador,
  // preserva-se a decisão explícita recebida e não se inventa uma trava nova.
  if (!type && !country) {
    const simpleProvider = ['MEI', 'SIMPLES'].includes(normalizedRegime);
    return {
      domesticLegalEntity: false,
      crsfAndIrrf: !simpleProvider,
      inss: normalizedRegime !== 'MEI',
      reason: 'UNKNOWN_RECIPIENT',
    };
  }

  if (isForeign) return { domesticLegalEntity: false, crsfAndIrrf: false, inss: false, reason: 'EXTERIOR' };
  if (isPf || type !== 'PJ') return { domesticLegalEntity: false, crsfAndIrrf: false, inss: false, reason: 'PF' };

  const simpleProvider = ['MEI', 'SIMPLES'].includes(normalizedRegime);
  return {
    domesticLegalEntity: true,
    crsfAndIrrf: !simpleProvider,
    inss: normalizedRegime !== 'MEI',
    reason: simpleProvider ? 'REGIME_SIMPLES' : 'DOMESTIC_PJ',
  };
}

export function getIbsCbsPilotControl(regime: string, config?: IbsCbsPilotConfig | null): IbsCbsPilotControl {
  const normalized = String(regime || '').toUpperCase();
  const masterEnabled = config?.ibsCbsPilotoAtivo ?? true;
  const defaults: Record<string, boolean> = {
    MEI: false,
    SIMPLES: false,
    LUCRO_PRESUMIDO: true,
  };
  const configured: Record<string, boolean | null | undefined> = {
    MEI: config?.ibsCbsMeiAtivo,
    SIMPLES: config?.ibsCbsSimplesAtivo,
    LUCRO_PRESUMIDO: config?.ibsCbsLucroPresumidoAtivo,
  };
  const regimeEnabled = configured[normalized] ?? defaults[normalized] ?? false;
  return { masterEnabled, regimeEnabled, enabled: masterEnabled && regimeEnabled };
}

export function shouldEnableIbsCbs({
  mandatory,
  competence,
  pilotEnabled,
  ruleEnabled,
}: {
  mandatory: boolean;
  competence: string;
  pilotEnabled: boolean;
  ruleEnabled: boolean;
}) {
  return mandatory || (
    competence.slice(0, 10) >= '2026-01-01'
    && pilotEnabled
    && ruleEnabled
  );
}

export function roundHalfEven(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const tolerance = 1e-9;
  if (Math.abs(fraction - 0.5) <= tolerance) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round(scaled + Number.EPSILON) / factor;
}

export function meetsFederalRetentionMinimum(value: number, minimum = 10.01) {
  return roundHalfEven(Number(value) || 0) >= (Number(minimum) || 0);
}

export function retentionType(retencoes: { pis: SocialRetentionFlag; cofins: SocialRetentionFlag; csll: SocialRetentionFlag }) {
  const pis = retencoes.pis.retido && retencoes.pis.valor > 0;
  const cofins = retencoes.cofins.retido && retencoes.cofins.valor > 0;
  const csll = retencoes.csll.retido && retencoes.csll.valor > 0;
  if (!pis && !cofins && !csll) return '0';
  if (pis && cofins && csll) return '3';
  if (pis && cofins) return '4';
  if (pis && !cofins && !csll) return '5';
  if (!pis && cofins && !csll) return '6';
  if (!pis && cofins && csll) return '7';
  if (!pis && !cofins && csll) return '8';
  if (pis && !cofins && csll) return '9';
  return '0';
}

export function getIbsCbsMandatoryDate(regime: string, itemLc?: string, overrideDate?: string | Date | null) {
  const normalized = String(regime || '').toUpperCase();
  if (['MEI', 'SIMPLES'].includes(normalized)) return '2027-01-01';
  if (overrideDate) {
    return overrideDate instanceof Date ? overrideDate.toISOString().slice(0, 10) : String(overrideDate).slice(0, 10);
  }
  const item = String(itemLc || '').replace(/[^\d.]/g, '');
  const delayedItems = new Set(['1.03', '1.05', '1.09', '16.01']);
  if (!item || item === '00.00' || delayedItems.has(item)) return '2026-12-01';
  return '2026-10-01';
}

export function isIbsCbsMandatory(regime: string, competence: string, itemLc?: string, overrideDate?: string | Date | null) {
  return competence.slice(0, 10) >= getIbsCbsMandatoryDate(regime, itemLc, overrideDate);
}

export function getPisCofinsDueDefaults(regime: string) {
  if (String(regime || '').toUpperCase() === 'LUCRO_PRESUMIDO') {
    return { enabled: true, pis: 0.65, cofins: 3, cst: '01' };
  }
  return { enabled: false, pis: 0, cofins: 0, cst: '01' };
}

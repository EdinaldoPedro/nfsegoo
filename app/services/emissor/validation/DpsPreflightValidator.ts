import { DOMParser } from '@xmldom/xmldom';

export interface DpsValidationIssue {
  code: string;
  message: string;
  path?: string;
}

const text = (document: Document, tag: string) => document.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

export function validateDpsXml(xml: string): DpsValidationIssue[] {
  const issues: DpsValidationIssue[] = [];
  const parserErrors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => parserErrors.push(message),
      fatalError: (message) => parserErrors.push(message),
    },
  }).parseFromString(xml, 'application/xml');

  if (parserErrors.length) {
    return [{ code: 'XML_MALFORMADO', message: parserErrors.join(' ') }];
  }

  const root = document.documentElement;
  if (root?.localName !== 'DPS') issues.push({ code: 'RAIZ_INVALIDA', message: 'O documento deve possuir raiz DPS.', path: '/DPS' });
  const version = root?.getAttribute('versao') || '';
  if (version !== '1.01') issues.push({ code: 'VERSAO_NAO_SUPORTADA', message: `Leiaute ${version || 'ausente'} nao suportado pelo emissor atual.`, path: '/DPS/@versao' });

  const infDps = document.getElementsByTagName('infDPS')[0];
  const id = infDps?.getAttribute('Id') || '';
  if (!/^DPS\d{42}$/.test(id)) issues.push({ code: 'ID_DPS_INVALIDO', message: 'Identificador da DPS deve seguir municipio, inscricao, serie e numero.', path: '/DPS/infDPS/@Id' });

  const required: Array<[string, RegExp | null]> = [
    ['tpAmb', /^[12]$/], ['dhEmi', /^\d{4}-\d{2}-\d{2}T/], ['serie', /^\d{1,5}$/],
    ['nDPS', /^\d{1,15}$/], ['dCompet', /^\d{4}-\d{2}-\d{2}$/], ['cLocEmi', /^\d{7}$/],
    ['cTribNac', /^\d{6}$/], ['vServ', /^\d+\.\d{2}$/], ['tribISSQN', /^[1-4]$/], ['tpRetISSQN', /^[123]$/],
  ];
  for (const [tag, pattern] of required) {
    const value = text(document, tag);
    if (!value) issues.push({ code: `CAMPO_${tag.toUpperCase()}_AUSENTE`, message: `${tag} e obrigatorio.`, path: `//${tag}` });
    else if (pattern && !pattern.test(value)) issues.push({ code: `CAMPO_${tag.toUpperCase()}_INVALIDO`, message: `${tag} possui formato invalido.`, path: `//${tag}` });
  }

  const toma = document.getElementsByTagName('toma')[0];
  const tomadorCpf = toma?.getElementsByTagName('CPF')[0];
  const tomadorEndereco = toma?.getElementsByTagName('end')[0];
  if (tomadorCpf && !tomadorEndereco) {
    issues.push({
      code: 'TOMADOR_PF_ENDERECO_AUSENTE',
      message: 'O endereço completo da pessoa física é obrigatório nesta aplicação.',
      path: '/DPS/infDPS/toma/end',
    });
  } else if (tomadorCpf && tomadorEndereco) {
    const requiredPfAddress: Array<[string, RegExp | null]> = [
      ['cMun', /^\d{7}$/], ['CEP', /^\d{8}$/], ['xLgr', null], ['nro', null], ['xBairro', null],
    ];
    for (const [tag, pattern] of requiredPfAddress) {
      const value = tomadorEndereco.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
      if (!value || (pattern && !pattern.test(value))) {
        issues.push({
          code: `TOMADOR_PF_${tag.toUpperCase()}_INVALIDO`,
          message: `${tag} do endereço da pessoa física está ausente ou inválido.`,
          path: `/DPS/infDPS/toma/end/${tag}`,
        });
      }
    }
  }

  const opSimpNac = text(document, 'opSimpNac');
  if (opSimpNac === '2') {
    if (document.getElementsByTagName('cTribMun').length > 0) {
      issues.push({ code: 'MEI_CTRIBMUN_INDEVIDO', message: 'cTribMun deve ser omitido para MEI.', path: '/DPS/infDPS/serv/cServ/cTribMun' });
    }
    if (document.getElementsByTagName('pAliq').length > 0) {
      issues.push({ code: 'MEI_PALIQ_INDEVIDA', message: 'pAliq do ISS deve ser omitida para MEI.', path: '/DPS/infDPS/trib/tribMun/pAliq' });
    }
  }

  const ibs = document.getElementsByTagName('IBSCBS')[0];
  if (ibs) {
    const requiredIbs: Array<[string, RegExp]> = [
      ['finNFSe', /^0$/], ['cIndOp', /^\d{6}$/], ['indDest', /^[01]$/], ['CST', /^\d{3}$/], ['cClassTrib', /^\d{6}$/],
    ];
    for (const [tag, pattern] of requiredIbs) {
      const nodes = ibs.getElementsByTagName(tag);
      const value = nodes[0]?.textContent?.trim() || '';
      if (!pattern.test(value)) issues.push({ code: `IBSCBS_${tag.toUpperCase()}_INVALIDO`, message: `${tag} do IBS/CBS esta ausente ou invalido.`, path: `/DPS/infDPS/IBSCBS/${tag}` });
    }
    const cst = ibs.getElementsByTagName('CST')[0]?.textContent?.trim() || '';
    const classification = ibs.getElementsByTagName('cClassTrib')[0]?.textContent?.trim() || '';
    const indFinal = ibs.getElementsByTagName('indFinal')[0]?.textContent?.trim();
    if (indFinal !== undefined && !/^[01]$/.test(indFinal)) {
      issues.push({ code: 'IBSCBS_INDFINAL_INVALIDO', message: 'indFinal do IBS/CBS deve ser 0 ou 1.', path: '/DPS/infDPS/IBSCBS/indFinal' });
    }
    if (cst && classification && classification.slice(0, 3) !== cst) {
      issues.push({ code: 'IBSCBS_CLASSIFICACAO_INCOMPATIVEL', message: 'cClassTrib nao pertence ao grupo do CST indicado.', path: '/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS' });
    }
  }

  if (xml.includes('<cMun>9999999</cMun>')) issues.push({ code: 'IBGE_PLACEHOLDER', message: 'Codigo IBGE ficticio nao pode ser transmitido.', path: '//cMun' });
  if (xml.includes('<cPais>XX</cPais>')) issues.push({ code: 'PAIS_PLACEHOLDER', message: 'Pais exterior deve possuir codigo ISO2 valido.', path: '//cPais' });
  if (xml.includes('<xBairro>Bairro</xBairro>')) issues.push({ code: 'BAIRRO_PLACEHOLDER', message: 'Bairro generico nao pode ser transmitido.', path: '//xBairro' });

  return issues;
}

export function assertValidDpsXml(xml: string) {
  const issues = validateDpsXml(xml);
  if (!issues.length) return;
  throw Object.assign(new Error(issues.map((issue) => issue.message).join(' ')), {
    status: 400,
    code: 'DPS_PREFLIGHT_INVALIDA',
    userAction: 'Revise os dados fiscais indicados antes de transmitir.',
    validationIssues: issues,
  });
}

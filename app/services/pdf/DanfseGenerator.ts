import { DOMParser } from '@xmldom/xmldom';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

type XmlNode = Element | null | undefined;

export interface DanfseGeneratorOptions {
  cancelada?: boolean;
  substituida?: boolean;
  eventoCancelamentoXml?: string | null;
}

export interface DanfseData {
  ambiente: string;
  ambienteGerador: string;
  chaveAcesso: string;
  numeroNfse: string;
  competencia: string;
  emissaoNfse: string;
  numeroDps: string;
  serieDps: string;
  emissaoDps: string;
  emitenteTipo: string;
  situacao: string;
  finalidade: string;
  municipioEmissao: string;
  ufEmissao: string;
  prestador: Participante;
  tomador: Participante;
  destinatario: Participante;
  intermediario: Participante;
  servico: {
    codigoTributacao: string;
    codigoNbs: string;
    localPrestacao: string;
    descricaoTributacao: string;
    descricao: string;
  };
  issqn: Record<string, string>;
  federal: Record<string, string>;
  ibscbs: Record<string, string>;
  totais: Record<string, string>;
  informacoesComplementares: string;
}

interface Participante {
  tipo: string;
  documento: string;
  inscricaoMunicipal: string;
  telefone: string;
  nome: string;
  municipioUf: string;
  codigoIbgeCep: string;
  endereco: string;
  email: string;
  simplesNacional: string;
  regimeApuracao: string;
}

const PT_TO_MM = 25.4 / 72;
export const DANFSE_LAYOUT = Object.freeze({
  page: { width: 210, height: 297 },
  margin: 3,
  outerBorderMm: 0.35,
  internalLineMm: 0.5 * PT_TO_MM,
  qr: { x: 172.8, y: 18.4, size: 15.2 },
  contentBottom: 279,
  footerY: 281,
});

type DanfseFonts = { title: string; content: string; embedded: boolean };
const fontsByDocument = new WeakMap<jsPDF, DanfseFonts>();
const fontBase64Cache = new Map<string, string>();

function firstExistingPath(candidates: Array<string | undefined>) {
  return candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));
}

function fontBase64(fontPath: string) {
  const cached = fontBase64Cache.get(fontPath);
  if (cached) return cached;
  const value = fs.readFileSync(fontPath).toString('base64');
  fontBase64Cache.set(fontPath, value);
  return value;
}

function registerDanfseFonts(doc: jsPDF): DanfseFonts {
  const publicFonts = path.join(process.cwd(), 'public', 'fonts');
  const windowsFonts = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts';
  const arialRegular = firstExistingPath([
    process.env.DANFSE_ARIAL_REGULAR_PATH,
    path.join(publicFonts, 'Arial.ttf'),
    path.join(windowsFonts, 'arial.ttf'),
  ]);
  const arialBold = firstExistingPath([
    process.env.DANFSE_ARIAL_BOLD_PATH,
    path.join(publicFonts, 'Arial-Bold.ttf'),
    path.join(windowsFonts, 'arialbd.ttf'),
  ]);
  const microsoftSans = firstExistingPath([
    process.env.DANFSE_MICROSOFT_SANS_PATH,
    path.join(publicFonts, 'Microsoft-Sans-Serif.ttf'),
    path.join(windowsFonts, 'micross.ttf'),
  ]);

  if (!arialRegular || !arialBold || !microsoftSans) {
    const fallback = { title: 'helvetica', content: 'helvetica', embedded: false };
    fontsByDocument.set(doc, fallback);
    return fallback;
  }

  doc.addFileToVFS('DanfseArial.ttf', fontBase64(arialRegular));
  doc.addFont('DanfseArial.ttf', 'DanfseArial', 'normal');
  doc.addFileToVFS('DanfseArialBold.ttf', fontBase64(arialBold));
  doc.addFont('DanfseArialBold.ttf', 'DanfseArial', 'bold');
  doc.addFileToVFS('DanfseMicrosoftSans.ttf', fontBase64(microsoftSans));
  doc.addFont('DanfseMicrosoftSans.ttf', 'DanfseMicrosoftSans', 'normal');
  const embedded = { title: 'DanfseArial', content: 'DanfseMicrosoftSans', embedded: true };
  fontsByDocument.set(doc, embedded);
  return embedded;
}

const vazioParticipante = (tipo: string): Participante => ({
  tipo,
  documento: '',
  inscricaoMunicipal: '',
  telefone: '',
  nome: '',
  municipioUf: '',
  codigoIbgeCep: '',
  endereco: '',
  email: '',
  simplesNacional: '',
  regimeApuracao: '',
});

function localName(node: Node) {
  return String((node as any).localName || node.nodeName || '').replace(/^.*:/, '');
}

function descendants(node: XmlNode, name: string): Element[] {
  if (!node) return [];
  const found: Element[] = [];
  const visit = (current: Node) => {
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        if (localName(child) === name) found.push(child as Element);
        visit(child);
      }
    }
  };
  visit(node);
  return found;
}

function direct(node: XmlNode, name: string): Element | null {
  if (!node) return null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && localName(child) === name) return child as Element;
  }
  return null;
}

function first(node: XmlNode, name: string): Element | null {
  return direct(node, name) || descendants(node, name)[0] || null;
}

function text(node: XmlNode, ...paths: string[][]): string {
  for (const path of paths) {
    let current = node;
    for (const part of path) current = direct(current, part) || first(current, part);
    const value = String(current?.textContent || '').trim();
    if (value) return value;
  }
  return '';
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function formatDocument(value: string) {
  const digits = onlyDigits(value);
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return value;
}

function formatCep(value: string) {
  const digits = onlyDigits(value);
  return digits.length === 8 ? digits.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3') : value;
}

function formatCodigoMunicipio(value: string) {
  const digits = onlyDigits(value);
  return digits.length === 7 ? digits.replace(/^(\d{2})(\d{5})$/, '$1.$2') : value;
}

function formatCodigoTributacaoNacional(value: string) {
  const digits = onlyDigits(value);
  return digits.length === 6 ? digits.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : value;
}

function formatPhone(value: string) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return value;
}

function formatDate(value: string, withTime = false) {
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return value;
  const date = `${match[3]}/${match[2]}/${match[1]}`;
  return withTime && match[4] ? `${date} ${match[4]}:${match[5]}:${match[6]}` : date;
}

function decimal(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: string) {
  const parsed = decimal(value);
  return parsed === null ? '' : `R$ ${parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value: string) {
  const parsed = decimal(value);
  return parsed === null ? '' : `${parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function municipioUf(node: XmlNode) {
  const municipio = text(node, ['xMun'], ['xCidade'], ['xLoc']);
  const uf = text(node, ['UF']);
  return [municipio, uf].filter(Boolean).join(' / ');
}

function endereco(node: XmlNode) {
  const end = first(node, 'end') || node;
  const parts = [text(end, ['xLgr']), text(end, ['nro']), text(end, ['xCpl']), text(end, ['xBairro'])].filter(Boolean);
  return parts.join(', ');
}

function participante(node: XmlNode, tipo: string, emitNode?: XmlNode): Participante {
  if (!node && !emitNode) return vazioParticipante(tipo);
  const source = node || emitNode;
  const end = first(source, 'enderNac') || first(source, 'endNac') || first(source, 'end') || source;
  const documento = text(source, ['CNPJ']) || text(source, ['CPF']) || text(source, ['NIF']);
  const codigoMunicipio = text(end, ['cMun']);
  const cep = text(end, ['CEP']);
  const codigoPostalExterior = text(end, ['cEndPost']);
  const emitMunicipio = emitNode ? text(emitNode, ['enderNac', 'cMun']) : '';
  const municipio = text(end, ['xMun']) || text(source, ['xMun']) || text(end, ['xCidade']) || text(source, ['xCidade']);
  const uf = text(end, ['UF']) || text(source, ['UF']);
  return {
    tipo,
    documento: formatDocument(documento),
    inscricaoMunicipal: text(source, ['IM']),
    telefone: formatPhone(text(source, ['fone'])),
    nome: text(source, ['xNome']),
    municipioUf: [municipio, uf].filter(Boolean).join(' / '),
    codigoIbgeCep: codigoPostalExterior
      ? `${codigoPostalExterior} (ext)`
      : [formatCodigoMunicipio(codigoMunicipio || emitMunicipio), formatCep(cep)].filter(Boolean).join(' / '),
    endereco: endereco(source),
    email: text(source, ['email']),
    simplesNacional: '',
    regimeApuracao: '',
  };
}

function finalidade(value: string) {
  const values: Record<string, string> = { '0': 'NFS-e regular', '1': 'NFS-e de crédito', '2': 'NFS-e de débito' };
  return values[value] || value;
}

function simplesNacional(value: string) {
  const values: Record<string, string> = { '1': 'Não optante', '2': 'Optante - Microempreendedor Individual (MEI)', '3': 'Optante - Simples Nacional' };
  return values[value] || value;
}

function regimeApuracao(value: string) {
  const values: Record<string, string> = {
    '1': 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional',
    '2': 'Regime de apuração dos tributos federais pelo Simples Nacional e ISSQN pela NFS-e',
    '3': 'Regime de apuração dos tributos federais e municipal pela NFS-e',
  };
  return values[value] || value;
}

function regimeEspecial(value: string) {
  const values: Record<string, string> = {
    '0': 'Nenhum', '1': 'Microempresa municipal', '2': 'Estimativa', '3': 'Sociedade de profissionais',
    '4': 'Cooperativa', '5': 'MEI', '6': 'ME/EPP', '9': 'Outros',
  };
  return values[value] || value;
}

function tipoRetPisCofins(value: string) {
  const values: Record<string, string> = {
    '0': 'PIS/COFINS/CSLL Não Retidos',
    '1': 'PIS/COFINS Retido',
    '2': 'PIS/COFINS Não Retido',
    '3': 'PIS/COFINS/CSLL Retidos',
    '4': 'PIS/COFINS Retidos e CSLL Não Retida',
    '5': 'PIS Retido e COFINS/CSLL Não Retidos',
    '6': 'COFINS Retida e PIS/CSLL Não Retidos',
    '7': 'COFINS/CSLL Retidos e PIS Não Retido',
    '8': 'CSLL Retida e PIS/COFINS Não Retidos',
    '9': 'PIS/CSLL Retidos e COFINS Não Retida',
  };
  return values[value] || value;
}

function situacaoNfse(value: string) {
  const values: Record<string, string> = { '100': 'NFS-e Gerada', '107': 'NFS-e - MEI' };
  return values[value] || value;
}

function finalidadeEmitente(value: string) {
  const values: Record<string, string> = { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' };
  return values[value] || value || 'Prestador';
}

function decodeXml(input: string | Buffer) {
  if (Buffer.isBuffer(input)) return input.toString('utf8');
  const trimmed = input.trim();
  if (trimmed.startsWith('<')) return trimmed;
  const buffer = Buffer.from(trimmed, 'base64');
  const unpacked = buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer;
  return unpacked.toString('utf8');
}

export function parseDanfseXml(input: string | Buffer, options: DanfseGeneratorOptions = {}): DanfseData {
  const xml = decodeXml(input);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = descendants(document.documentElement, 'parsererror')[0];
  if (!document.documentElement || parserError) throw new Error('XML da NFS-e inválido ou ilegível.');

  const nfse = localName(document.documentElement) === 'NFSe' ? document.documentElement : first(document.documentElement, 'NFSe');
  const info = first(nfse, 'infNFSe') || nfse;
  const dps = first(info, 'DPS');
  const infoDps = first(dps, 'infDPS') || dps;
  const emit = first(info, 'emit');
  const prest = first(infoDps, 'prest');
  const toma = first(infoDps, 'toma');
  const inter = first(infoDps, 'interm');
  const serv = first(infoDps, 'serv');
  const valoresNfse = direct(info, 'valores');
  const valoresDps = direct(infoDps, 'valores');
  const ibscbsNfse = direct(info, 'IBSCBS');
  const ibscbsDps = direct(infoDps, 'IBSCBS');
  const dest = first(ibscbsDps, 'dest');
  const ibsValores = direct(ibscbsNfse, 'valores');
  const ibsTotais = first(ibscbsNfse, 'totCIBS');
  const tribFed = first(valoresDps, 'tribFed');
  const tribMun = first(valoresDps, 'tribMun');
  const codigoTribIssqn = text(tribMun, ['tribISSQN']);
  const totalTrib = first(valoresDps, 'totTrib');
  const chave = String(info?.getAttribute('Id') || '').replace(/^NFS/, '') || text(info, ['chNFSe']);
  const prestadorData = participante(prest, 'PRESTADOR / FORNECEDOR', emit);
  const enderecoEmitente = first(emit, 'enderNac') || first(emit, 'endNac') || first(emit, 'end');
  const codigoMunicipioEmitente = text(enderecoEmitente, ['cMun']);
  const cepEmitente = text(enderecoEmitente, ['CEP']);
  prestadorData.nome ||= text(emit, ['xNome']);
  prestadorData.endereco ||= endereco(emit);
  prestadorData.municipioUf ||= municipioUf(first(emit, 'enderNac'));
  if (codigoMunicipioEmitente || cepEmitente) {
    prestadorData.codigoIbgeCep = [formatCodigoMunicipio(codigoMunicipioEmitente), formatCep(cepEmitente)].filter(Boolean).join(' / ');
  }
  // Para o prestador, somente o contato cadastral devolvido no bloco oficial
  // <emit> pode aparecer. Retornos antigos podem apenas repetir o e-mail que o
  // SaaS enviou em <prest>; nesse caso a origem nao e cadastral e deve ficar vazia.
  const emailEmitente = text(emit, ['email']);
  const emailEnviadoNaDps = text(prest, ['email']);
  prestadorData.email = emailEmitente
    && emailEmitente.toLocaleLowerCase('pt-BR') !== emailEnviadoNaDps.toLocaleLowerCase('pt-BR')
    ? emailEmitente
    : '';
  prestadorData.simplesNacional = simplesNacional(text(first(prest, 'regTrib'), ['opSimpNac']));
  prestadorData.regimeApuracao = regimeApuracao(text(first(prest, 'regTrib'), ['regApTribSN']));

  const municipioEmissao = text(info, ['xLocEmi']);
  const ufEmissao = text(first(emit, 'enderNac'), ['UF']);
  if (!prestadorData.municipioUf || prestadorData.municipioUf === ufEmissao) {
    prestadorData.municipioUf = [municipioEmissao, ufEmissao].filter(Boolean).join(' / ');
  }
  const tomadorData = participante(toma, 'TOMADOR / ADQUIRENTE');
  const codigoTomador = text(first(toma, 'end'), ['endNac', 'cMun']);
  if (!tomadorData.municipioUf && codigoTomador) {
    if (codigoTomador === text(info, ['cLocIncid'])) {
      tomadorData.municipioUf = [text(info, ['xLocIncid']), ufEmissao].filter(Boolean).join(' / ');
    } else if (codigoTomador === text(ibscbsNfse, ['cLocalidadeIncid'])) {
      tomadorData.municipioUf = [text(ibscbsNfse, ['xLocalidadeIncid']), ufEmissao].filter(Boolean).join(' / ');
    }
  }
  const destinatarioData = participante(dest, 'DESTINATÁRIO DA OPERAÇÃO');
  const codigoTribNac = text(first(serv, 'cServ'), ['cTribNac']);
  const codigoTribMun = text(first(serv, 'cServ'), ['cTribMun']);
  const codigoNbs = text(first(serv, 'cServ'), ['cNBS']);
  const localPrestacao = text(info, ['xLocPrestacao']) || text(info, ['xLocIncid']);
  const localUfPais = [localPrestacao || '-', ufEmissao || '-', text(first(serv, 'locPrest'), ['cPaisPrestacao']) || '-'].join(' / ');
  const piscofins = first(tribFed, 'piscofins');
  const tpRetPisCofins = text(piscofins, ['tpRetPisCofins']);
  const retencoesSociais = [text(tribFed, ['vRetCSLL'])];
  if (tpRetPisCofins === '1') retencoesSociais.push(text(piscofins, ['vPis']), text(piscofins, ['vCofins']));
  const totalRetencoesSociais = retencoesSociais.some((value) => decimal(value) !== null)
    ? String(retencoesSociais.reduce((sum, value) => sum + (decimal(value) || 0), 0))
    : '';
  const vServ = text(first(valoresDps, 'vServPrest'), ['vServ']);
  const vBcIbs = text(ibsValores, ['vBC']);
  const vOperacao = vServ || text(valoresNfse, ['vBC']);
  const exclusaoComponentes = [
    text(valoresDps, ['vDescCondIncond', 'vDescIncond']),
    text(ibsValores, ['vCalcReeRepRes']),
    text(valoresNfse, ['vISSQN']),
    text(piscofins, ['vPis']),
    text(piscofins, ['vCofins']),
  ];
  const exclusoes = exclusaoComponentes.some((value) => decimal(value) !== null)
    ? String(exclusaoComponentes.reduce((sum, value) => sum + (decimal(value) || 0), 0))
    : '';
  const totalIbs = text(ibsTotais, ['gIBS', 'vIBSTot']);
  const totalCbs = text(ibsTotais, ['gCBS', 'vCBS']);
  const totalIbsCbs = decimal(totalIbs) !== null || decimal(totalCbs) !== null
    ? String((decimal(totalIbs) || 0) + (decimal(totalCbs) || 0))
    : '';
  const percentuais = totalTrib ? [
    ['Federais', text(totalTrib, ['pTotTrib', 'pTotTribFed'])],
    ['Estaduais', text(totalTrib, ['pTotTrib', 'pTotTribEst'])],
    ['Municipais', text(totalTrib, ['pTotTrib', 'pTotTribMun'])],
  ].map(([label, value]) => `${label}: ${percent(value) || '-'}`) : [];
  const infoParts = [
    text(first(serv, 'infoCompl'), ['xInfComp']) || text(first(serv, 'infoCompl'), ['xOutInf']),
    text(infoDps, ['subst', 'chSubstda']) ? `NFS-e Subst.: ${text(infoDps, ['subst', 'chSubstda'])}` : '',
    text(first(serv, 'infoCompl'), ['docRef']) ? `Doc. Ref.: ${text(first(serv, 'infoCompl'), ['docRef'])}` : '',
    text(first(serv, 'obra'), ['cObra']) ? `Cod. Obra: ${text(first(serv, 'obra'), ['cObra'])}` : '',
    text(first(ibscbsDps, 'imovel'), ['inscImobFisc']) ? `Insc. Imob.: ${text(first(ibscbsDps, 'imovel'), ['inscImobFisc'])}` : '',
    text(first(serv, 'atvEvento'), ['idAtvEvt']) ? `Cod. Evt.: ${text(first(serv, 'atvEvento'), ['idAtvEvt'])}` : '',
    text(first(serv, 'infoCompl'), ['idDocTec']) ? `Doc. Tec.: ${text(first(serv, 'infoCompl'), ['idDocTec'])}` : '',
    text(first(first(serv, 'infoCompl'), 'gItemPed'), ['xPed']) ? `Núm. Ped.: ${text(first(first(serv, 'infoCompl'), 'gItemPed'), ['xPed'])}` : '',
    text(first(first(serv, 'infoCompl'), 'gItemPed'), ['xItemPed']) ? `Item Ped.: ${text(first(first(serv, 'infoCompl'), 'gItemPed'), ['xItemPed'])}` : '',
    text(first(serv, 'infoCompl'), ['xInfATMun']) ? `Inf. A. T. Mun.: ${text(first(serv, 'infoCompl'), ['xInfATMun'])}` : '',
    percentuais.length ? `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${percentuais.join('; ')};` : '',
  ].filter(Boolean);

  return {
    ambiente: text(infoDps, ['tpAmb']) || '1',
    ambienteGerador: text(info, ['ambGer']),
    chaveAcesso: chave,
    numeroNfse: text(info, ['nNFSe']),
    competencia: formatDate(text(infoDps, ['dCompet'])),
    emissaoNfse: formatDate(text(info, ['dhProc']), true),
    numeroDps: text(infoDps, ['nDPS']),
    serieDps: text(infoDps, ['serie']),
    emissaoDps: formatDate(text(infoDps, ['dhEmi']), true),
    emitenteTipo: finalidadeEmitente(text(infoDps, ['tpEmit'])),
    situacao: situacaoNfse(text(info, ['cStat'])),
    finalidade: finalidade(text(ibscbsDps, ['finNFSe'])),
    municipioEmissao,
    ufEmissao,
    prestador: prestadorData,
    tomador: tomadorData,
    destinatario: destinatarioData,
    intermediario: participante(inter, 'INTERMEDIÁRIO'),
    servico: {
      codigoTributacao: [formatCodigoTributacaoNacional(codigoTribNac), codigoTribMun].filter(Boolean).join(' / '),
      codigoNbs: codigoNbs ? codigoNbs.replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3.$4') : '',
      localPrestacao: localUfPais,
      descricaoTributacao: text(info, ['xTribNac']) || text(info, ['xTribMun']),
      descricao: text(first(serv, 'cServ'), ['xDescServ']),
    },
    issqn: {
      tipo: ({ '1': 'Operação Tributável', '3': 'Exportação de Serviço' } as Record<string, string>)[codigoTribIssqn]
        || codigoTribIssqn,
      incidencia: codigoTribIssqn === '3'
        ? 'Nenhum'
        : [text(info, ['xLocIncid']) || '-', ufEmissao || '-', '-'].join(' / '),
      base: money(text(valoresNfse, ['vBC'])),
      aliquota: percent(text(valoresNfse, ['pAliqAplic'])),
      retencao: ({ '1': 'Não Retido', '2': 'Retido pelo Tomador' } as Record<string, string>)[text(tribMun, ['tpRetISSQN'])]
        || text(tribMun, ['tpRetISSQN']),
      valor: money(text(valoresNfse, ['vISSQN'])),
      regimeEspecial: regimeEspecial(text(first(prest, 'regTrib'), ['regEspTrib'])),
      imunidade: text(tribMun, ['tpImunidade']),
      suspensao: text(tribMun, ['exigSusp']),
      processo: text(tribMun, ['nProcesso']),
      beneficio: text(first(tribMun, 'BM'), ['tpBM']),
      calculoBeneficio: money(text(first(tribMun, 'BM'), ['vCalcBM']) || text(valoresNfse, ['vRedBCBM'])),
      deducoes: money(text(valoresNfse, ['vTotalDedRed'])),
      desconto: money(text(valoresDps, ['vDescCondIncond', 'vDescIncond'])),
    },
    federal: {
      irrf: money(text(tribFed, ['vRetIRRF'])),
      previdencia: money(text(tribFed, ['vRetCP'])),
      sociais: money(totalRetencoesSociais),
      pis: tpRetPisCofins === '1' ? money('0') : money(text(piscofins, ['vPis'])),
      cofins: tpRetPisCofins === '1' ? money('0') : money(text(piscofins, ['vCofins'])),
      descricao: tipoRetPisCofins(tpRetPisCofins),
    },
    ibscbs: {
      cstClasse: [text(first(ibscbsDps, 'gIBSCBS'), ['CST']), text(first(ibscbsDps, 'gIBSCBS'), ['cClassTrib'])].filter(Boolean).join(' / '),
      indicador: [text(ibscbsDps, ['cIndOp']), text(ibscbsNfse, ['cLocalidadeIncid']), text(ibscbsNfse, ['xLocalidadeIncid']), ufEmissao].filter(Boolean).join(' / '),
      exclusoes: money(exclusoes),
      base: money(vBcIbs),
      reducoes: [text(ibsValores, ['uf', 'pRedAliqUF']), text(ibsValores, ['mun', 'pRedAliqMun']), text(ibsValores, ['fed', 'pRedAliqCBS'])].map(percent).filter(Boolean).join(' / '),
      aliquotasIbs: [text(ibsValores, ['uf', 'pIBSUF']), text(ibsValores, ['mun', 'pIBSMun'])].map(percent).filter(Boolean).join(' / '),
      aliquotaMun: percent(text(ibsValores, ['mun', 'pAliqEfetMun'])),
      valorMun: money(text(ibsTotais, ['gIBS', 'gIBSMunTot', 'vIBSMun'])),
      aliquotaUf: percent(text(ibsValores, ['uf', 'pAliqEfetUF'])),
      valorUf: money(text(ibsTotais, ['gIBS', 'gIBSUFTot', 'vIBSUF'])),
      totalIbs: money(totalIbs),
      aliquotaCbs: percent(text(ibsValores, ['fed', 'pCBS'])),
      aliquotaEfetivaCbs: percent(text(ibsValores, ['fed', 'pAliqEfetCBS'])),
      totalCbs: money(totalCbs),
    },
    totais: {
      operacao: money(vOperacao),
      descontoIncondicionado: money(text(valoresDps, ['vDescIncond'])),
      descontoCondicionado: money(text(valoresDps, ['vDescCond'])),
      retencoes: money(text(valoresNfse, ['vTotalRet'])),
      liquido: money(text(valoresNfse, ['vLiq'])),
      ibscbs: money(totalIbsCbs),
      liquidoComIbsCbs: money(text(ibsTotais, ['vTotNF']) || text(valoresNfse, ['vLiq'])),
    },
    informacoesComplementares: infoParts.join(' | '),
  };
}

type Cell = { label: string; value?: string; width?: number; shaded?: boolean; align?: 'left' | 'center' };
type RowOptions = { margin?: number; topLine?: boolean; lineEnd?: number };

function fittedLines(doc: jsPDF, value: string, maxWidth: number, requestedSize: number, maxLines: number) {
  const minimumSize = Math.min(requestedSize, 5.2);
  let size = requestedSize;
  let lines = doc.splitTextToSize(value || '', Math.max(1, maxWidth)) as string[];
  while (lines.length > maxLines && size > minimumSize) {
    size = Math.max(minimumSize, size - 0.25);
    doc.setFontSize(size);
    lines = doc.splitTextToSize(value || '', Math.max(1, maxWidth)) as string[];
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines.length - 1;
    let finalLine = String(lines[last] || '');
    while (finalLine && doc.getTextWidth(`${finalLine}...`) > maxWidth) finalLine = finalLine.slice(0, -1);
    lines[last] = `${finalLine.trimEnd()}...`;
  }
  return { lines, size };
}

function pdfText(doc: jsPDF, value: string, x: number, y: number, maxWidth: number, size = 7, bold = false, maxLines = 2, align: 'left' | 'center' = 'left') {
  const fonts = fontsByDocument.get(doc) || { title: 'helvetica', content: 'helvetica', embedded: false };
  doc.setFont(bold ? fonts.title : fonts.content, bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const fitted = fittedLines(doc, value, maxWidth, size, maxLines);
  doc.setFontSize(fitted.size);
  doc.text(fitted.lines, align === 'center' ? x + maxWidth / 2 : x, y, { lineHeightFactor: 1.05, align });
}

function row(doc: jsPDF, y: number, height: number, cells: Cell[], options: RowOptions = {}) {
  const margin = options.margin ?? 3;
  const usable = 210 - margin * 2;
  const specified = cells.reduce((sum, cell) => sum + (cell.width || 0), 0);
  const flexible = cells.filter((cell) => !cell.width).length || 1;
  let x = margin;
  for (const cell of cells) {
    const width = cell.width || (usable - specified) / flexible;
    if (cell.shaded) {
      doc.setFillColor(238, 238, 238);
      doc.rect(x, y, width, height, 'F');
    }
    pdfText(doc, cell.label, x + 1.2, y + 3.2, width - 2.4, 6.2, true, 1, cell.align);
    if (cell.value !== undefined) {
      const maxLines = Math.max(1, Math.floor((height - 6.4) / 2.7) + 1);
      pdfText(doc, cell.value || '-', x + 1.2, y + 6.4, width - 2.4, 7.2, false, maxLines, cell.align);
    }
    x += width;
  }
  if (options.topLine !== false) {
    doc.setDrawColor(0);
    doc.setLineWidth(DANFSE_LAYOUT.internalLineMm);
    doc.line(margin, y, options.lineEnd ?? 210 - margin, y);
  }
  return y + height;
}

function hasParticipant(participant: Participante) {
  return Boolean(participant.documento || participant.nome || participant.endereco || participant.email || participant.telefone);
}

function participantBlock(doc: jsPDF, y: number, participant: Participante) {
  const nomeHeight = doc.splitTextToSize(participant.nome || '-', 99.6).length > 1 ? 10 : 7;
  const enderecoHeight = doc.splitTextToSize(participant.endereco || '-', 99.6).length > 1 ? 10 : 7;
  y = row(doc, y, 7, [
    { label: participant.tipo, shaded: true },
    { label: 'CNPJ / CPF / NIF', value: participant.documento },
    { label: 'Indicador Municipal (Inscrição)', value: participant.inscricaoMunicipal },
    { label: 'Telefone', value: participant.telefone },
  ]);
  y = row(doc, y, nomeHeight, [
    { label: 'Nome / Nome Empresarial', value: participant.nome, width: 102 },
    { label: 'Município / Sigla UF', value: participant.municipioUf, width: 50 },
    { label: 'Código IBGE / CEP', value: participant.codigoIbgeCep, width: 51 },
  ], { topLine: false });
  y = row(doc, y, enderecoHeight, [
    { label: 'Endereço', value: participant.endereco, width: 102 },
    { label: 'E-mail', value: participant.email, width: 102 },
  ], { topLine: false });
  return y;
}

export async function generateDanfsePdf(input: string | Buffer, options: DanfseGeneratorOptions = {}): Promise<Buffer> {
  const data = parseDanfseXml(input, options);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const margin = DANFSE_LAYOUT.margin;
  const fonts = registerDanfseFonts(doc);
  doc.setProperties({
    title: `DANFSe ${data.numeroNfse || data.chaveAcesso}`,
    subject: 'Documento Auxiliar da NFS-e - NT 008 v1.02',
    keywords: `DANFSe,NT008,v1.02,fonts:${fonts.embedded ? 'embedded' : 'fallback'}`,
  });
  doc.setDrawColor(0);
  doc.setLineWidth(DANFSE_LAYOUT.outerBorderMm);
  doc.rect(2, 2, 206, 293);

  doc.setFillColor(242, 242, 242);
  doc.rect(margin, 3, 204, 13, 'F');
  const logoPath = path.join(process.cwd(), 'public', 'nfse-logo-horizontal.png');
  if (fs.existsSync(logoPath)) {
    doc.addImage(fs.readFileSync(logoPath), 'PNG', 4.9, 4.4, 40, 8.5);
  } else {
    doc.setTextColor(39, 153, 103);
    pdfText(doc, 'NFS', 6, 12, 20, 18, true, 1);
    doc.setTextColor(31, 75, 123);
    pdfText(doc, 'e', 24.5, 12, 8, 13, true, 1);
    doc.setTextColor(90);
    pdfText(doc, 'Nota Fiscal de\nServiço eletrônica', 30, 8.5, 35, 6.5, false, 2);
  }
  doc.setTextColor(0);
  pdfText(doc, 'DANFSe v2.0', 82, 9, 46, 10, true, 1);
  pdfText(doc, 'Documento Auxiliar da NFS-e', 77, 13.2, 58, 8.5, true, 1);
  const homologacaoOffset = data.ambiente === '2' ? 3 : 0;
  if (data.ambiente === '2') {
    doc.setTextColor(210, 0, 0);
    pdfText(doc, 'NFS-e SEM VALIDADE JURÍDICA', 73, 16.5, 68, 9, true, 1);
    doc.setTextColor(0);
  }
  pdfText(doc, `Município: ${[data.municipioEmissao, data.ufEmissao].filter(Boolean).join(' - ')}`, 157, 7.2, 47, 7, false, 1);
  pdfText(doc, `Ambiente Gerador: ${data.ambienteGerador}`, 157, 10.2, 47, 6.5, false, 1);
  pdfText(doc, `Tipo de Ambiente: ${data.ambiente}`, 157, 13.2, 47, 6.5, false, 1);
  doc.line(margin, 16 + homologacaoOffset, 207, 16 + homologacaoOffset);

  pdfText(doc, 'CHAVE DE ACESSO DA NFS-e', 5, 20 + homologacaoOffset, 135, 7, true, 1);
  pdfText(doc, data.chaveAcesso || '-', 5, 23 + homologacaoOffset, 135, 7, false, 1);
  const qrPayload = data.chaveAcesso
    ? `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${encodeURIComponent(data.chaveAcesso)}`
    : 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=';
  const qr = await QRCode.toDataURL(qrPayload, { margin: 0, width: 220, errorCorrectionLevel: 'M' });
  doc.addImage(qr, 'PNG', DANFSE_LAYOUT.qr.x, DANFSE_LAYOUT.qr.y + homologacaoOffset, DANFSE_LAYOUT.qr.size, DANFSE_LAYOUT.qr.size);
  pdfText(doc, 'A autenticidade desta NFS-e pode ser verificada\npela leitura deste código QR ou pela consulta da\nchave de acesso no portal nacional da NFS-e', 157, 37.5 + homologacaoOffset, 47, 5.6, false, 3);

  let y = 26 + homologacaoOffset;
  y = row(doc, y, 8, [
    { label: 'NÚMERO DA NFS-e', value: data.numeroNfse },
    { label: 'COMPETÊNCIA DA NFS-e', value: data.competencia },
    { label: 'DATA E HORA DA EMISSÃO DA NFS-e', value: data.emissaoNfse, width: 102 },
  ], { topLine: false });
  y = row(doc, y, 7, [
    { label: 'NÚMERO DA DPS', value: data.numeroDps },
    { label: 'SÉRIE DA DPS', value: data.serieDps },
    { label: 'DATA E HORA DA EMISSÃO DA DPS', value: data.emissaoDps, width: 102 },
  ], { topLine: false });
  y = row(doc, y, 7, [
    { label: 'EMITENTE DA NFS-e', value: data.emitenteTipo, shaded: true },
    { label: 'SITUAÇÃO DA NFS-e', value: data.situacao },
    { label: 'FINALIDADE', value: data.finalidade, width: 102 },
  ], { topLine: false });
  y = participantBlock(doc, y, data.prestador);
  y = row(doc, y, 7, [
    { label: 'Simples Nacional na Data de Competência', value: data.prestador.simplesNacional, width: 102 },
    { label: 'Regime de Apuração Tributária pelo SN', value: data.prestador.regimeApuracao, width: 102 },
  ], { topLine: false });
  y = participantBlock(doc, y, data.tomador);
  y = hasParticipant(data.destinatario)
    ? participantBlock(doc, y, data.destinatario)
    : row(doc, y, 4.5, [{ label: 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e', width: 204, align: 'center' }]);
  y = hasParticipant(data.intermediario)
    ? participantBlock(doc, y, data.intermediario)
    : row(doc, y, 4.5, [{ label: 'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e', width: 204, align: 'center' }]);

  y = row(doc, y, 7, [
    { label: 'SERVIÇO PRESTADO', shaded: true },
    { label: 'Código de Tributação Nacional/Municipal', value: data.servico.codigoTributacao },
    { label: 'Código da NBS', value: data.servico.codigoNbs },
    { label: 'Local da Prestação / Sigla UF / País', value: data.servico.localPrestacao },
  ]);
  if (data.servico.descricaoTributacao) {
    y = row(doc, y, 6, [{ label: '', value: data.servico.descricaoTributacao, width: 204 }], { topLine: false });
  }
  const descricaoServicoLines = doc.splitTextToSize(data.servico.descricao || '-', 201.6).length;
  const descricaoServicoHeight = Math.max(9, 7 + Math.max(0, descricaoServicoLines - 1) * 2.7);
  y = row(doc, y, descricaoServicoHeight, [{ label: 'Descrição do Serviço', value: data.servico.descricao, width: 204 }], { topLine: false });
  y = row(doc, y, 7, [
    { label: 'TRIBUTAÇÃO MUNICIPAL (ISSQN)', shaded: true },
    { label: 'Tipo de Tributação do ISSQN', value: data.issqn.tipo },
    { label: 'Município / Sigla UF / País de Incidência do ISSQN', value: data.issqn.incidencia, width: 102 },
  ]);
  y = row(doc, y, 7, [
    { label: 'BC ISSQN', value: data.issqn.base },
    { label: 'Alíquota Aplicada', value: data.issqn.aliquota },
    { label: 'Retenção do ISSQN', value: data.issqn.retencao },
    { label: 'ISSQN Apurado', value: data.issqn.valor },
  ], { topLine: false });
  if ([data.issqn.regimeEspecial, data.issqn.imunidade, data.issqn.suspensao, data.issqn.processo, data.issqn.beneficio, data.issqn.calculoBeneficio, data.issqn.deducoes, data.issqn.desconto].some(Boolean)) {
    y = row(doc, y, 7, [
      { label: 'Regime Especial / Imunidade', value: [data.issqn.regimeEspecial, data.issqn.imunidade].filter(Boolean).join(' / ') },
      { label: 'Suspensão / Processo', value: [data.issqn.suspensao, data.issqn.processo].filter(Boolean).join(' / ') },
      { label: 'Benefício / Cálculo do Benefício', value: [data.issqn.beneficio, data.issqn.calculoBeneficio].filter(Boolean).join(' / ') },
      { label: 'Deduções / Desconto Incondicionado', value: [data.issqn.deducoes, data.issqn.desconto].filter(Boolean).join(' / ') },
    ], { topLine: false });
  }
  y = row(doc, y, 7, [
    { label: 'TRIBUTAÇÃO FEDERAL (EXCETO CBS)', shaded: true },
    { label: 'IRRF', value: data.federal.irrf },
    { label: 'Contribuição Previdenciária - Retida', value: data.federal.previdencia },
    { label: 'Contribuições Sociais - Retidas', value: data.federal.sociais },
  ]);
  y = row(doc, y, 7, [
    { label: 'PIS - Débito Apuração Própria', value: data.federal.pis },
    { label: 'COFINS - Débito Apuração Própria', value: data.federal.cofins },
    { label: 'Descrição Contrib. Sociais - Retidas', value: data.federal.descricao, width: 102 },
  ], { topLine: false });
  y = row(doc, y, 7, [
    { label: 'TRIBUTAÇÃO IBS/CBS', shaded: true },
    { label: 'CST / cClassTrib', value: data.ibscbs.cstClasse },
    { label: 'Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', value: data.ibscbs.indicador, width: 102 },
  ]);
  y = row(doc, y, 7, [
    { label: 'Exclusões e Reduções da Base de Cálculo', value: data.ibscbs.exclusoes },
    { label: 'Base de Cálculo Após Exclusões e Reduções', value: data.ibscbs.base },
    { label: 'Red. Alíquota IBS / Red. Alíquota CBS', value: data.ibscbs.reducoes },
    { label: 'Alíquota - IBS UF / IBS Mun', value: data.ibscbs.aliquotasIbs },
  ], { topLine: false });
  y = row(doc, y, 7, [
    { label: 'Alíq. Efetiva Municipal - IBS', value: data.ibscbs.aliquotaMun },
    { label: 'Valor Apurado Municipal - IBS', value: data.ibscbs.valorMun },
    { label: 'Alíq. Efetiva Estadual - IBS', value: data.ibscbs.aliquotaUf },
    { label: 'Valor Apurado Estadual - IBS', value: data.ibscbs.valorUf },
  ], { topLine: false });
  y = row(doc, y, 7, [
    { label: 'Valor Total Apurado - IBS', value: data.ibscbs.totalIbs },
    { label: 'Alíquota - CBS', value: data.ibscbs.aliquotaCbs },
    { label: 'Alíquota Efetiva - CBS', value: data.ibscbs.aliquotaEfetivaCbs },
    { label: 'Valor Total Apurado - CBS', value: data.ibscbs.totalCbs },
  ], { topLine: false });
  y = row(doc, y, 7, [
    { label: 'VALOR TOTAL DA NFS-e', shaded: true },
    { label: 'VALOR DA OPERAÇÃO / SERVIÇO', value: data.totais.operacao },
    { label: 'Desconto Incondicionado', value: data.totais.descontoIncondicionado },
    { label: 'Desconto Condicionado', value: data.totais.descontoCondicionado },
  ]);
  y = row(doc, y, 7, [
    { label: 'Total das Retenções (ISSQN / Federais)', value: data.totais.retencoes },
    { label: 'VALOR LÍQUIDO DA NFS-e', value: data.totais.liquido },
    { label: 'Total do IBS/CBS', value: data.totais.ibscbs },
    { label: 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', value: data.totais.liquidoComIbsCbs, shaded: true },
  ], { topLine: false });
  y = row(doc, y, 9, [{ label: 'INFORMAÇÕES COMPLEMENTARES', value: data.informacoesComplementares, width: 204 }]);

  if (y > DANFSE_LAYOUT.contentBottom) {
    throw new Error(`O conteúdo do DANFSe ultrapassa a área de página única da NT 008 v1.02 (${y.toFixed(2)} mm).`);
  }

  const watermark = options.cancelada ? 'CANCELADA' : options.substituida ? 'SUBSTITUÍDA' : '';
  if (watermark) {
    doc.setTextColor(166, 166, 166);
    doc.setFont(fonts.title, 'normal');
    doc.setFontSize(70);
    doc.text(watermark, 105, 175, { align: 'center', angle: 45 });
    doc.setTextColor(0);
  }

  const footerY = DANFSE_LAYOUT.footerY;
  doc.line(margin, footerY, 206, footerY);
  doc.line(55, footerY, 55, 291);
  doc.line(106, footerY, 106, 291);
  pdfText(doc, 'DATA CIENTIFICAÇÃO:', 5, footerY + 3, 48, 6.2, true, 1);
  pdfText(doc, 'IDENTIFICAÇÃO E ASSINATURA', 56, footerY + 3, 48, 6.2, true, 1);
  pdfText(doc, 'Nº NFS-e / CHAVE NFS-e', 107, footerY + 3, 98, 6.2, true, 1);
  pdfText(doc, [data.numeroNfse, data.chaveAcesso].filter(Boolean).join(' / '), 107, footerY + 6.4, 98, 7, false, 2);
  doc.line(margin, 291, 206, 291);

  if (doc.getNumberOfPages() !== 1) {
    throw new Error(`O DANFSe deve possuir exatamente uma página; foram geradas ${doc.getNumberOfPages()}.`);
  }

  return Buffer.from(doc.output('arraybuffer'));
}

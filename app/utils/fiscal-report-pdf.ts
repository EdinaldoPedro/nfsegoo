import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FiscalReportData } from '@/app/services/fiscalReportService';
import { FISCAL_REPORT_ENVIRONMENTS, fiscalDateInBrazil, formatReportMoney, MAX_FISCAL_REPORT_ROWS } from './fiscal-report';

function text(value: unknown): string {
  const result = String(value ?? '-').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  // Standard PDF fonts cannot represent every Unicode character. Do not silently
  // corrupt a customer's identity. The screen and official XML remain complete.
  if (/[^\u0020-\u00ff]/.test(result)) throw new Error('Há caracteres não suportados pela fonte do PDF. Consulte os dados completos na tela e nos XMLs; o relatório não foi gerado com nomes alterados.');
  return result || '-';
}

export function createFiscalReportPdf(report: FiscalReportData): jsPDF {
  if (!report.meta.complete || report.data.length !== report.meta.total || report.data.length > MAX_FISCAL_REPORT_ROWS) {
    throw new Error('É necessário carregar o relatório completo antes de gerar o PDF.');
  }
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const environment = FISCAL_REPORT_ENVIRONMENTS[report.ambiente];
  const period = `${report.filters.startDate.split('-').reverse().join('/')} a ${report.filters.endDate.split('-').reverse().join('/')}`;
  const header = () => {
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, 210, 21, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('NFSe Goo | Relatório de conferência', 14, 10);
    doc.setFontSize(9); doc.text(text(environment.label) + ' | ' + period, 14, 17);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(report.ambiente === 'PRODUCAO' ? 55 : 140, 45, 55);
    doc.text(doc.splitTextToSize(text(environment.notice), 182), 14, 27);
  };
  header();
  const company = report.prestador;
  const warnings = [
    report.summary.notasSemAmbienteNoPeriodo ? `${report.summary.notasSemAmbienteNoPeriodo} nota(s) sem ambiente confirmado neste período/busca. Não compõem produção.` : '',
    report.summary.datasEstimadas ? `${report.summary.datasEstimadas} registro(s) usam data de cadastro por ausência da data oficial.` : '',
    report.summary.metadadosLegados ? `${report.summary.metadadosLegados} registro(s) não tiveram metadados confirmados pelo XML.` : '',
  ].filter(Boolean).join(' ');
  autoTable(doc, { startY: 38, theme: 'plain', margin: { top: 38, bottom: 21, left: 14, right: 14 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, overflow: 'linebreak', textColor: [40, 48, 60] },
    columnStyles: { 0: { cellWidth: 36, fontStyle: 'bold' }, 1: { cellWidth: 146 } },
    body: [
      ['Prestador', text(company.razaoSocial || company.nomeFantasia)],
      ['Documento / IM', `${text(company.documento)} / ${text(company.inscricaoMunicipal)}`],
      ['Município / IBGE', `${text(company.cidade)}/${text(company.uf)} / ${text(company.codigoIbge)}`],
      ['Filtros aplicados', text(`Busca: ${report.filters.search || 'nenhuma'}. Canceladas ${report.filters.incluirCanceladas ? 'incluídas nas linhas' : 'não exibidas nas linhas'}.`) ],
      ['Total autorizado', `${formatReportMoney(report.summary.totalValor)} | ${report.summary.qtdAutorizadas} autorizada(s)`],
      ['Canceladas', `${report.summary.qtdCanceladas} no período/busca; valores excluídos do total autorizado.`],
      ['Abrangência', `${report.meta.total} linha(s). Relatório completo dos filtros, não apenas da página visível.`],
      ...(warnings ? [['Atenção ao legado', text(warnings)]] : []),
    ], willDrawPage: header,
  });
  const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  autoTable(doc, { startY: finalY + 5, margin: { top: 38, bottom: 21, left: 14, right: 14 }, theme: 'grid',
    head: [['Data', 'Número NFS-e', 'Tomador / documento', 'Serviço', 'Valor (R$)', 'Situação']],
    body: report.data.map(note => [
      fiscalDateInBrazil(new Date(note.dataEmissao || note.createdAt)).split('-').reverse().join('/') + (!note.dataEmissao ? ' *' : ''),
      text(note.numeroExibicao),
      text(note.tomadorNomeExibicao) + '\n' + text(note.tomadorCnpj) + (note.tomadorNomeOrigem !== 'XML_ASSINADO' ? '\n[Nome do cadastro atual]' : ''),
      text(note.codigoTribNacional), formatReportMoney(note.valor).replace('R$ ', ''), text(note.status),
    ]),
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [37, 75, 130], textColor: 255 }, alternateRowStyles: { fillColor: [246, 248, 251] },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 26 }, 2: { cellWidth: 61 }, 3: { cellWidth: 18 }, 4: { cellWidth: 32, halign: 'right' }, 5: { cellWidth: 25 } },
    rowPageBreak: 'avoid', willDrawPage: header,
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(80);
    doc.text('Relatório operacional, sem valor fiscal autônomo. Confira os documentos oficiais antes do fechamento.', 14, 282);
    doc.text('* Data de cadastro, não data oficial. Fuso: America/Sao_Paulo.', 14, 286);
    doc.text(`Gerado: ${text(report.geradoEm)} | ${text(report.ambiente)}`, 14, 290);
    doc.text(`${page} / ${pages}`, 196, 290, { align: 'right' });
  }
  return doc;
}

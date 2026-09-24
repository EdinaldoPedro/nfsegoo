function makeReport(ambiente = 'PRODUCAO', count = 65) {
  const data = Array.from({ length: count }, (_, index) => ({
    id: 'qa-report-note-' + index, numero: null, numeroOficial: String(1234567890000 + index), numeroExibicao: String(1234567890000 + index),
    ambiente, status: index % 9 === 0 ? 'CANCELADA' : 'AUTORIZADA', valor: '123.45', codigoTribNacional: '010101', codigoServico: '010101',
    descricao: 'Serviço de análise de sistemas para conferência sintética',
    tomadorNomeExibicao: index % 4 === 0 ? 'Associação de Desenvolvimento de Soluções e Serviços de Tecnologia da Informação - Matriz de São Paulo e Unidades Regionais' : 'Tomador de teste ' + index,
    tomadorNomeOrigem: index % 5 === 0 ? 'CADASTRO_ATUAL' : 'XML_ASSINADO', tomadorCnpj: '11222333000181',
    dataEmissao: index % 7 === 0 ? null : '2026-09-02T13:30:00Z', createdAt: '2026-09-02T14:00:00Z',
  }));
  const authorized = data.filter(n => n.status === 'AUTORIZADA').length;
  return { data, ambiente, aviso: '', geradoEm: '2026-09-02T15:00:00.000Z',
    filters: { startDate: '2026-09-01', endDate: '2026-09-02', incluirCanceladas: true, search: '', ambiente },
    meta: { page: 1, limit: 1000, total: count, totalPages: 1, complete: true },
    summary: { qtdAutorizadas: authorized, qtdCanceladas: count - authorized, totalValor: (authorized * 12345 / 100).toFixed(2),
      notasSemAmbienteNoPeriodo: ambiente === 'LEGADO' ? count : 3, datasEstimadas: data.filter(n => !n.dataEmissao).length, metadadosLegados: data.filter(n => n.tomadorNomeOrigem === 'CADASTRO_ATUAL').length },
    prestador: { id: 'qa-report-company', documento: '11222333000181', razaoSocial: 'Empresa Sintética de Auditoria e Desenvolvimento de Sistemas para Homologação de Relatórios Fiscais Ltda.',
      nomeFantasia: null, inscricaoMunicipal: '123456', cidade: 'São Paulo', uf: 'SP', codigoIbge: '3550308' },
  };
}
module.exports = { makeReport };

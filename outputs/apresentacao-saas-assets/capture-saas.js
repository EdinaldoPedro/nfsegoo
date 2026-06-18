const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = process.cwd();
const outDir = path.join(root, 'outputs', 'apresentacao-saas-assets');
fs.mkdirSync(outDir, { recursive: true });

const demoUserId = 'demo-user-cliente';
const demoEmpresaId = 'demo-empresa-principal';

const perfil = {
  id: demoUserId,
  nome: 'Marina Costa',
  email: 'marina@costadigital.com.br',
  cpf: '12345678909',
  telefone: '(11) 98888-1212',
  role: 'COMUM',
  razaoSocial: 'Costa Digital Servicos LTDA',
  nomeFantasia: 'Costa Digital',
  documento: '12345678000190',
  inscricaoMunicipal: '4567890',
  regimeTributario: 'SIMPLES_NACIONAL',
  cep: '01310930',
  logradouro: 'Avenida Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'Sao Paulo',
  uf: 'SP',
  codigoIbge: '3550308',
  ambiente: 'PRODUCAO',
  cadastroCompleto: true,
  temCertificado: true,
  vencimentoCertificado: '2026-11-15T00:00:00.000Z',
  aliquotaPadrao: 3,
  issRetidoPadrao: false,
  serieDPS: '900',
  ultimoDPS: 128,
  empresasAdicionais: 1,
  empresaPrimariaId: demoEmpresaId,
  listaEmpresas: [
    { id: demoEmpresaId, razaoSocial: 'Costa Digital Servicos LTDA', cnpj: '12.345.678/0001-90', isPrimary: true },
    { id: 'demo-empresa-2', razaoSocial: 'Costa Digital Treinamentos LTDA', cnpj: '22.333.444/0001-55', isPrimary: false }
  ],
  configuracoes: { darkMode: false, idioma: 'pt-BR', notificacoesEmail: true },
  planoDetalhado: {
    nome: 'Plano Standard', slug: 'STANDARD', status: 'ATIVO', dataInicio: '2026-06-01T00:00:00.000Z', dataFim: '2026-07-01T00:00:00.000Z', usoEmissoes: 6, limiteEmissoes: 10, usoClientes: 4, limiteClientes: 10, diasTeste: 0
  },
  planoSlug: 'STANDARD',
  planoCiclo: 'MENSAL',
  atividades: [
    { id: 'cnae-1', codigo: '6201501', descricao: 'Desenvolvimento de programas de computador sob encomenda', principal: true, aliquotaIss: 3, temRetencaoInss: false, retemCrsf: false, retemIr: false },
    { id: 'cnae-2', codigo: '8599604', descricao: 'Treinamento em desenvolvimento profissional', principal: false, aliquotaIss: 2.5, temRetencaoInss: false, retemCrsf: false, retemIr: false }
  ]
};

const clientes = [
  { id: 'cli-1', tipo: 'PJ', nome: 'Acme Comercio de Software LTDA', nomeFantasia: 'Acme Software', documento: '11222333000144', email: 'financeiro@acme.com.br', cidade: 'Sao Paulo', uf: 'SP', cep: '04567000', logradouro: 'Rua Funchal', numero: '411', bairro: 'Vila Olimpia', codigoIbge: '3550308', pais: 'Brasil', moeda: 'BRL' },
  { id: 'cli-2', tipo: 'PJ', nome: 'Nordeste Clinicas Integradas SA', nomeFantasia: 'NCI', documento: '44555666000177', email: 'notas@nci.com.br', cidade: 'Recife', uf: 'PE', cep: '50030000', logradouro: 'Rua do Bom Jesus', numero: '12', bairro: 'Recife', codigoIbge: '2611606', pais: 'Brasil', moeda: 'BRL' },
  { id: 'cli-3', tipo: 'PF', nome: 'Paulo Henrique Souza', documento: '39053344705', email: 'paulo@email.com', cidade: 'Santos', uf: 'SP', cep: '11010001', logradouro: 'Avenida Ana Costa', numero: '55', bairro: 'Gonzaga', codigoIbge: '3548500', pais: 'Brasil', moeda: 'BRL' },
  { id: 'cli-4', tipo: 'EXT', nome: 'Blue Harbor LLC', documento: 'US-88-1200', email: 'ap@blueharbor.example', cidade: 'Miami', uf: 'FL', cep: '33131', logradouro: 'Brickell Avenue', numero: '200', bairro: 'Downtown', pais: 'Estados Unidos', moeda: 'USD' }
];

const vendas = [
  { id: 'venda-1', empresaId: demoEmpresaId, clienteId: 'cli-1', valor: 1850, descricao: 'Sustentacao mensal de plataforma SaaS', status: 'CONCLUIDA', createdAt: '2026-06-17T14:30:00.000Z', cliente: { razaoSocial: clientes[0].nome, nome: clientes[0].nome, documento: '11.222.333/0001-44' }, notas: [{ id: 'nota-1', numero: 129, valor: 1850, descricao: 'Sustentacao mensal de plataforma SaaS', status: 'AUTORIZADA', dataEmissao: '2026-06-17T14:35:00.000Z', codigoTribNacional: '01.05', nomeServico: 'Licenciamento e suporte de software', xmlBase64: 'PHhtbD48L3htbD4=', pdfBase64: '__PDF_DISPONIVEL__' }] },
  { id: 'venda-2', empresaId: demoEmpresaId, clienteId: 'cli-2', valor: 3200, descricao: 'Implantacao e treinamento operacional', status: 'CONCLUIDA', createdAt: '2026-06-12T10:00:00.000Z', cliente: { razaoSocial: clientes[1].nome, nome: clientes[1].nome, documento: '44.555.666/0001-77' }, notas: [{ id: 'nota-2', numero: 128, valor: 3200, descricao: 'Implantacao e treinamento operacional', status: 'AUTORIZADA', dataEmissao: '2026-06-12T10:10:00.000Z', codigoTribNacional: '08.02', nomeServico: 'Instrucao e treinamento', xmlBase64: 'PHhtbD48L3htbD4=', pdfBase64: '__PDF_DISPONIVEL__' }] },
  { id: 'venda-3', empresaId: demoEmpresaId, clienteId: 'cli-3', valor: 450, descricao: 'Consultoria tecnica avulsa', status: 'ERRO_EMISSAO', motivoErro: 'Codigo IBGE do tomador precisa ser revisado.', erroPrecisaSuporte: false, createdAt: '2026-06-10T09:00:00.000Z', cliente: { razaoSocial: clientes[2].nome, nome: clientes[2].nome, documento: '390.533.447-05' }, notas: [{ id: 'nota-3', numero: null, valor: 450, descricao: 'Consultoria tecnica avulsa', status: 'ERRO', dataEmissao: null }] }
];

const relatorioNotas = vendas.filter(v => v.status === 'CONCLUIDA').map(v => ({
  id: v.notas[0].id,
  numero: v.notas[0].numero,
  valor: v.valor,
  status: 'AUTORIZADA',
  createdAt: v.createdAt,
  dataEmissao: v.notas[0].dataEmissao,
  tomadorCnpj: v.cliente.documento,
  cliente: { nome: v.cliente.nome, nomeFantasia: v.cliente.razaoSocial },
  cnae: '6201501',
  codigoTribNacional: v.notas[0].codigoTribNacional,
  descricao: v.descricao
}));

const plans = [
  { id: 'plan-basic', name: 'Plano Basic', slug: 'BASIC', description: 'Ideal para profissionais autonomos comecando agora.', priceMonthly: 19.90, priceYearly: 0, maxNotasMensal: 5, maxClientes: 5, tipo: 'PLANO', recommended: false, features: JSON.stringify(['Ate 5 emissoes/mes','Ate 5 clientes','Suporte via ticket']) },
  { id: 'plan-standard', name: 'Plano Standard', slug: 'STANDARD', description: 'Para pequenas empresas em crescimento.', priceMonthly: 44.90, priceYearly: 0, maxNotasMensal: 10, maxClientes: 10, tipo: 'PLANO', recommended: true, features: JSON.stringify(['Ate 10 emissoes/mes','Ate 10 clientes','Suporte prioritario']) },
  { id: 'plan-premium', name: 'Plano Premium', slug: 'PREMIUM', description: 'Para empresas com volume consistente de notas.', priceMonthly: 89.90, priceYearly: 0, maxNotasMensal: 30, maxClientes: 50, tipo: 'PLANO', recommended: false, features: JSON.stringify(['Ate 30 emissoes/mes','Ate 50 clientes','Suporte VIP']) },
  { id: 'pkg-notas', name: 'Pacote +3 Notas', slug: 'PACOTE_NOTA_3', description: 'Saldo extra de 3 notas avulsas.', priceMonthly: 5.90, priceYearly: 0, maxNotasMensal: 3, maxClientes: 0, tipo: 'PACOTE_NOTAS', features: JSON.stringify(['+3 notas fiscais','Saldo acumulativo']) },
  { id: 'pkg-clientes', name: 'Pacote +5 Clientes', slug: 'PACOTE_CLIENTE_5', description: 'Adicione mais 5 clientes ao seu limite.', priceMonthly: 5.90, priceYearly: 0, maxNotasMensal: 0, maxClientes: 5, tipo: 'PACOTE_CLIENTES', features: JSON.stringify(['+5 clientes','Pagamento unico']) }
];

const tickets = [
  { id: 'ticket-1', protocolo: 1042, assunto: 'Duvida sobre certificado A1', categoria: 'Certificado digital', prioridade: 'MEDIA', status: 'EM_ANDAMENTO', createdAt: '2026-06-16T11:00:00.000Z' },
  { id: 'ticket-2', protocolo: 1037, assunto: 'PDF de nota autorizada', categoria: 'Documentos fiscais', prioridade: 'BAIXA', status: 'RESOLVIDO', createdAt: '2026-06-10T15:20:00.000Z' }
];

function json(data, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(data) };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(5000);
  await page.addInitScript(({ userId, role }) => {
    localStorage.setItem('userId', userId);
    localStorage.setItem('userRole', role);
    localStorage.setItem('tutorialStep', '9');
  }, { userId: demoUserId, role: 'COMUM' });

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === '/api/perfil') return route.fulfill(json(perfil));
    if (p === '/api/clientes') return route.fulfill(json({ data: clientes, meta: { total: clientes.length, page: 1, limit: 10, totalPages: 1 } }));
    if (p === '/api/notas') return route.fulfill(json({ data: vendas, meta: { total: vendas.length, page: 1, limit: 10, totalPages: 1 } }));
    if (p === '/api/relatorios') return route.fulfill(json({ data: relatorioNotas, summary: { totalValor: 5050, qtdAutorizadas: 2, qtdCanceladas: 0 }, prestador: perfil, meta: { totalPages: 1 } }));
    if (p === '/api/avisos') return route.fulfill(json([{ id: 'aviso-1', title: 'Certificado valido', description: 'Seu certificado A1 esta ativo e pronto para emissao.', tone: 'emerald', action: 'Ver configuracoes', href: '/configuracoes' }]));
    if (p === '/api/checkout') return route.fulfill(json({ pedido: null }));
    if (p === '/api/plans') return route.fulfill(json(plans));
    if (p === '/api/notas/rascunhos') return route.fulfill(json({ data: [] }));
    if (p === '/api/suporte/tickets') return route.fulfill(json(tickets));
    if (p === '/api/contador/vinculo') return route.fulfill(json([]));
    if (p === '/api/clientes/notificacoes') return route.fulfill(json({ count: 2 }));
    if (p === '/api/saas/stats') return route.fulfill(json({ users: 128, notas: 940, uptime: '99.9%' }));
    if (p === '/api/cupons/validar') return route.fulfill(json({ error: 'Cupom nao encontrado' }, 404));
    return route.fulfill(json({ success: true }));
  });

  const shots = [];
  async function capture(name, url, opts = {}) {
    await page.goto(`http://localhost:3001${url}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(opts.delay || 800);
    if (opts.action) await opts.action();
    const file = path.join(outDir, `${String(shots.length + 1).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    shots.push({ name, url, file });
    console.log(`captured ${name}`);
  }

  await capture('home-planos', '/');
  await capture('checkout-contratacao', '/checkout', { action: async () => {
    await page.locator('select').first().selectOption('plan-standard').catch(() => {});
    await page.waitForTimeout(700);
  }});
  await capture('login', '/login');
  await capture('cadastro', '/cadastro');
  await capture('dashboard-cliente', '/cliente/dashboard');
  await capture('menu-lateral', '/cliente/dashboard', { action: async () => { await page.getByRole('button', { name: 'Abrir menu' }).click(); await page.waitForTimeout(800); } });
  await capture('clientes-carteira', '/cliente');
  await capture('emitir-passo-1', '/emitir');
  await capture('emitir-passo-2', '/emitir', { action: async () => {
    await page.locator('select').first().selectOption('cli-1').catch(() => {});
    const nextButton = page.getByRole('button', { name: 'Próximo' });
    if (await nextButton.count()) await nextButton.click().catch(() => {});
    await page.waitForTimeout(800);
  }});
  await capture('notas-emitidas', '/cliente/notas');
  await capture('relatorios', '/relatorios', { delay: 5000 });
  await capture('suporte', '/cliente/suporte');
  await capture('ajuda', '/cliente/ajuda');
  await capture('configuracoes', '/configuracoes');
  await capture('minha-conta-planos', '/configuracoes/minha-conta');

  fs.writeFileSync(path.join(outDir, 'screenshots.json'), JSON.stringify(shots, null, 2));
  await browser.close();
  console.log(JSON.stringify({ outDir, count: shots.length }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

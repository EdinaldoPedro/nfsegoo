import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from 'file:///C:/Users/edina/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const root = process.cwd();
const outDir = path.join(root, 'outputs');
const assetDir = path.join(outDir, 'apresentacao-saas-assets');
const qaDir = path.join(assetDir, 'qa');
const previewDir = path.join(assetDir, 'preview');
const layoutDir = path.join(assetDir, 'layout');
const finalPptx = path.join(outDir, 'Apresentacao-Guia-NFSeGoo-SaaS.pptx');
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(qaDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
await fs.mkdir(layoutDir, { recursive: true });

const shots = JSON.parse(await fs.readFile(path.join(assetDir, 'screenshots.json'), 'utf8'));
const byName = Object.fromEntries(shots.map(s => [s.name, s]));

const slides = [
  { name: 'home-planos', eyebrow: 'Entrada', title: 'Conhecer o SaaS e os planos', body: 'Primeiro contato com proposta, navegacao publica e acesso a contratacao.', actions: ['Entender o produto', 'Comparar planos', 'Entrar ou cadastrar'] },
  { name: 'checkout-contratacao', eyebrow: 'Contratacao', title: 'Montar assinatura e adicionais', body: 'O cliente escolhe plano, ciclo, pacotes extras e envia a solicitacao para ativacao manual.', actions: ['Selecionar plano', 'Adicionar extras', 'Solicitar contratacao'] },
  { name: 'login', eyebrow: 'Acesso', title: 'Entrar na conta', body: 'Tela simples para autenticar por e-mail/CPF e senha antes de acessar a area do cliente.', actions: ['Informar credenciais', 'Recuperar senha', 'Acessar ambiente'] },
  { name: 'cadastro', eyebrow: 'Onboarding', title: 'Criar conta de cliente', body: 'Fluxo inicial para novo usuario iniciar o uso do SaaS e validar dados de acesso.', actions: ['Cadastrar dados', 'Confirmar contato', 'Iniciar teste/compra'] },
  { name: 'dashboard-cliente', eyebrow: 'Dashboard', title: 'Ver prontidao fiscal e proximas acoes', body: 'O painel consolida alertas, certificado, plano, notas recentes e a acao mais importante do momento.', actions: ['Ver status fiscal', 'Emitir nova nota', 'Acompanhar atividade'] },
  { name: 'menu-lateral', eyebrow: 'Navegacao', title: 'Abrir menu e alternar areas', body: 'O menu reune perfil, empresa, certificado, gestao de clientes, relatorios, ajuda, suporte e logout.', actions: ['Ver dados da conta', 'Trocar empresa', 'Ir para gestao'] },
  { name: 'clientes-carteira', eyebrow: 'Carteira', title: 'Gerenciar tomadores PF, PJ e exterior', body: 'Lista de clientes com busca, tipo fiscal, localizacao e edicao de cadastro.', actions: ['Buscar tomador', 'Cadastrar novo cliente', 'Editar dados fiscais'] },
  { name: 'emitir-passo-1', eyebrow: 'Emissao', title: 'Escolher o tomador da NFS-e', body: 'Primeira etapa do assistente de emissao, com guia contextual e rascunhos recuperaveis quando aplicavel.', actions: ['Selecionar cliente', 'Revisar tomador', 'Avancar'] },
  { name: 'emitir-passo-2', eyebrow: 'Emissao', title: 'Preencher servico, CNAE e valores', body: 'A segunda etapa concentra dados tributarios, valor do servico e orientacoes para evitar rejeicao.', actions: ['Selecionar CNAE', 'Informar valor', 'Descrever servico'] },
  { name: 'notas-emitidas', eyebrow: 'Notas', title: 'Consultar historico e corrigir falhas', body: 'A tela de notas mostra status, codigo de servico, valores e acoes de PDF/XML, cancelamento, ajuda ou correcao.', actions: ['Baixar documentos', 'Cancelar nota', 'Corrigir emissao'] },
  { name: 'relatorios', eyebrow: 'Relatorios', title: 'Fechar periodo fiscal', body: 'Relatorios filtram periodo, totalizam emissao e permitem exportar conferencia em PDF/XML.', actions: ['Filtrar datas', 'Selecionar notas', 'Gerar relatorio'] },
  { name: 'suporte', eyebrow: 'Suporte', title: 'Abrir e acompanhar chamados', body: 'Central para tickets, solicitacoes de contador e acesso rapido a guias antes de chamar a equipe.', actions: ['Pesquisar tickets', 'Abrir chamado', 'Autorizar contador'] },
  { name: 'ajuda', eyebrow: 'Ajuda', title: 'Consultar central de conhecimento', body: 'Base guiada com artigos e orientacoes sobre emissao, configuracao, certificado, cancelamento e conta.', actions: ['Pesquisar artigo', 'Seguir passo a passo', 'Ir para tela relacionada'] },
  { name: 'configuracoes', eyebrow: 'Empresa', title: 'Configurar empresa, certificado e ambiente', body: 'Area fiscal onde o cliente atualiza dados obrigatorios, certificado A1, CNAEs e ambiente de emissao.', actions: ['Completar cadastro', 'Enviar certificado', 'Ajustar ambiente'] },
  { name: 'minha-conta-planos', eyebrow: 'Conta', title: 'Gerenciar assinatura e dados pessoais', body: 'Visao de perfil, limites do plano, seguranca da conta e preferencias do usuario.', actions: ['Editar perfil', 'Acompanhar limites', 'Salvar alteracoes'] }
];

await fs.writeFile(path.join(assetDir, 'source-notes.txt'), [
  'Fonte: SaaS NFSeGoo executado localmente em http://localhost:3001.',
  'Data de acesso/captura: 18/06/2026.',
  'Modo: prints reais da interface Next.js local, com respostas de API demonstrativas interceptadas na sessao de captura porque o PostgreSQL local nao estava ativo.',
  'Uso: slides de guia/apresentacao para cliente, sem expor credenciais reais ou dados de producao.',
  ...slides.map((s, i) => `Slide ${i + 3}: ${s.title} - screenshot ${path.basename(byName[s.name].file)}`)
].join('\n'));

await fs.writeFile(path.join(assetDir, 'slide-plan.txt'), [
  'Modo: create.',
  'Formato: 16:9, 1280x720.',
  'Paleta: slate #0f172a, blue #2563eb, emerald #10b981, amber #f59e0b, background #f8fafc.',
  'Fontes: Aptos Display para titulos, Aptos para corpo.',
  'Escala: capa 54px; titulos 30-42px; corpo 17-20px; rodape 10px.',
  'Estrutura: capa, mapa da jornada, uma tela por funcionalidade com print real e resumo operacional.'
].join('\n'));

const ppt = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const C = { slate: '#0f172a', muted: '#64748b', blue: '#2563eb', blueDark: '#1d4ed8', emerald: '#10b981', amber: '#f59e0b', bg: '#f8fafc', line: '#dbe3ef', white: '#ffffff' };

function addText(slide, text, x, y, w, h, style = {}) {
  const shape = slide.shapes.add({ geometry: 'textbox', position: { left: x, top: y, width: w, height: h }, fill: 'none', line: { style: 'solid', fill: 'none', width: 0 } });
  shape.text = text;
  shape.text.style = { fontSize: style.fontSize || 18, color: style.color || C.slate, bold: !!style.bold, typeface: style.typeface || 'Aptos', alignment: style.alignment || 'left' };
  return shape;
}

function addFooter(slide, n) {
  addText(slide, `NFSeGoo SaaS | Guia do cliente | ${String(n).padStart(2, '0')}`, 64, 686, 480, 18, { fontSize: 10, color: '#94a3b8' });
  addText(slide, 'Prints da interface local com dados demonstrativos', 772, 686, 444, 18, { fontSize: 10, color: '#94a3b8', alignment: 'right' });
}

function addPill(slide, text, x, y, w, fill = '#e0f2fe', color = C.blueDark) {
  slide.shapes.add({ geometry: 'roundRect', position: { left: x, top: y, width: w, height: 28 }, fill, line: { style: 'solid', fill, width: 1 }, borderRadius: 'rounded-xl' });
  addText(slide, text, x + 12, y + 5, w - 24, 18, { fontSize: 11, bold: true, color });
}

async function imageBytes(file) {
  const b = await fs.readFile(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

async function addScreenshot(slide, file, x, y, w, h) {
  slide.shapes.add({ geometry: 'roundRect', position: { left: x - 10, top: y - 10, width: w + 20, height: h + 20 }, fill: C.white, line: { style: 'solid', fill: C.line, width: 1 }, borderRadius: 'rounded-xl', shadow: 'shadow-lg' });
  slide.images.add({ blob: await imageBytes(file), contentType: 'image/png', alt: 'Print real do SaaS NFSeGoo', fit: 'cover', position: { left: x, top: y, width: w, height: h }, geometry: 'roundRect', borderRadius: 'rounded-lg' });
}

// Cover
{
  const slide = ppt.slides.add();
  slide.background.fill = C.bg;
  slide.shapes.add({ geometry: 'rect', position: { left: 0, top: 0, width: 1280, height: 720 }, fill: C.bg, line: { style: 'solid', fill: C.bg, width: 0 } });
  slide.shapes.add({ geometry: 'rect', position: { left: 0, top: 0, width: 430, height: 720 }, fill: C.slate, line: { style: 'solid', fill: C.slate, width: 0 } });
  addPill(slide, 'SAAS WEB', 64, 80, 112, '#dbeafe', C.blueDark);
  addText(slide, 'NFSeGoo', 64, 138, 320, 70, { fontSize: 56, bold: true, color: C.white, typeface: 'Aptos Display' });
  addText(slide, 'Apresentacao guia para cliente', 64, 222, 300, 72, { fontSize: 28, bold: true, color: '#e2e8f0', typeface: 'Aptos Display' });
  addText(slide, 'Um roteiro visual com prints reais do SaaS: contratacao, dashboard, clientes, emissao, notas, relatorios, suporte e configuracoes.', 64, 330, 300, 154, { fontSize: 20, color: '#cbd5e1' });
  await addScreenshot(slide, byName['dashboard-cliente'].file, 476, 96, 704, 396);
  addPill(slide, 'Cliente', 476, 532, 92, '#dcfce7', '#047857');
  addText(slide, 'Capturado em ambiente local com dados demonstrativos', 588, 534, 420, 26, { fontSize: 15, color: C.muted, bold: true });
  addFooter(slide, 1);
}

// Journey map
{
  const slide = ppt.slides.add();
  slide.background.fill = C.bg;
  addText(slide, 'Mapa da jornada do cliente', 64, 54, 620, 48, { fontSize: 40, bold: true, typeface: 'Aptos Display' });
  addText(slide, 'Da primeira visita ao fechamento fiscal, cada etapa abaixo corresponde a um print real da interface.', 64, 108, 760, 34, { fontSize: 18, color: C.muted });
  const items = [
    ['1', 'Contratar', 'Planos, checkout e cadastro'],
    ['2', 'Preparar', 'Empresa, certificado e clientes'],
    ['3', 'Emitir', 'Tomador, servico e revisao'],
    ['4', 'Acompanhar', 'Notas, erros e documentos'],
    ['5', 'Fechar', 'Relatorios e suporte']
  ];
  const y = 220;
  for (let i = 0; i < items.length; i++) {
    const x = 86 + i * 230;
    slide.shapes.add({ geometry: 'roundRect', position: { left: x, top: y, width: 178, height: 210 }, fill: C.white, line: { style: 'solid', fill: C.line, width: 1 }, borderRadius: 'rounded-xl', shadow: 'shadow-sm' });
    slide.shapes.add({ geometry: 'ellipse', position: { left: x + 22, top: y + 24, width: 44, height: 44 }, fill: i === 4 ? C.emerald : C.blue, line: { style: 'solid', fill: 'none', width: 0 } });
    addText(slide, items[i][0], x + 37, y + 33, 20, 24, { fontSize: 18, bold: true, color: C.white, alignment: 'center' });
    addText(slide, items[i][1], x + 22, y + 92, 134, 34, { fontSize: 25, bold: true, typeface: 'Aptos Display' });
    addText(slide, items[i][2], x + 22, y + 136, 134, 54, { fontSize: 16, color: C.muted });
    if (i < items.length - 1) addText(slide, '>', x + 190, y + 82, 40, 40, { fontSize: 36, color: '#94a3b8', bold: true });
  }
  addFooter(slide, 2);
}

let slideNo = 3;
for (const item of slides) {
  const slide = ppt.slides.add();
  slide.background.fill = C.bg;
  addPill(slide, item.eyebrow.toUpperCase(), 64, 54, Math.max(96, item.eyebrow.length * 11 + 40), '#dbeafe', C.blueDark);
  addText(slide, item.title, 64, 102, 344, 86, { fontSize: 32, bold: true, typeface: 'Aptos Display' });
  addText(slide, item.body, 64, 202, 330, 94, { fontSize: 18, color: C.muted });
  addText(slide, 'O que o cliente faz', 64, 330, 280, 28, { fontSize: 19, bold: true });
  let ay = 374;
  for (const action of item.actions) {
    slide.shapes.add({ geometry: 'ellipse', position: { left: 68, top: ay + 6, width: 10, height: 10 }, fill: C.emerald, line: { style: 'solid', fill: 'none', width: 0 } });
    addText(slide, action, 90, ay, 300, 24, { fontSize: 17, color: C.slate, bold: true });
    ay += 38;
  }
  await addScreenshot(slide, byName[item.name].file, 450, 78, 736, 414);
  addText(slide, `Tela: ${item.name.replaceAll('-', ' ')}`, 450, 526, 500, 22, { fontSize: 12, color: '#94a3b8', bold: true });
  slide.shapes.add({ geometry: 'roundRect', position: { left: 450, top: 560, width: 736, height: 72 }, fill: '#eff6ff', line: { style: 'solid', fill: '#bfdbfe', width: 1 }, borderRadius: 'rounded-xl' });
  addText(slide, 'Dica de apresentacao', 474, 574, 180, 20, { fontSize: 12, bold: true, color: C.blueDark });
  addText(slide, `Mostre esta tela como parte do fluxo: ${item.actions.join(' -> ')}.`, 474, 598, 666, 22, { fontSize: 16, color: C.slate });
  addFooter(slide, slideNo);
  slideNo += 1;
}

for (const [index, slide] of ppt.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, '0')}`;
  const png = await ppt.export({ slide, format: 'png', scale: 1 });
  await fs.writeFile(path.join(previewDir, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: 'layout' });
  await fs.writeFile(path.join(layoutDir, `${stem}.layout.json`), await layout.text());
}
const montage = await ppt.export({ format: 'webp', montage: true, scale: 1 });
await fs.writeFile(path.join(previewDir, 'deck-montage.webp'), new Uint8Array(await montage.arrayBuffer()));

const pptx = await PresentationFile.exportPptx(ppt);
await pptx.save(finalPptx);

await fs.writeFile(path.join(qaDir, 'visual-qa.txt'), [
  `PPTX exportado: ${finalPptx}`,
  `Slides renderizados: ${ppt.slides.items.length}`,
  'Verificacao: previews PNG e montagem WEBP gerados com artifact-tool.',
  'Observacao: screenshots sao prints reais da UI local; dados de negocio sao demonstrativos porque o banco local PostgreSQL nao estava ativo.'
].join('\n'));

console.log(JSON.stringify({ finalPptx, slideCount: ppt.slides.items.length, previewDir, montage: path.join(previewDir, 'deck-montage.webp') }, null, 2));

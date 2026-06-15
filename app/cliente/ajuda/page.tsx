'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BadgeHelp,
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  FileArchive,
  FileCheck2,
  FileDown,
  FileText,
  KeyRound,
  LifeBuoy,
  LockKeyhole,
  Mail,
  MonitorPlay,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Ticket,
  UploadCloud,
  UserCog,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';

type HelpArticle = {
  id: string;
  title: string;
  category: string;
  path: string;
  summary: string;
  icon: any;
  steps: string[];
  warning?: string;
  related?: { label: string; href: string }[];
  tags: string[];
};

type MockupType =
  | 'dashboard'
  | 'notificacoes'
  | 'configuracoes'
  | 'certificado'
  | 'clientes'
  | 'emitir'
  | 'rascunhos'
  | 'notas'
  | 'cancelar'
  | 'suporte'
  | 'conta'
  | 'contador';

type VisualGuide = {
  id: string;
  title: string;
  subtitle: string;
  time: string;
  icon: any;
  actionLabel: string;
  actionHref: string;
  chapters: {
    title: string;
    path: string;
    text: string;
    mockup: MockupType;
  }[];
};

const artigos: HelpArticle[] = [
  {
    id: 'dashboard-prontidao',
    title: 'Entender o dashboard e a prontidão para emissão',
    category: 'Dashboard',
    path: 'Dashboard',
    summary: 'Como ler a próxima ação, os avisos e os indicadores que liberam a emissão.',
    icon: ClipboardCheck,
    steps: [
      'Abra o Dashboard depois de entrar no SaaS.',
      'Use o card Próxima ação para saber o próximo passo operacional.',
      'Se houver pendência real, confira o bloco Prontidão para emissão.',
      'Quando cadastro, IBGE, certificado e ambiente estiverem corretos, o botão Emitir nova nota fica liberado.',
      'Alertas leves, como certificado perto do vencimento, aparecem na Central de notificações.',
    ],
    related: [{ label: 'Abrir dashboard', href: '/cliente/dashboard' }],
    tags: ['dashboard', 'prontidao', 'proxima acao', 'indicadores'],
  },
  {
    id: 'central-notificacoes',
    title: 'Acompanhar avisos e comunicados',
    category: 'Dashboard',
    path: 'Dashboard > Central de notificações',
    summary: 'Onde ficam avisos automáticos, comunicados do SaaS e alertas de certificado.',
    icon: Bell,
    steps: [
      'No Dashboard, veja a Central de notificações abaixo da vitrine lateral.',
      'Avisos automáticos aparecem ali quando exigem atenção, mas não impedem necessariamente a emissão.',
      'Certificado perto do vencimento aparece como aviso para antecipar renovação.',
      'Comunicados gerais da plataforma também serão exibidos nessa área.',
      'Clique no aviso quando ele tiver atalho para a tela de correção.',
    ],
    related: [{ label: 'Abrir dashboard', href: '/cliente/dashboard' }],
    tags: ['avisos', 'notificacoes', 'comunicado', 'certificado vencendo'],
  },
  {
    id: 'configurar-empresa',
    title: 'Configurar empresa para emissão',
    category: 'Configuração',
    path: 'Menu > Minha Empresa > Configurações da Empresa',
    summary: 'Dados mínimos que precisam estar corretos antes da primeira nota.',
    icon: Building2,
    steps: [
      'Abra o menu no canto superior direito.',
      'Na seção Minha Empresa, clique em Configurações da Empresa.',
      'Preencha razão social, CNPJ, endereço fiscal e código IBGE.',
      'Confira a Inscrição Municipal exatamente como usada no Portal Nacional ou prefeitura.',
      'Salve antes de voltar ao Dashboard ou à emissão.',
    ],
    warning: 'Inscrição Municipal incorreta costuma gerar rejeição técnica ou autorização em cadastro errado.',
    related: [{ label: 'Abrir configurações', href: '/configuracoes' }],
    tags: ['empresa', 'ibge', 'im', 'inscricao municipal', 'configuracao'],
  },
  {
    id: 'ambiente-producao',
    title: 'Usar homologação ou produção',
    category: 'Configuração',
    path: 'Menu > Configurações da Empresa > Ambiente',
    summary: 'Diferença entre teste e emissão com valor fiscal.',
    icon: Server,
    steps: [
      'Use Homologação para testar sem gerar nota com valor fiscal.',
      'Use Produção quando a empresa já estiver pronta para emissão oficial.',
      'Confira o ambiente no Dashboard antes de emitir.',
      'Se o ambiente estiver errado, ajuste em Configurações da Empresa.',
      'Depois de mudar o ambiente, revise a nota antes de enviar.',
    ],
    warning: 'Nota em produção possui efeito fiscal. Homologação deve ser usada apenas para testes.',
    related: [{ label: 'Abrir configurações', href: '/configuracoes' }],
    tags: ['ambiente', 'homologacao', 'producao', 'teste'],
  },
  {
    id: 'certificado-a1',
    title: 'Cadastrar ou trocar certificado A1',
    category: 'Configuração',
    path: 'Menu > Minha Empresa > Configurações da Empresa > Certificado A1',
    summary: 'O certificado assina a DPS e permite comunicação fiscal.',
    icon: ShieldCheck,
    steps: [
      'Abra Configurações da Empresa.',
      'Localize a área do Certificado A1.',
      'Envie o arquivo no formato aceito, normalmente .pfx ou .p12.',
      'Informe a senha do certificado e aguarde a validação.',
      'Se estiver vencido ou perto do vencimento, envie um novo certificado antes de bloquear a operação.',
    ],
    warning: 'Sem certificado válido, a transmissão em produção não deve seguir.',
    related: [{ label: 'Ver certificado', href: '/configuracoes' }],
    tags: ['certificado', 'a1', 'senha', 'validade', 'assinatura'],
  },
  {
    id: 'minha-conta',
    title: 'Alterar dados pessoais, e-mail e senha',
    category: 'Conta',
    path: 'Menu > Configurações > Editar Dados Pessoais',
    summary: 'Onde ajustar nome, telefone, e-mail, senha, preferências e assinatura.',
    icon: UserCog,
    steps: [
      'Abra o menu no canto superior direito.',
      'Clique em Editar Dados Pessoais.',
      'Atualize dados básicos como nome e telefone quando necessário.',
      'Use as áreas de e-mail e senha para iniciar alterações sensíveis.',
      'Confira assinatura, limites e vencimento no painel lateral da página.',
    ],
    warning: 'Alterações de e-mail e senha podem exigir confirmação para proteger a conta.',
    related: [{ label: 'Minha conta', href: '/configuracoes/minha-conta' }],
    tags: ['minha conta', 'senha', 'email', 'dados pessoais', 'assinatura'],
  },
  {
    id: 'limites-assinatura',
    title: 'Entender limites do plano',
    category: 'Conta',
    path: 'Menu > Editar Dados Pessoais > Assinatura',
    summary: 'Como acompanhar limite de NFS-e, clientes, empresas e renovação.',
    icon: CalendarClock,
    steps: [
      'Abra Minha Conta pelo menu.',
      'Veja o bloco Assinatura no lado esquerdo.',
      'Confira o consumo de NFS-e do mês e o limite contratado.',
      'Confira limites de clientes ou empresas vinculadas, conforme seu plano.',
      'Se precisar aumentar o volume, use a troca de plano ou entre em contato com suporte.',
    ],
    related: [
      { label: 'Minha conta', href: '/configuracoes/minha-conta' },
      { label: 'Abrir suporte', href: '/cliente/suporte/novo' },
    ],
    tags: ['plano', 'limite', 'assinatura', 'renovacao', 'nfs-e'],
  },
  {
    id: 'clientes-tomadores',
    title: 'Cadastrar clientes e tomadores',
    category: 'Clientes',
    path: 'Menu > Gestão > Clientes',
    summary: 'Como preparar PJ, PF e exterior antes de emitir.',
    icon: UserPlus,
    steps: [
      'Abra o menu e clique em Clientes.',
      'Clique em adicionar novo cliente.',
      'Escolha PJ, PF ou Exterior conforme o tomador.',
      'Preencha documento, nome e dados fiscais exigidos.',
      'Salve o cadastro e use esse tomador na tela de emissão.',
    ],
    warning: 'Se informar endereço, preencha os campos mínimos para evitar quebra no XML.',
    related: [{ label: 'Cadastrar cliente', href: '/cliente' }],
    tags: ['cliente', 'tomador', 'pf', 'pj', 'cpf', 'cnpj', 'endereco'],
  },
  {
    id: 'consulta-cpf',
    title: 'Consultar CPF no Portal Nacional',
    category: 'Clientes',
    path: 'Menu > Clientes > Novo cliente > PF',
    summary: 'O que acontece quando o SaaS tenta buscar o nome oficial da pessoa física.',
    icon: RefreshCw,
    steps: [
      'No cadastro de cliente PF, informe o CPF.',
      'O SaaS tenta consultar o Portal Nacional para trazer o nome oficial.',
      'Se o portal estiver instável, a tela informa que a consulta não foi concluída.',
      'Você pode tentar novamente depois ou seguir conforme as regras internas do cadastro.',
      'Quando o nome oficial retornar, revise antes de salvar.',
    ],
    warning: 'Falha na consulta oficial geralmente indica instabilidade externa, não erro definitivo do cliente.',
    related: [{ label: 'Clientes', href: '/cliente' }],
    tags: ['cpf', 'consulta', 'portal nacional', 'pf', 'nome oficial'],
  },
  {
    id: 'pf-sem-endereco',
    title: 'Emitir contra PF sem endereço',
    category: 'Clientes',
    path: 'Menu > Clientes > Novo cliente > PF > Emitir sem informar endereço',
    summary: 'Quando a pessoa física pode ir no XML sem endereço.',
    icon: FileText,
    steps: [
      'Cadastre ou edite um cliente PF.',
      'Marque a opção Emitir sem informar endereço.',
      'O SaaS oculta os campos de endereço e envia apenas os dados essenciais do tomador.',
      'Na revisão da nota, confira CPF, nome, serviço e valor.',
      'Se desmarcar a opção, preencha todos os dados mínimos de endereço.',
    ],
    warning: 'Não deixe endereço parcial. Use sem endereço ou endereço completo o suficiente para emissão.',
    related: [{ label: 'Clientes', href: '/cliente' }],
    tags: ['pf', 'sem endereco', 'cpf', 'tomador', 'xml'],
  },
  {
    id: 'cliente-exterior',
    title: 'Cadastrar tomador do exterior',
    category: 'Clientes',
    path: 'Menu > Clientes > Novo cliente > Exterior',
    summary: 'Como separar clientes estrangeiros dos cadastros PF e PJ nacionais.',
    icon: Briefcase,
    steps: [
      'Abra Clientes e escolha adicionar novo cliente.',
      'Selecione o tipo Exterior.',
      'Informe nome, país, moeda e identificação disponível.',
      'Revise se a operação realmente deve ser emitida como serviço para exterior.',
      'Salve e use o tomador na emissão.',
    ],
    related: [{ label: 'Clientes', href: '/cliente' }],
    tags: ['exterior', 'pais', 'moeda', 'tomador estrangeiro'],
  },
  {
    id: 'primeira-emissao',
    title: 'Emitir a primeira NFS-e',
    category: 'Emissão',
    path: 'Dashboard > Emitir nova nota ou /emitir',
    summary: 'Caminho recomendado para sair do cadastro até a nota autorizada.',
    icon: FileCheck2,
    steps: [
      'No Dashboard, confirme que a próxima ação libera emissão.',
      'Clique em Emitir nova nota.',
      'Selecione ou cadastre o tomador.',
      'Informe atividade, descrição, valor, competência e dados de serviço.',
      'Revise a nota e clique em emitir.',
      'Acompanhe a autorização e a busca de PDF/XML em Minhas Notas.',
    ],
    related: [
      { label: 'Emitir nota', href: '/emitir' },
      { label: 'Minhas notas', href: '/cliente/notas' },
    ],
    tags: ['emitir', 'primeira nota', 'nfse', 'autorizacao'],
  },
  {
    id: 'rascunhos-emissao',
    title: 'Retomar rascunhos de emissão',
    category: 'Emissão',
    path: 'Emitir nova nota > Bloco Rascunhos',
    summary: 'Como recuperar uma nota que falhou por erro corrigível.',
    icon: Clock,
    steps: [
      'Quando uma emissão falha por erro corrigível, o SaaS salva um rascunho.',
      'Volte para Emitir nova nota.',
      'No bloco Rascunhos, escolha Retomar na revisão.',
      'Revise os dados e ajuste o ponto indicado pela mensagem.',
      'Ao emitir com sucesso, o rascunho é removido automaticamente.',
    ],
    warning: 'O SaaS mantém no máximo 5 rascunhos recentes.',
    related: [{ label: 'Emitir nota', href: '/emitir' }],
    tags: ['rascunho', 'emissao', 'erro corrigivel', 'retomar'],
  },
  {
    id: 'dps-duplicado',
    title: 'Corrigir DPS duplicado',
    category: 'Erros comuns',
    path: 'Emitir nova nota > Revisão > Número DPS',
    summary: 'O que fazer quando o Portal informa que o número da DPS já foi usado.',
    icon: AlertTriangle,
    steps: [
      'Retome o rascunho salvo na tela de emissão.',
      'Vá para a etapa Revisão.',
      'Altere o número da DPS somente se o Portal retornou duplicidade.',
      'Use um número válido e reenvie a nota.',
      'Depois de autorizada, confira a nota em Minhas Notas.',
    ],
    warning: 'Não altere DPS por timeout, 502, 503 ou ECONNRESET. Esses casos podem ser instabilidade externa.',
    related: [{ label: 'Emitir nota', href: '/emitir' }],
    tags: ['dps', 'duplicado', 'rascunho', 'erro', 'reenviar'],
  },
  {
    id: 'reenviar-venda',
    title: 'Reenviar uma emissão com falha',
    category: 'Erros comuns',
    path: 'Tela de correção da venda > Reenviar',
    summary: 'Quando usar reenvio e quando evitar mexer nos dados.',
    icon: RefreshCw,
    steps: [
      'Abra a venda com falha a partir da tela indicada pelo SaaS.',
      'Leia a mensagem de retorno para entender se é instabilidade ou dado incorreto.',
      'Corrija apenas campos realmente apontados pelo retorno.',
      'Use reenviar quando a venda estiver pronta para nova tentativa.',
      'Depois do sucesso, acompanhe número da nota, status, PDF e XML.',
    ],
    warning: 'Se a falha foi instabilidade do Portal, tente reenviar sem mudar dados fiscais.',
    tags: ['reenviar', 'correcao', 'falha emissao', 'portal'],
  },
  {
    id: 'portal-instavel',
    title: 'Portal Nacional instável',
    category: 'Erros comuns',
    path: 'Emissão, reenvio, cancelamento ou download de PDF/XML',
    summary: 'Entenda timeout, 502, 503, ECONNRESET e falhas temporárias.',
    icon: XCircle,
    steps: [
      'Aguarde alguns minutos antes de tentar novamente.',
      'Use o reenvio ou a atualização de PDF/XML quando o SaaS liberar a ação.',
      'Evite alterar DPS, serviço ou tomador se a mensagem indica instabilidade.',
      'Se a nota foi autorizada mas faltou arquivo, tente baixar ou sincronizar novamente.',
      'Abra chamado se o erro persistir em várias tentativas.',
    ],
    warning: 'Erro temporário não significa necessariamente que a nota está errada.',
    related: [{ label: 'Abrir suporte', href: '/cliente/suporte/novo' }],
    tags: ['portal', 'instavel', '503', '502', 'timeout', 'econnreset', 'pdf', 'xml'],
  },
  {
    id: 'minhas-notas',
    title: 'Consultar histórico de notas',
    category: 'Notas',
    path: 'Dashboard > Minhas Notas ou Menu > Minhas Notas',
    summary: 'Onde visualizar notas autorizadas, canceladas e arquivos fiscais.',
    icon: FileText,
    steps: [
      'No Dashboard, clique em Ver todas as notas.',
      'Use a lista para localizar nota por tomador, status ou data.',
      'Abra o menu de ações nos três pontos.',
      'Visualize PDF, baixe arquivos ou cancele quando permitido.',
      'Se algo não aparecer após emissão recente, atualize a página ou aguarde a sincronização.',
    ],
    related: [{ label: 'Minhas notas', href: '/cliente/notas' }],
    tags: ['notas', 'historico', 'status', 'autorizada', 'cancelada'],
  },
  {
    id: 'baixar-arquivos',
    title: 'Baixar PDF e XML',
    category: 'Notas',
    path: 'Minhas Notas > Menu da nota > PDF/XML',
    summary: 'Como recuperar documentos oficiais da nota.',
    icon: FileDown,
    steps: [
      'Acesse Minhas Notas.',
      'Abra o menu de ações da nota.',
      'Use Visualizar PDF para conferir sem baixar.',
      'Use Baixar PDF para salvar o documento oficial.',
      'Use XML NFS-e para baixar o XML. Se houver cancelamento, o pacote inclui o evento junto.',
    ],
    warning: 'Quando o Portal Nacional não entrega o PDF no momento, tente novamente alguns minutos depois.',
    related: [{ label: 'Minhas notas', href: '/cliente/notas' }],
    tags: ['pdf', 'xml', 'download', 'visualizar', 'zip', 'evento'],
  },
  {
    id: 'cancelar-nota',
    title: 'Cancelar uma NFS-e',
    category: 'Notas',
    path: 'Minhas Notas > Menu da nota > Cancelar Nota',
    summary: 'Como cancelar e o que acontece com PDF, XML e evento.',
    icon: XCircle,
    steps: [
      'Abra Minhas Notas.',
      'No menu da nota autorizada, escolha Cancelar Nota.',
      'Selecione o motivo e informe justificativa.',
      'Aguarde o Portal autorizar o evento de cancelamento.',
      'Depois disso, o SaaS atualiza status, XML do evento e PDF cancelado.',
    ],
    warning: 'Cancelamento fiscal é sensível. Revise antes de confirmar.',
    related: [{ label: 'Minhas notas', href: '/cliente/notas' }],
    tags: ['cancelar', 'cancelamento', 'evento', 'pdf cancelado', 'xml'],
  },
  {
    id: 'sincronizar-nota',
    title: 'Quando usar sincronização fiscal',
    category: 'Notas',
    path: 'Bancada/admin ou ação de suporte vinculada à venda',
    summary: 'Como o SaaS corrige status, número, XML e PDF quando algo mudou fora do app.',
    icon: FileArchive,
    steps: [
      'Use sincronização quando a nota foi autorizada ou cancelada fora do fluxo normal do SaaS.',
      'A rotina consulta o retorno fiscal com a chave de acesso da nota.',
      'Se o status mudou no Portal, o SaaS deve atualizar a nota local.',
      'Quando há cancelamento, o sistema busca evento de cancelamento e PDF atualizado.',
      'Se a sincronização falhar por instabilidade, tente novamente ou abra suporte.',
    ],
    warning: 'Sincronização depende do Portal Nacional responder no momento da consulta.',
    related: [{ label: 'Abrir suporte', href: '/cliente/suporte/novo' }],
    tags: ['sincronizar', 'status', 'cancelada', 'autorizada', 'portal'],
  },
  {
    id: 'suporte-chamado',
    title: 'Abrir e acompanhar chamado',
    category: 'Suporte',
    path: 'Menu > Suporte > Abrir Ticket',
    summary: 'Como acionar o suporte com as informações certas.',
    icon: LifeBuoy,
    steps: [
      'Abra o menu e clique em Suporte.',
      'Clique em Abrir Ticket.',
      'Informe o assunto e descreva o que tentou fazer.',
      'Inclua CNPJ, ID da venda, número da nota ou print quando existir.',
      'Acompanhe respostas na própria Central de Suporte.',
    ],
    related: [
      { label: 'Suporte', href: '/cliente/suporte' },
      { label: 'Abrir chamado', href: '/cliente/suporte/novo' },
    ],
    tags: ['suporte', 'chamado', 'ticket', 'ajuda'],
  },
  {
    id: 'contador-acesso',
    title: 'Acesso do contador e troca de empresa',
    category: 'Contador',
    path: 'Menu > Minha Empresa > Alternar CNPJ',
    summary: 'Como o contador visualiza empresas vinculadas e muda o contexto de trabalho.',
    icon: Users,
    steps: [
      'Quando o usuário é contador e possui empresas vinculadas, o menu mostra o alternador de CNPJ.',
      'Abra o menu e localize Minha Empresa.',
      'Clique em Alternar CNPJ e escolha a empresa desejada.',
      'O SaaS recarrega o contexto para mostrar dashboard, notas, clientes e configurações daquele CNPJ.',
      'Para vínculos que exigem autorização, acompanhe a solicitação pelo suporte ou aguarde liberação.',
    ],
    warning: 'Sempre confira o CNPJ ativo antes de emitir ou cancelar nota.',
    related: [{ label: 'Dashboard', href: '/cliente/dashboard' }],
    tags: ['contador', 'vinculo', 'empresa', 'cnpj', 'alternar'],
  },
  {
    id: 'cadastro-login',
    title: 'Cadastro, login e recuperação de conta',
    category: 'Conta',
    path: 'Tela inicial > Login, Cadastro ou Recuperar Conta',
    summary: 'Fluxo de acesso e confirmação de conta.',
    icon: KeyRound,
    steps: [
      'No login, use o e-mail e senha cadastrados.',
      'No cadastro, informe dados reais e confirme a conta com o código recebido.',
      'Se o e-mail de confirmação não chegar, confira spam e aguarde limites de envio.',
      'Use Recuperar Conta se esqueceu a senha.',
      'Depois de logar, mantenha dados pessoais atualizados em Minha Conta.',
    ],
    warning: 'Em beta, o envio de e-mail pode ter limite. Isso não significa que o cadastro foi perdido.',
    related: [{ label: 'Minha conta', href: '/configuracoes/minha-conta' }],
    tags: ['login', 'cadastro', 'recuperar conta', 'email', 'codigo'],
  },
  {
    id: 'seguranca-acesso',
    title: 'Boas práticas de segurança',
    category: 'Conta',
    path: 'Menu > Editar Dados Pessoais e rotina de acesso',
    summary: 'Cuidados para proteger certificado, senha e operação fiscal.',
    icon: LockKeyhole,
    steps: [
      'Use senha forte e atualize quando suspeitar de exposição.',
      'Não compartilhe a senha do certificado A1 fora do ambiente seguro.',
      'Evite operar em computadores públicos ou redes desconhecidas.',
      'Ao terminar, use Sair no menu.',
      'Se notar acesso indevido ou vínculo estranho, abra chamado imediatamente.',
    ],
    related: [
      { label: 'Minha conta', href: '/configuracoes/minha-conta' },
      { label: 'Abrir suporte', href: '/cliente/suporte/novo' },
    ],
    tags: ['seguranca', 'senha', 'certificado', 'logout', 'acesso'],
  },
];

const categorias = ['Todos', ...Array.from(new Set(artigos.map((artigo) => artigo.category)))];

const guiasVisuais: VisualGuide[] = [
  {
    id: 'book-dashboard',
    title: 'Dashboard, avisos e prontidão',
    subtitle: 'Como entender se a empresa pode emitir e onde aparecem comunicados.',
    time: '4 min',
    icon: MonitorPlay,
    actionLabel: 'Abrir dashboard',
    actionHref: '/cliente/dashboard',
    chapters: [
      {
        title: 'Leia a próxima ação',
        path: 'Dashboard > Próxima ação',
        text: 'O card principal indica o próximo passo: emitir, configurar empresa, ajustar certificado ou renovar plano.',
        mockup: 'dashboard',
      },
      {
        title: 'Acompanhe notificações',
        path: 'Dashboard > Central de notificações',
        text: 'Avisos automáticos e comunicados gerais ficam abaixo da vitrine. Certificado perto do vencimento aparece aqui.',
        mockup: 'notificacoes',
      },
      {
        title: 'Corrija pendências reais',
        path: 'Dashboard > Prontidão para emissão',
        text: 'Quando algo bloqueia emissão, a prontidão mostra exatamente qual item precisa de ajuste.',
        mockup: 'configuracoes',
      },
    ],
  },
  {
    id: 'book-primeira-emissao',
    title: 'Primeira emissão de NFS-e',
    subtitle: 'Do cadastro inicial até a nota autorizada no histórico.',
    time: '7 min',
    icon: FileCheck2,
    actionLabel: 'Começar emissão',
    actionHref: '/emitir',
    chapters: [
      {
        title: 'Confirme que a empresa está pronta',
        path: 'Dashboard > Próxima ação',
        text: 'Antes de emitir, confira se cadastro, IBGE, certificado e ambiente estão liberados.',
        mockup: 'dashboard',
      },
      {
        title: 'Selecione ou cadastre o tomador',
        path: 'Emitir nova nota > Tomador',
        text: 'Escolha o cliente correto. Se ele ainda não existir, cadastre PF, PJ ou exterior antes de seguir.',
        mockup: 'emitir',
      },
      {
        title: 'Revise e acompanhe arquivos',
        path: 'Emitir nova nota > Revisão e Minhas Notas',
        text: 'Na etapa final, confira competência, descrição e valor. Depois acompanhe status, PDF e XML.',
        mockup: 'notas',
      },
    ],
  },
  {
    id: 'book-clientes',
    title: 'Clientes, PF sem endereço e exterior',
    subtitle: 'Como cadastrar tomadores sem travar a emissão depois.',
    time: '6 min',
    icon: UserPlus,
    actionLabel: 'Abrir clientes',
    actionHref: '/cliente',
    chapters: [
      {
        title: 'Escolha o tipo correto',
        path: 'Menu > Gestão > Clientes > Adicionar novo cliente',
        text: 'Separe PF, PJ e Exterior. Cada tipo tem campos fiscais diferentes e isso afeta o XML.',
        mockup: 'clientes',
      },
      {
        title: 'Use consulta de CPF quando disponível',
        path: 'Clientes > Novo PF > CPF',
        text: 'O SaaS tenta buscar o nome oficial no Portal Nacional. Se o Portal falhar, tente novamente depois.',
        mockup: 'clientes',
      },
      {
        title: 'Decida sobre endereço da PF',
        path: 'Clientes > Novo PF > Emitir sem informar endereço',
        text: 'Para PF, marque sem endereço quando permitido. Se informar endereço, preencha os mínimos para emissão.',
        mockup: 'clientes',
      },
    ],
  },
  {
    id: 'book-certificado',
    title: 'Configurar certificado A1',
    subtitle: 'Como preparar o certificado para assinar e transmitir notas.',
    time: '5 min',
    icon: ShieldCheck,
    actionLabel: 'Abrir configurações',
    actionHref: '/configuracoes',
    chapters: [
      {
        title: 'Abra as configurações da empresa',
        path: 'Menu > Minha Empresa > Configurações da Empresa',
        text: 'A área de empresa concentra dados fiscais, ambiente, série DPS e certificado digital.',
        mockup: 'configuracoes',
      },
      {
        title: 'Envie o arquivo e informe a senha',
        path: 'Configurações da Empresa > Certificado A1',
        text: 'Use o arquivo A1 correto, informe a senha e aguarde a validação antes de emitir em produção.',
        mockup: 'certificado',
      },
      {
        title: 'Monitore vencimento',
        path: 'Dashboard > Central de notificações',
        text: 'Quando estiver perto do vencimento, o aviso aparece na Central de notificações para antecipar renovação.',
        mockup: 'notificacoes',
      },
    ],
  },
  {
    id: 'book-rascunhos',
    title: 'Rascunhos e DPS duplicado',
    subtitle: 'Como recuperar uma emissão que falhou por ajuste simples.',
    time: '5 min',
    icon: Clock,
    actionLabel: 'Abrir emissão',
    actionHref: '/emitir',
    chapters: [
      {
        title: 'Identifique o rascunho',
        path: 'Emitir nova nota > Rascunhos',
        text: 'O rascunho aparece quando uma nota falha por erro corrigível, como DPS duplicado.',
        mockup: 'rascunhos',
      },
      {
        title: 'Retome na revisão',
        path: 'Rascunhos > Retomar na revisão',
        text: 'A retomada abre a nota na etapa final, mas você ainda pode voltar para alterar etapas anteriores.',
        mockup: 'emitir',
      },
      {
        title: 'Corrija apenas o necessário',
        path: 'Revisão > Número DPS',
        text: 'Troque o número DPS somente quando o retorno fiscal indicar duplicidade. Instabilidade não exige troca.',
        mockup: 'rascunhos',
      },
    ],
  },
  {
    id: 'book-notas',
    title: 'Minhas Notas, PDF, XML e cancelamento',
    subtitle: 'Como consultar, baixar arquivos e cancelar com segurança.',
    time: '7 min',
    icon: FileDown,
    actionLabel: 'Ver minhas notas',
    actionHref: '/cliente/notas',
    chapters: [
      {
        title: 'Abra a lista de notas',
        path: 'Dashboard > Minhas Notas > Ver todas as notas',
        text: 'Use a lista para encontrar notas autorizadas, canceladas e arquivos fiscais.',
        mockup: 'notas',
      },
      {
        title: 'Use o menu de ações',
        path: 'Minhas Notas > Três pontos',
        text: 'Visualize PDF, baixe XML, baixe PDF ou inicie cancelamento quando permitido.',
        mockup: 'notas',
      },
      {
        title: 'Cancele com justificativa',
        path: 'Minhas Notas > Cancelar Nota',
        text: 'Informe motivo e justificativa. Depois do evento, o SaaS atualiza PDF cancelado e XML com evento.',
        mockup: 'cancelar',
      },
    ],
  },
  {
    id: 'book-suporte',
    title: 'Abrir chamado para o suporte',
    subtitle: 'Como enviar um ticket com contexto suficiente para resolver rápido.',
    time: '4 min',
    icon: Ticket,
    actionLabel: 'Abrir suporte',
    actionHref: '/cliente/suporte',
    chapters: [
      {
        title: 'Escolha o canal correto',
        path: 'Menu > Suporte',
        text: 'Use suporte quando o guia não resolver ou quando precisar de ação interna da equipe.',
        mockup: 'suporte',
      },
      {
        title: 'Inclua dados úteis',
        path: 'Suporte > Abrir Ticket',
        text: 'Informe CNPJ, ID da venda, número da nota, print e a mensagem exibida pelo SaaS.',
        mockup: 'suporte',
      },
      {
        title: 'Acompanhe a resposta',
        path: 'Suporte > Meus chamados',
        text: 'As respostas ficam no histórico do chamado, mantendo a conversa e a solução registradas.',
        mockup: 'suporte',
      },
    ],
  },
  {
    id: 'book-conta-contador',
    title: 'Conta, senha e acesso do contador',
    subtitle: 'Como cuidar do acesso e operar empresas vinculadas.',
    time: '6 min',
    icon: Users,
    actionLabel: 'Abrir minha conta',
    actionHref: '/configuracoes/minha-conta',
    chapters: [
      {
        title: 'Atualize dados e senha',
        path: 'Menu > Editar Dados Pessoais',
        text: 'Minha Conta concentra dados pessoais, assinatura, alteração de senha, e-mail e preferências.',
        mockup: 'conta',
      },
      {
        title: 'Troque de empresa quando for contador',
        path: 'Menu > Minha Empresa > Alternar CNPJ',
        text: 'Contadores com empresas vinculadas escolhem o CNPJ ativo antes de emitir, cancelar ou consultar notas.',
        mockup: 'contador',
      },
      {
        title: 'Peça ajuda para vínculos',
        path: 'Menu > Suporte',
        text: 'Quando houver dúvida de vínculo, acesso cedido ou revogação, registre um chamado para operação interna.',
        mockup: 'suporte',
      },
    ],
  },
];

export default function CentralAjudaPage() {
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('Todos');
  const [aberto, setAberto] = useState(artigos[0].id);
  const [modo, setModo] = useState<'artigos' | 'guias'>('artigos');
  const [guiaSelecionado, setGuiaSelecionado] = useState(guiasVisuais[0].id);

  const artigosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return artigos.filter((artigo) => {
      const matchCategoria = categoria === 'Todos' || artigo.category === categoria;
      const texto = `${artigo.title} ${artigo.summary} ${artigo.path} ${artigo.category} ${artigo.tags.join(' ')}`.toLowerCase();
      const matchBusca = !termo || texto.includes(termo);
      return matchCategoria && matchBusca;
    });
  }, [busca, categoria]);

  const destaque = artigos.slice(0, 4);
  const guiaAtual = guiasVisuais.find((guia) => guia.id === guiaSelecionado) || guiasVisuais[0];

  return (
    <div className="saas-shell">
      <AppHeader
        title="Central de Ajuda"
        subtitle="Guias rápidos com o caminho exato de cada função do SaaS."
        eyebrow="Suporte"
        backHref="/cliente/dashboard"
      />

      <main className="saas-container space-y-8">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="rounded-2xl border border-blue-100 bg-blue-600 p-7 text-white shadow-sm">
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-100">NFSe Goo</p>
                <h2 className="mt-3 max-w-2xl text-3xl font-black leading-tight">Manual prático para operar emissão, clientes, notas, conta e suporte.</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-blue-50">
                  Use artigos rápidos para tirar dúvidas pontuais e guias visuais para seguir fluxos completos dentro do SaaS.
                </p>
              </div>
              <BadgeHelp className="hidden h-16 w-16 text-blue-100 md:block" />
            </div>

            <div className="relative mt-7">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-300" size={19} />
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar por DPS, certificado, CPF, contador, PDF, suporte..."
                className="w-full rounded-2xl border border-white/20 bg-white py-4 pl-12 pr-4 text-sm font-semibold text-slate-800 outline-none ring-0 placeholder:text-slate-400 focus:border-white focus:ring-4 focus:ring-white/20"
              />
            </div>

            <div className="mt-4 inline-flex rounded-2xl bg-blue-700/60 p-1 text-sm font-black">
              <button
                onClick={() => setModo('artigos')}
                className={`rounded-xl px-4 py-2 transition ${modo === 'artigos' ? 'bg-white text-blue-700' : 'text-blue-50 hover:bg-white/10'}`}
              >
                Artigos rápidos
              </button>
              <button
                onClick={() => setModo('guias')}
                className={`rounded-xl px-4 py-2 transition ${modo === 'guias' ? 'bg-white text-blue-700' : 'text-blue-50 hover:bg-white/10'}`}
              >
                Guias visuais
              </button>
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-black text-slate-900">Não encontrou?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Abra um chamado com CNPJ, ID da venda, número da nota e print da tela. Isso reduz o vai e volta do atendimento.
            </p>
            <div className="mt-5 grid gap-3">
              <Link href="/cliente/suporte/novo" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700">
                Abrir chamado <ArrowRight size={17} />
              </Link>
              <Link href="/cliente/suporte" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                Ver meus chamados
              </Link>
            </div>
          </aside>
        </section>

        {modo === 'artigos' ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {destaque.map((artigo) => {
                const Icon = artigo.icon;
                return (
                  <button
                    key={artigo.id}
                    onClick={() => {
                      setCategoria('Todos');
                      setAberto(artigo.id);
                      setBusca('');
                    }}
                    className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Icon size={21} />
                    </span>
                    <h3 className="mt-4 text-sm font-black text-slate-900">{artigo.title}</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{artigo.summary}</p>
                    <p className="mt-3 text-[11px] font-black uppercase tracking-[0.12em] text-blue-600">{artigo.path}</p>
                  </button>
                );
              })}
            </section>

            <section className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-28">
                <p className="px-2 pb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Categorias</p>
                <div className="space-y-1">
                  {categorias.map((item) => (
                    <button
                      key={item}
                      onClick={() => setCategoria(item)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${
                        categoria === item
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </aside>

              <div className="space-y-3">
                {artigosFiltrados.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                    <Search className="mx-auto text-slate-300" size={32} />
                    <h3 className="mt-4 text-lg font-black text-slate-800">Nada encontrado</h3>
                    <p className="mt-2 text-sm text-slate-500">Tente outro termo ou abra um chamado com o suporte.</p>
                  </div>
                ) : (
                  artigosFiltrados.map((artigo) => (
                    <AjudaArticle
                      key={artigo.id}
                      artigo={artigo}
                      aberto={aberto === artigo.id}
                      onToggle={() => setAberto(aberto === artigo.id ? '' : artigo.id)}
                    />
                  ))
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-28">
              <p className="px-2 pb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Guias visuais</p>
              <div className="space-y-2">
                {guiasVisuais.map((guia) => {
                  const Icon = guia.icon;
                  const ativo = guia.id === guiaSelecionado;
                  return (
                    <button
                      key={guia.id}
                      onClick={() => setGuiaSelecionado(guia.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        ativo ? 'border-blue-200 bg-blue-50 shadow-sm' : 'border-slate-200 hover:border-blue-100 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-start gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${ativo ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          <Icon size={18} />
                        </span>
                        <span>
                          <span className="text-sm font-black text-slate-900">{guia.title}</span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">{guia.subtitle}</span>
                          <span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-700 ring-1 ring-blue-100">
                            {guia.time}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <VisualGuideBook guide={guiaAtual} />
          </section>
        )}
      </main>
    </div>
  );
}

function AjudaArticle({ artigo, aberto, onToggle }: { artigo: HelpArticle; aberto: boolean; onToggle: () => void }) {
  const Icon = artigo.icon;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-slate-50">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Icon size={20} />
          </span>
          <span className="min-w-0">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">{artigo.category}</span>
            <h3 className="mt-1 text-base font-black text-slate-900">{artigo.title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">{artigo.summary}</p>
            <span className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600">
              Onde encontrar: {artigo.path}
            </span>
          </span>
        </div>
        <ChevronDown className={`shrink-0 text-slate-400 transition ${aberto ? 'rotate-180' : ''}`} size={20} />
      </button>

      {aberto && (
        <div className="border-t border-slate-100 bg-slate-50/60 p-5">
          <ol className="space-y-3">
            {artigo.steps.map((step, index) => (
              <li key={step} className="flex gap-3 rounded-xl bg-white p-3 text-sm leading-6 text-slate-600 ring-1 ring-slate-100">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {artigo.warning && (
            <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              {artigo.warning}
            </div>
          )}

          {artigo.related && artigo.related.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {artigo.related.map((link) => (
                <Link key={link.href} href={link.href} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-50">
                  {link.label}
                  <ArrowRight size={14} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function VisualGuideBook({ guide }: { guide: VisualGuide }) {
  const Icon = guide.icon;

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 bg-slate-50 p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
              <Icon size={25} />
            </span>
            <div>
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600">
                <BookOpen size={15} /> Guia visual
              </p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">{guide.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{guide.subtitle}</p>
            </div>
          </div>
          <Link href={guide.actionHref} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700">
            {guide.actionLabel}
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>

      <div className="space-y-0">
        {guide.chapters.map((chapter, index) => (
          <section key={chapter.title} className="grid gap-6 border-b border-slate-100 p-6 last:border-b-0 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">{index + 1}</span>
              <h3 className="mt-4 text-lg font-black text-slate-900">{chapter.title}</h3>
              <p className="mt-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600">Caminho: {chapter.path}</p>
              <p className="mt-3 text-sm leading-7 text-slate-500">{chapter.text}</p>
            </div>
            <GuideMockup type={chapter.mockup} />
          </section>
        ))}
      </div>
    </article>
  );
}

function GuideMockup({ type }: { type: MockupType }) {
  if (type === 'dashboard') return <DashboardMockup />;
  if (type === 'notificacoes') return <NotificacoesMockup />;
  if (type === 'configuracoes') return <ConfiguracoesMockup />;
  if (type === 'certificado') return <CertificadoMockup />;
  if (type === 'clientes') return <ClientesMockup />;
  if (type === 'emitir') return <EmitirMockup />;
  if (type === 'rascunhos') return <RascunhosMockup />;
  if (type === 'cancelar') return <CancelarMockup />;
  if (type === 'suporte') return <SuporteMockup />;
  if (type === 'conta') return <ContaMockup />;
  if (type === 'contador') return <ContadorMockup />;
  return <NotasMockup />;
}

function MockFrame({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Exemplo visual</p>
          <h4 className="text-sm font-black text-slate-800">{title}</h4>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">Sem dados reais</span>
      </div>
      <div className="bg-slate-100 p-4">{children}</div>
    </div>
  );
}

function DashboardMockup() {
  return (
    <MockFrame title="Dashboard operacional">
      <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
        <div className="rounded-2xl bg-blue-600 p-5 text-white">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100">Próxima ação</p>
          <h5 className="mt-2 text-xl font-black">Você já pode emitir</h5>
          <p className="mt-2 text-xs text-blue-50">Cadastro, IBGE e certificado estão prontos.</p>
          <span className="mt-5 inline-flex rounded-xl bg-white px-4 py-2 text-xs font-black text-blue-700">Emitir nova nota</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h5 className="text-sm font-black text-slate-900">Prontidão para emissão</h5>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {['Cadastro', 'Certificado A1', 'Código IBGE', 'Ambiente'].map((item) => (
              <div key={item} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                <CheckCircle2 size={14} className="mb-1" /> {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function NotificacoesMockup() {
  return (
    <MockFrame title="Central de notificações">
      <div className="max-w-sm rounded-2xl bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-blue-600">
              <Bell size={13} /> Avisos
            </p>
            <h5 className="mt-1 text-sm font-black text-slate-900">Central de notificações</h5>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">1</span>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <CalendarClock size={18} />
          <p className="mt-2 text-xs font-black">Certificado perto do vencimento</p>
          <p className="mt-1 text-[11px] leading-5">Antecipe a renovação para evitar bloqueios.</p>
        </div>
      </div>
    </MockFrame>
  );
}

function ConfiguracoesMockup() {
  return (
    <MockFrame title="Configurações da empresa">
      <div className="rounded-2xl bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {['Dados fiscais', 'Código IBGE', 'Inscrição Municipal', 'Ambiente'].map((item, index) => (
            <div key={item} className={`rounded-xl border p-4 ${index === 3 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <p className="text-xs font-black text-slate-800">{item}</p>
              <p className="mt-1 text-[11px] text-slate-500">{index === 3 ? 'Produção ou homologação' : 'Obrigatório para emissão'}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 h-10 rounded-xl bg-blue-600" />
      </div>
    </MockFrame>
  );
}

function CertificadoMockup() {
  return (
    <MockFrame title="Upload do certificado A1">
      <div className="rounded-2xl bg-white p-5">
        <div className="rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 p-6 text-center">
          <UploadCloud className="mx-auto text-blue-600" size={34} />
          <h5 className="mt-3 text-sm font-black text-slate-900">Enviar certificado A1</h5>
          <p className="mt-1 text-xs text-slate-500">Arquivo .pfx ou .p12 protegido por senha.</p>
          <div className="mx-auto mt-4 h-10 max-w-sm rounded-xl border border-slate-200 bg-white" />
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
          <span>Certificado validado</span>
          <CheckCircle2 size={16} />
        </div>
      </div>
    </MockFrame>
  );
}

function ClientesMockup() {
  return (
    <MockFrame title="Cadastro de tomadores">
      <div className="rounded-2xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h5 className="text-sm font-black text-slate-900">Clientes</h5>
          <span className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">Novo cliente</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {['PJ', 'PF', 'Exterior'].map((item) => (
            <div key={item} className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center text-sm font-black text-blue-700">{item}</div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-black text-slate-700">PF sem endereço</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <span className="h-4 w-4 rounded border border-blue-300 bg-white" /> Emitir sem informar endereço
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function EmitirMockup() {
  return (
    <MockFrame title="Fluxo de emissão em 3 etapas">
      <div className="rounded-2xl bg-white p-5">
        <div className="mb-5 grid grid-cols-3 gap-3 text-center text-xs font-black">
          {['Tomador', 'Serviço', 'Revisão'].map((item, index) => (
            <div key={item} className={`rounded-xl p-3 ${index === 0 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{item}</div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-black text-slate-900">Quem é o cliente?</p>
          <div className="mt-3 h-11 rounded-xl border border-blue-200 bg-slate-50" />
          <div className="mt-4 flex justify-end">
            <span className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white">Próximo</span>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function RascunhosMockup() {
  return (
    <MockFrame title="Rascunhos de emissão">
      <div className="grid gap-4 md:grid-cols-[230px_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-600">Rascunhos</p>
          <h5 className="mt-1 text-sm font-black text-slate-900">Notas pendentes</h5>
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <p className="truncate text-xs font-black text-slate-900">Cliente exemplo</p>
            <p className="mt-1 text-[11px] text-slate-500">DPS já utilizado...</p>
            <span className="mt-3 block rounded-lg bg-blue-600 px-3 py-2 text-center text-[11px] font-black text-white">Retomar na revisão</span>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-5">
          <p className="text-sm font-black text-slate-900">Revisão e fechamento</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="h-11 rounded-xl border border-slate-200 bg-slate-50" />
            <div className="h-11 rounded-xl border border-blue-200 bg-blue-50" />
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function NotasMockup() {
  return (
    <MockFrame title="Lista de notas e arquivos">
      <div className="rounded-2xl bg-white p-4">
        <div className="grid grid-cols-[1fr_90px_90px] gap-3 border-b border-slate-100 pb-3 text-xs font-black uppercase text-slate-400">
          <span>Tomador</span><span>Status</span><span>Ações</span>
        </div>
        {['Cliente exemplo LTDA', 'Pessoa física exemplo'].map((nome, index) => (
          <div key={nome} className="grid grid-cols-[1fr_90px_90px] items-center gap-3 border-b border-slate-100 py-3 last:border-b-0">
            <span className="text-sm font-bold text-slate-800">{nome}</span>
            <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-black ${index === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {index === 0 ? 'AUTORIZADA' : 'CANCELADA'}
            </span>
            <span className="rounded-xl bg-blue-50 px-3 py-2 text-center text-xs font-black text-blue-700">PDF/XML</span>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

function CancelarMockup() {
  return (
    <MockFrame title="Modal de cancelamento">
      <div className="mx-auto max-w-md rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 border-b border-red-100 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <XCircle size={20} />
          </span>
          <h5 className="text-sm font-black text-red-700">Cancelar Nota</h5>
        </div>
        <div className="mt-4 space-y-3">
          <div className="h-11 rounded-xl border border-slate-200 bg-slate-50" />
          <div className="h-24 rounded-xl border border-slate-200 bg-slate-50" />
          <div className="h-11 rounded-xl bg-red-600" />
        </div>
      </div>
    </MockFrame>
  );
}

function SuporteMockup() {
  return (
    <MockFrame title="Central de suporte">
      <div className="rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-600">Suporte</p>
            <h5 className="text-sm font-black text-slate-900">Meus chamados</h5>
          </div>
          <span className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">Abrir Ticket</span>
        </div>
        <div className="mt-4 space-y-2">
          {['Falha ao baixar PDF', 'Vínculo de contador'].map((item) => (
            <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-black text-slate-800">{item}</p>
              <p className="mt-1 text-[11px] text-slate-500">Aguardando análise</p>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}

function ContaMockup() {
  return (
    <MockFrame title="Minha conta">
      <div className="grid gap-4 md:grid-cols-[230px_1fr]">
        <div className="rounded-2xl bg-white p-5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-black text-white">U</div>
          <h5 className="mt-4 text-center text-sm font-black text-slate-900">Usuário</h5>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Assinatura e limites</div>
        </div>
        <div className="rounded-2xl bg-white p-5">
          <p className="text-sm font-black text-slate-900">Dados pessoais</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="h-11 rounded-xl border border-slate-200 bg-slate-50" />
            <div className="h-11 rounded-xl border border-slate-200 bg-slate-50" />
            <div className="h-11 rounded-xl border border-blue-200 bg-blue-50" />
            <div className="h-11 rounded-xl border border-blue-200 bg-blue-50" />
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function ContadorMockup() {
  return (
    <MockFrame title="Alternar empresa do contador">
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-5">
        <p className="flex items-center gap-2 text-xs font-black uppercase text-slate-400">
          <Building2 size={14} /> Minha Empresa
        </p>
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-bold text-blue-700">Alternar CNPJ</p>
          <div className="mt-2 rounded-xl bg-white p-3 text-sm font-black text-slate-800">Empresa atual LTDA</div>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 p-3 text-xs text-slate-500">
          Confira o CNPJ antes de emitir, cancelar ou consultar notas.
        </div>
      </div>
    </MockFrame>
  );
}

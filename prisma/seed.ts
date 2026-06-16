import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Semeando banco de dados...')

  const planos = [
    // === 1. PLANOS DE SISTEMA (OCULTOS/TRIAL) ===
    {
      name: 'Período de Teste',
      slug: 'TRIAL',
      description: '7 dias grátis para novos usuários',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Emissão de Notas', 'Cadastro de Clientes', 'Suporte Básico']),
      maxNotasMensal: 5,
      maxClientes: 5,
      diasTeste: 7,
      active: true,
      recommended: false,
      privado: false 
    },
    {
      name: 'Parceiro Contábil',
      slug: 'PARCEIRO',
      description: 'Acesso irrestrito para gestão de carteira',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Painel do Contador', 'Múltiplas Empresas', 'Suporte Prioritário']),
      maxNotasMensal: 999999,
      maxClientes: 999999,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: true // Não aparece na lista de compras
    },

    {
      name: 'Contador Starter',
      slug: 'CONTADOR_STARTER',
      description: 'Plano privado inicial para contadores parceiros.',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Painel do contador', 'Carteira de clientes', 'Empresas vinculadas', 'Suporte administrativo']),
      maxNotasMensal: 60,
      maxClientes: 25,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: true,
      tipo: 'PLANO'
    },
    {
      name: 'Contador Pro',
      slug: 'CONTADOR_PRO',
      description: 'Plano privado para carteiras contabeis em crescimento.',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Mais notas mensais', 'Mais clientes na carteira', 'Suporte administrativo']),
      maxNotasMensal: 200,
      maxClientes: 120,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: true,
      tipo: 'PLANO'
    },
    {
      name: 'Contador Scale',
      slug: 'CONTADOR_SCALE',
      description: 'Plano privado para operacoes contabeis de alto volume.',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Alto volume de notas', 'Carteira ampliada', 'Suporte administrativo']),
      maxNotasMensal: 600,
      maxClientes: 300,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: true,
      tipo: 'PLANO'
    },

    // === 2. NOVOS PLANOS COMERCIAIS ===
    
    // BASIC
    {
      name: 'Plano Basic',
      slug: 'BASIC',
      description: 'Ideal para profissionais autônomos começando agora.',
      priceMonthly: 19.90,
      priceYearly: 0, // Como os pacotes anuais têm limites e slugs diferentes, o yearly fica zero aqui
      features: JSON.stringify(['Até 5 Emissões/mês', 'Até 5 Clientes', 'Suporte via Ticket']),
      maxNotasMensal: 5,
      maxClientes: 5,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: false
    },
    {
      name: 'Plano Basic+',
      slug: 'BASIC_PLUS',
      description: 'Ideal para profissionais autônomos (Plano Anual).',
      priceMonthly: 0,
      priceYearly: 238.80,
      features: JSON.stringify(['Até 7 Emissões/mês', 'Até 15 Clientes', 'Suporte via Ticket', 'Economia Anual']),
      maxNotasMensal: 7, 
      maxClientes: 15, 
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: false
    },

    // STANDARD
    {
      name: 'Plano Standard',
      slug: 'STANDARD',
      description: 'Para pequenas empresas em crescimento.',
      priceMonthly: 44.90,
      priceYearly: 0,
      features: JSON.stringify(['Até 10 Emissões/mês', 'Até 10 Clientes', 'Suporte Prioritário']),
      maxNotasMensal: 10,
      maxClientes: 10,
      diasTeste: 0,
      active: true,
      recommended: true, // Marcado como recomendado!
      privado: false
    },
    {
      name: 'Plano Standard+',
      slug: 'STANDARD_PLUS',
      description: 'Para pequenas empresas em crescimento (Plano Anual).',
      priceMonthly: 0,
      priceYearly: 538.80,
      features: JSON.stringify(['Até 15 Emissões/mês', 'Até 20 Clientes', 'Suporte Prioritário', 'Economia Anual']),
      maxNotasMensal: 15,
      maxClientes: 20,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: false
    },

    // PREMIUM
    {
      name: 'Plano Premium',
      slug: 'PREMIUM',
      description: 'Para empresas com volume consistente de notas.',
      priceMonthly: 89.90,
      priceYearly: 0,
      features: JSON.stringify(['Até 30 Emissões/mês', 'Até 50 Clientes', 'Suporte VIP 24/7']),
      maxNotasMensal: 30,
      maxClientes: 50,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: false
    },
    {
      name: 'Plano Premium+',
      slug: 'PREMIUM_PLUS',
      description: 'Para empresas com volume consistente de notas (Plano Anual).',
      priceMonthly: 0,
      priceYearly: 1078.80,
      features: JSON.stringify(['Até 100 Emissões/mês', 'Até 100 Clientes', 'Suporte VIP 24/7']),
      maxNotasMensal: 100,
      maxClientes: 100,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: false
    },
    // PACOTES AVULSOS
    {
      name: 'Pacote +5 Clientes', slug: 'PACOTE_CLIENTE_5',
      description: 'Adicione mais 5 clientes ao seu limite.',
      priceMonthly: 5.90, priceYearly: 0,
      features: JSON.stringify(['+5 Clientes na Carteira', 'Não Expira', 'Pagamento Único']),
      maxNotasMensal: 0, maxClientes: 5, diasTeste: 0,
      active: true, recommended: false, privado: false,
      tipo: 'PACOTE_CLIENTES' // <-- Define que é um pacote
    },
    {
      name: 'Pacote +3 Notas', slug: 'PACOTE_NOTA_3',
      description: 'Saldo extra de 3 notas avulsas.',
      priceMonthly: 5.90, priceYearly: 0,
      features: JSON.stringify(['+3 Notas Fiscais', 'Saldo Acumulativo', 'Não Expira']),
      maxNotasMensal: 3, maxClientes: 0, diasTeste: 0,
      active: true, recommended: false, privado: false,
      tipo: 'PACOTE_NOTAS' // <-- Define que é um pacote
    },
    // <--- NOVO PACOTE: PJ ADICIONAL --->
    {
      name: 'Pacote PJ Adicional', slug: 'PACOTE_PJ_1',
      description: 'Vincule mais um CNPJ à sua conta usando o mesmo saldo.',
      priceMonthly: 50.00, priceYearly: 0,
      features: JSON.stringify(['+1 Empresa Vinculada', 'Saldo de Notas Compartilhado', 'Acesso Centralizado']),
      maxNotasMensal: 0, maxClientes: 0, diasTeste: 0,
      active: true, recommended: false, privado: false,
      tipo: 'PACOTE_PJ' // <-- Define o tipo como Pacote de Empresa
    }
  ];

  for (const p of planos) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    });
    console.log(`✅ Plano verificado/criado: ${p.name}`);
  }

  console.log('🎉 Seed finalizado com sucesso!');
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

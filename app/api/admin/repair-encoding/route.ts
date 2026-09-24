import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { authorizeMaintenance } from '@/app/utils/maintenance-security';
import { createLog } from '@/app/services/logger';

export const POST = withApiGuard(async function POST(request: Request) {
  try {
    const { actor, body, error } = await authorizeMaintenance(request, 'REPAIR_CNAE_DESCRIPTIONS', 'ATUALIZAR DESCRICOES CNAE');
    if (error) return error;
    if (!actor || !body) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
    
    const empresas = await prisma.empresa.findMany();
    const logs = [];
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

    for (const emp of empresas) {
        // Rechama a API corrigida para cada empresa
        const res = await fetch(`${baseUrl}/api/external/cnpj`, {
            method: 'POST',
            body: JSON.stringify({ cnpj: emp.documento }),
            headers: { 'Content-Type': 'application/json', cookie: request.headers.get('cookie') || '', origin: baseUrl },
            signal: AbortSignal.timeout(15_000),
        });

        if (res.ok) {
            const dados = await res.json();
            
            // Atualiza apenas descricoes existentes. Nao apaga regras fiscais,
            // aliquotas, referencias ou atividades cadastradas pelo cliente.
            for (const c of Array.isArray(dados.cnaes) ? dados.cnaes : []) {
                const cod = c.codigo.replace(/\D/g, '');
                if (!/^\d{7}$/.test(cod) || typeof c.descricao !== 'string') continue;
                const atividades = await prisma.cnae.findMany({ where: { empresaId: emp.id }, select: { id: true, codigo: true } });
                const ids = atividades.filter((item) => item.codigo.replace(/\D/g, '') === cod).map((item) => item.id);
                await prisma.$transaction(async (tx) => {
                    if (ids.length) await tx.cnae.updateMany({ where: { id: { in: ids } }, data: { descricao: c.descricao.slice(0, 1000) } });
                    await tx.globalCnae.upsert({
                        where: { codigo: cod },
                        update: { descricao: c.descricao.slice(0, 1000) },
                        create: { codigo: cod, descricao: c.descricao.slice(0, 1000) }
                    });
                });
            }
            logs.push(`✅ ${emp.razaoSocial}: Corrigido.`);
        } else {
            logs.push(`❌ ${emp.razaoSocial}: Falha na consulta.`);
        }
    }

    await createLog({
        level: 'ALERTA', action: 'CNAE_DESCRIPTIONS_MAINTENANCE', module: 'SEGURANCA', userId: actor.id,
        message: 'Descricoes de CNAEs atualizadas sem exclusao de regras fiscais.',
        details: { empresas: empresas.length, justification: body.justification },
    });

    return NextResponse.json({ message: "Reparo concluído", logs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

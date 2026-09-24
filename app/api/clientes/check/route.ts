import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from "next/server";
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { normalizeCustomerDocument } from '@/app/utils/customer-document';
import { effectiveFiscalEntity, loadCanonicalFiscalEntity, mergeTenantCustomer, tenantCustomerFiscalInclude } from '@/app/services/fiscalEntityService';

export const POST = withApiGuard(async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  const empresaId = await resolveEmpresaContexto(user, request.headers.get('x-empresa-id'));
  if (!empresaId) return NextResponse.json({ error: 'Empresa nao autorizada.' }, { status: 403 });

  try {
    const sizeError = validateJsonContentLength(request, 16 * 1024);
    if (sizeError) return sizeError;
    const body = await request.json();
    const { documento: docLimpo, tipo } = normalizeCustomerDocument(body.tipo, body.documento);

    // Se estiver vazio, não busca (retorna null imediatamente permitindo o cadastro)
    if (!docLimpo || docLimpo === '') return NextResponse.json(null); 

    const clienteGlobal = await prisma.cliente.findFirst({
      where: { empresaId, documento: docLimpo, arquivadoEm: null, vinculos: { some: { empresaId, arquivadoEm: null } } },
      orderBy: { updatedAt: 'desc' }, include: { entidadeFiscal: { include: tenantCustomerFiscalInclude } },
    });

    if (clienteGlobal) {
        // Removemos o 'id' e datas para evitar que o frontend tente fazer um PUT indevido.
        // Assim, o frontend entende os dados como "novos" para esta empresa, 
        // preenche o formulário automaticamente, e a rota de salvar (POST) 
        // cuidará de atualizar o global e criar o vínculo corretamente.
        const { id, createdAt, updatedAt, identidadeFiscal, ...dadosParaPreencher } = mergeTenantCustomer(clienteGlobal) as any;
        return NextResponse.json(dadosParaPreencher);
    }

    // A different issuer's private relationship is never read. Only the
    // globally public PJ identity may prefill another issuer's new form.
    if (tipo === 'PJ') {
      const entity = await loadCanonicalFiscalEntity(docLimpo);
      if (entity) {
        const effective = effectiveFiscalEntity(entity);
        return NextResponse.json({ tipo: 'PJ', documento: entity.documento, nome: effective.razaoSocial,
          nomeFantasia: effective.nomeFantasia, cep: effective.cep, logradouro: effective.logradouro,
          numero: effective.numero, complemento: effective.complemento, bairro: effective.bairro,
          cidade: effective.cidade, uf: effective.uf, pais: effective.pais, codigoIbge: effective.codigoIbge,
          email: '', telefone: '', inscricaoMunicipal: '', inscricaoEstadual: '' });
      }
    }

    return NextResponse.json(null); // Retorna null se o CPF/CNPJ for inédito no SaaS
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Documento invalido.' }, { status: error?.status || 400 });
  }
}, { maxBodyBytes: 16 * 1024 });

import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import zlib from 'zlib';
import { checkPlanLimits } from '@/app/services/planService';
import { validateRequest } from '@/app/utils/api-security';
import { getAccessibleEmpresaIds } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

function decodeBase64Xml(base64: string) {
  const buffer = Buffer.from(base64, 'base64');
  return buffer[0] === 0x1f && buffer[1] === 0x8b
    ? zlib.gunzipSync(buffer).toString('utf-8')
    : buffer.toString('utf-8');
}

export async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  const userId = targetId;
  if (!userId || !user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });

  const planCheck = await checkPlanLimits(userId, 'VISUALIZAR');
  if (!planCheck.allowed) {
    return NextResponse.json({ error: `Acesso bloqueado: ${planCheck.reason}` }, { status: 403 });
  }

  try {
    const { ids, formato } = await request.json();

    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: 'Nenhuma nota selecionada.' }, { status: 400 });
    }

    const accessibleEmpresaIds = await getAccessibleEmpresaIds(user);
    const whereClause: any = { id: { in: ids }, arquivadoEm: null };

    if (accessibleEmpresaIds !== null) {
      whereClause.empresaId = { in: accessibleEmpresaIds.length > 0 ? accessibleEmpresaIds : ['__sem_acesso__'] };
    }

    const notas = await prisma.notaFiscal.findMany({
      where: whereClause,
      include: { cliente: true },
    });

    if (notas.length !== ids.length) {
      return NextResponse.json({ error: 'Uma ou mais notas nÃ£o podem ser exportadas.' }, { status: 403 });
    }

    const zip = new JSZip();
    const folderName = `Notas_Exportacao_${new Date().toISOString().split('T')[0]}`;
    const folder = zip.folder(folderName);

    if (!folder) throw new Error('Erro ao criar pasta no zip');

    for (const nota of notas) {
      const safeName = nota.numero ? `NFSe_${nota.numero}` : `NFSe_ID_${nota.id.substring(0, 6)}`;

      if ((formato === 'XML' || formato === 'AMBOS') && nota.xmlBase64) {
        try {
          const notaComXmlCancelamento = nota as any;
          const xmlPrincipalBase64 =
            nota.status === 'CANCELADA'
              ? notaComXmlCancelamento.xmlAutorizadoBase64 || nota.xmlBase64
              : nota.xmlBase64;
          const xmlContent = decodeBase64Xml(xmlPrincipalBase64);
          folder.file(`${safeName}.xml`, xmlContent);

          if (nota.status === 'CANCELADA' && notaComXmlCancelamento.xmlCancelamentoEventoBase64) {
            const xmlEvento = decodeBase64Xml(notaComXmlCancelamento.xmlCancelamentoEventoBase64);
            folder.file(`${safeName}_evento_cancelamento.xml`, xmlEvento);
          }
        } catch (e) {
          console.error(`Erro XML nota ${nota.numero}`, e);
        }
      }

      if ((formato === 'PDF' || formato === 'AMBOS') && nota.pdfBase64) {
        try {
          const buffer = Buffer.from(nota.pdfBase64, 'base64');
          const pdfContent = buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer;
          folder.file(`${safeName}.pdf`, pdfContent);
        } catch (e) {
          console.error(`Erro PDF nota ${nota.numero}`, e);
        }
      }
    }

    const zipContent = await zip.generateAsync({ type: 'base64' });

    return NextResponse.json({
      success: true,
      fileBase64: zipContent,
      fileName: `${folderName}.zip`,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: `Erro ao gerar arquivo: ${e.message}` }, { status: 500 });
  }
}

import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

function extractTag(xml: string, tag: string) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return match ? match[1] : null;
}

function extractFullTag(xml: string, tag: string) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`));
    return match ? match[0] : null;
}

export const POST = withApiGuard(async function POST(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    if (!isSupportRole(user.role)) return forbidden();

    try {
        const { vendaId } = await request.json();

        const venda = await prisma.venda.findUnique({
            where: { id: vendaId },
            include: { logs: { orderBy: { createdAt: 'desc' }, take: 10 } }
        });

        if (!venda) return NextResponse.json({ error: "Venda nÃ£o encontrada" });

        let xml = '';
        const logComXml = venda.logs.find(l => 
            l.details && typeof l.details === 'string' && l.details.includes('<DPS')
        );

        if (logComXml && logComXml.details) {
            const details = logComXml.details;

            if (details.startsWith('{')) {
                try {
                    const json = JSON.parse(details);
                    xml = json.xmlGerado || json.xml || '';
                } catch (e) { 
                    if (details.includes('<DPS')) xml = details; 
                }
            } else {
                xml = details;
            }
        }

        if (!xml) return NextResponse.json({ error: "XML nÃ£o encontrado." });

        const signatureValueBase64 = extractTag(xml, 'SignatureValue');
        const x509Certificate = extractTag(xml, 'X509Certificate');
        const signedInfoBlock = extractFullTag(xml, 'SignedInfo');
        const infDpsBlock = extractFullTag(xml, 'infDPS');

        if (!signatureValueBase64 || !x509Certificate || !signedInfoBlock) {
            return NextResponse.json({ error: "Dados incompletos." });
        }

        const certPem = `-----BEGIN CERTIFICATE-----\n${x509Certificate}\n-----END CERTIFICATE-----`;
        const signatureBuffer = Buffer.from(signatureValueBase64, 'base64');

        let signedInfoToVerify = signedInfoBlock;
        if (!signedInfoToVerify.includes('xmlns="http://www.w3.org/2000/09/xmldsig#"')) {
            signedInfoToVerify = signedInfoToVerify.replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
        }

        const verify = crypto.createVerify('RSA-SHA1');
        verify.update(signedInfoToVerify);
        
        const isValid = verify.verify(certPem, signatureBuffer);

        let hashCalculado = '';
        if (infDpsBlock) {
            let nodeToHash = infDpsBlock;
            if (!nodeToHash.includes('xmlns="http://www.sped.fazenda.gov.br/nfse"')) {
                nodeToHash = nodeToHash.replace('<infDPS', '<infDPS xmlns="http://www.sped.fazenda.gov.br/nfse"');
            }
            const shasum = crypto.createHash('sha1');
            shasum.update(nodeToHash, 'utf8');
            hashCalculado = shasum.digest('base64');
        }
        
        const digestNoXml = extractTag(xml, 'DigestValue');

        return NextResponse.json({
            status: isValid ? 'SUCESSO_LOCAL' : 'FALHA_LOCAL',
            mensagem: isValid 
                ? "SUCESSO: Assinatura VÃ¡lida com InjeÃ§Ã£o Virtual!" 
                : "FALHA: Assinatura invÃ¡lida.",
            diagnostico: {
                hash_Calculado: hashCalculado,
                hash_Xml: digestNoXml,
                match_hash: hashCalculado === digestNoXml,
                algoritmo: 'RSA-SHA1'
            }
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDanfseXml } from './DanfseGenerator.ts';

function xmlAutorizado({ emailEmitente = 'cadastro.portal@example.com' } = {}) {
  const contatoEmitente = emailEmitente ? `<email>${emailEmitente}</email>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
    <NFSe>
      <infNFSe Id="NFS123">
        <nNFSe>23</nNFSe>
        <xLocEmi>Recife</xLocEmi>
        <emit>
          <CNPJ>54545869000140</CNPJ>
          <xNome>PRESTADOR TESTE</xNome>
          <enderNac>
            <cMun>2611606</cMun>
            <CEP>51010000</CEP>
            <xLgr>AVENIDA TESTE</xLgr>
            <nro>100</nro>
            <xBairro>BOA VIAGEM</xBairro>
            <UF>PE</UF>
          </enderNac>
          ${contatoEmitente}
        </emit>
        <DPS>
          <infDPS>
            <tpAmb>1</tpAmb>
            <prest>
              <CNPJ>54545869000140</CNPJ>
              <email>usuario-do-saas@example.com</email>
              <regTrib><opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib></regTrib>
            </prest>
          </infDPS>
        </DPS>
      </infNFSe>
    </NFSe>`;
}

test('usa CEP e e-mail cadastral do emitente devolvido pelo Portal Nacional', () => {
  const data = parseDanfseXml(xmlAutorizado());
  assert.equal(data.prestador.codigoIbgeCep, '26.11606 / 51.010-000');
  assert.equal(data.prestador.email, 'cadastro.portal@example.com');
});

test('nao reaproveita o e-mail da DPS quando o Portal nao devolve contato cadastral', () => {
  const data = parseDanfseXml(xmlAutorizado({ emailEmitente: '' }));
  assert.equal(data.prestador.email, '');
});

test('suprime retorno antigo que apenas repetiu o e-mail enviado pelo SaaS', () => {
  const data = parseDanfseXml(xmlAutorizado({ emailEmitente: 'usuario-do-saas@example.com' }));
  assert.equal(data.prestador.email, '');
});

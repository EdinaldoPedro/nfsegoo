import forge from 'node-forge';

export interface CertificadoA1Validado {
  cert: forge.pki.Certificate;
  vencimento: Date;
  cnpj: string;
}

function coletarTextos(valor: any, textos: string[], visitados = new Set<any>(), profundidade = 0) {
  if (valor == null || profundidade > 5) return;

  if (typeof valor === 'string') {
    textos.push(valor);
    return;
  }

  if (typeof valor !== 'object') return;
  if (visitados.has(valor)) return;
  visitados.add(valor);

  if (Array.isArray(valor)) {
    valor.forEach((item) => coletarTextos(item, textos, visitados, profundidade + 1));
    return;
  }

  Object.values(valor).forEach((item) => coletarTextos(item, textos, visitados, profundidade + 1));
}

function listarCnpjs(textos: string[]) {
  const candidatos = textos.flatMap((texto) => {
    const aposDoisPontos = texto.match(/:(\d{14})(?:\D|$)/)?.[1];
    const encontrados = texto.match(/\d{14}/g) || [];
    const apenasDigitos = texto.replace(/\D/g, '');
    return [
      ...(aposDoisPontos ? [aposDoisPontos] : []),
      ...(apenasDigitos.length === 14 ? [apenasDigitos] : []),
      ...encontrados,
    ];
  });

  return [...new Set(candidatos)];
}

function escolherCnpj(candidatos: string[], cnpjEmpresa?: string | null) {
  const cnpjLimpo = String(cnpjEmpresa || '').replace(/\D/g, '');
  if (cnpjLimpo) {
    const igualEmpresa = candidatos.find((cnpj) => cnpj === cnpjLimpo);
    if (igualEmpresa) return igualEmpresa;
  }

  return candidatos[0] || null;
}

function extrairCnpjDoCertificado(cert: forge.pki.Certificate, cnpjEmpresa?: string | null) {
  const atributosTitular = cert.subject?.attributes || [];
  const commonNames = atributosTitular
    .filter((attr: any) => attr.shortName === 'CN' || attr.name === 'commonName')
    .map((attr: any) => String(attr.value || ''));

  const cnpjDoCommonName = escolherCnpj(listarCnpjs(commonNames), cnpjEmpresa);
  if (cnpjDoCommonName) return cnpjDoCommonName;

  const textosDoTitular: string[] = [];
  coletarTextos(atributosTitular, textosDoTitular);
  const cnpjDoTitular = escolherCnpj(listarCnpjs(textosDoTitular), cnpjEmpresa);
  if (cnpjDoTitular) return cnpjDoTitular;

  const textosTecnicos: string[] = [];
  coletarTextos(cert.extensions || [], textosTecnicos);
  return escolherCnpj(listarCnpjs(textosTecnicos), cnpjEmpresa);
}

export function validarCertificadoA1(
  certificadoBase64: string,
  senha: string,
  cnpjEmpresa?: string | null,
): CertificadoA1Validado {
  if (!certificadoBase64) {
    throw new Error('Selecione o arquivo do certificado A1.');
  }

  if (!senha) {
    throw new Error('Informe a senha do certificado A1.');
  }

  let cert: forge.pki.Certificate | undefined;
  let key: any;

  try {
    const p12Der = forge.util.decode64(certificadoBase64);
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    // @ts-ignore node-forge types do not expose indexed OID bags cleanly.
    cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    // @ts-ignore node-forge types do not expose indexed OID bags cleanly.
    key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;

    if (!key) {
      const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag });
      // @ts-ignore node-forge types do not expose indexed OID bags cleanly.
      key = keyBags2[forge.pki.oids.keyBag]?.[0]?.key;
    }
  } catch {
    throw new Error('Senha incorreta ou arquivo de certificado invalido.');
  }

  if (!cert || !key) {
    throw new Error('Certificado A1 sem chave privada valida.');
  }

  const agora = new Date();
  if (agora < cert.validity.notBefore) {
    throw new Error('Certificado ainda nao esta valido.');
  }

  if (agora > cert.validity.notAfter) {
    throw new Error('Certificado vencido.');
  }

  const cnpjCertificado = extrairCnpjDoCertificado(cert, cnpjEmpresa);
  if (!cnpjCertificado) {
    throw new Error('Nao foi possivel identificar o CNPJ dentro do certificado.');
  }

  const cnpjLimpo = String(cnpjEmpresa || '').replace(/\D/g, '');
  if (cnpjLimpo && cnpjCertificado !== cnpjLimpo) {
    throw new Error(`O certificado pertence ao CNPJ ${cnpjCertificado}, diferente do CNPJ da empresa.`);
  }

  return {
    cert,
    vencimento: cert.validity.notAfter,
    cnpj: cnpjCertificado,
  };
}

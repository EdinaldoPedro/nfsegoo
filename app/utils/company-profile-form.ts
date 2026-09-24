/** Database nulls must not turn optional inputs into invalid JSON on save.
 * Account email is deliberately not a fallback for the company's contact. */
export function companyProfileFormFields(input: Record<string, unknown>) {
  const string = (key: string) => typeof input[key] === 'string' ? input[key] as string : '';
  return {
    documento: string('documento'), razaoSocial: string('razaoSocial'), nomeFantasia: string('nomeFantasia'),
    inscricaoMunicipal: string('inscricaoMunicipal'), cep: string('cep'), logradouro: string('logradouro'),
    numero: string('numero'), complemento: string('complemento'), bairro: string('bairro'), cidade: string('cidade'),
    uf: string('uf'), codigoIbge: string('codigoIbge'), email: string('emailComercial'),
  };
}

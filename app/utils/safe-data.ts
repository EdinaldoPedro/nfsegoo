export function stripEmpresaSecrets<T extends Record<string, any> | null | undefined>(empresa: T) {
  if (!empresa) return empresa;

  const { certificadoA1, senhaCertificado, ...empresaSegura } = empresa;
  return {
    ...empresaSegura,
    temCertificado: !!certificadoA1,
  };
}

export function stripUserSecrets<T extends Record<string, any> | null | undefined>(user: T) {
  if (!user) return user;

  const {
    senha,
    resetToken,
    verificationCode,
    verificationExpires,
    empresa,
    empresasContabeis,
    empresasFaturadas,
    ...safeUser
  } = user;

  return {
    ...safeUser,
    empresa: stripEmpresaSecrets(empresa),
    empresasContabeis: Array.isArray(empresasContabeis)
      ? empresasContabeis.map((vinculo) => ({
          ...vinculo,
          empresa: stripEmpresaSecrets(vinculo.empresa),
        }))
      : empresasContabeis,
    empresasFaturadas: Array.isArray(empresasFaturadas) ? empresasFaturadas.map((item) => stripEmpresaSecrets(item)) : empresasFaturadas,
  };
}

const { createHash, X509Certificate } = require('node:crypto');
const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');

const EXPECTED_ARCHIVE_SHA512 = '4585a99955607525e475cf22138302fe8ddce6ca8f0926cd1f01809f007d4bcddff5c1070369d29b1de99c0d2eb058ce0deb856bae0189469ba37e09a59d7985';
const SOURCE_URL = 'https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip';

function fail(message) {
  console.error(`ICP_BUNDLE_UPDATE_BLOCKED: ${message}`);
  process.exit(1);
}

const sourceDirectory = process.argv[2] && resolve(process.argv[2]);
const archivePath = process.argv[3] && resolve(process.argv[3]);
if (!sourceDirectory || !archivePath) fail('use: node scripts/update-icp-brasil-bundle.cjs <diretorio-extraido> <arquivo-zip>');
if (!statSync(sourceDirectory).isDirectory() || !statSync(archivePath).isFile()) fail('origem inexistente');

const archiveHash = createHash('sha512').update(readFileSync(archivePath)).digest('hex');
if (archiveHash !== EXPECTED_ARCHIVE_SHA512) fail('SHA-512 do pacote oficial diverge do valor aprovado');

const paths = readdirSync(sourceDirectory, { recursive: true })
  .map(entry => join(sourceDirectory, entry))
  .filter(path => statSync(path).isFile())
  .sort((left, right) => left.localeCompare(right));
const roots = [];
const intermediates = [];
const now = Date.now();

for (const path of paths) {
  let certificate;
  try { certificate = new X509Certificate(readFileSync(path)); }
  catch { fail(`certificado ilegível: ${basename(path)}`); }
  if (!certificate.ca) fail(`arquivo não representa uma AC: ${basename(path)}`);
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) {
    fail(`certificado fora da validade no pacote vigente: ${basename(path)}`);
  }
  const pem = certificate.toString().trim();
  const selfSigned = certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey);
  (selfSigned ? roots : intermediates).push({ subject: certificate.subject, pem });
}

if (roots.length !== 5 || intermediates.length !== 175) {
  fail(`inventário inesperado: ${roots.length} raízes e ${intermediates.length} intermediárias`);
}

const outputDirectory = resolve(__dirname, '..', 'resources', 'fiscal');
const serialize = values => `${values.sort((a, b) => a.subject.localeCompare(b.subject)).map(value => value.pem).join('\n')}\n`;
writeFileSync(join(outputDirectory, 'icp-brasil-roots-20260826.pem'), serialize(roots), { encoding: 'utf8', mode: 0o644 });
writeFileSync(join(outputDirectory, 'icp-brasil-intermediates-20260826.pem'), serialize(intermediates), { encoding: 'utf8', mode: 0o644 });
console.log(`ICP_BUNDLE_UPDATED: ${roots.length} raízes, ${intermediates.length} intermediárias; fonte ${SOURCE_URL}`);

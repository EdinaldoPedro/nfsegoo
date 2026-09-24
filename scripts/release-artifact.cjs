// Generates and verifies an immutable release manifest. It never reads .env contents.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RELEASE_GROUPS = {
  web: [
    '.next/BUILD_ID', '.next/build-manifest.json', '.next/prerender-manifest.json',
    '.next/routes-manifest.json', '.next/required-server-files.json', '.next/server', '.next/static',
  ],
  workers: ['dist/worker'],
  runtime: [
    'package.json', 'package-lock.json', 'prisma/schema.prisma', 'prisma/migrations', 'resources/fiscal',
    'app/api/notas', 'app/services', 'app/utils', 'workers',
    'app/legal-content.ts', 'app/termos-de-uso', 'app/politica-de-privacidade', 'app/politica-de-cookies',
    'scripts/register-worker.cjs', 'scripts/supervise-consultations.cjs',
    'scripts/infrastructure-readiness.cjs', 'scripts/migration-gate.cjs',
    'scripts/migration-readiness.cjs', 'scripts/operational-monitor.cjs',
    'scripts/legal-governance-readiness.cjs',
    'scripts/capacity-readiness.cjs',
    'scripts/manual-acceptance-readiness.cjs', 'docs/TESTES-MANUAIS.md',
    'scripts/public-launch-readiness.cjs',
  ],
};

function sha256(content) { return crypto.createHash('sha256').update(content).digest('hex'); }
function normalizedRelative(rootDir, absolute) { return path.relative(rootDir, absolute).replaceAll(path.sep, '/'); }

function collectArtifactFiles(rootDir, entries) {
  const root = path.resolve(rootDir);
  const files = [];
  function visit(relative) {
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error('Caminho de artefato fora do release.');
    if (!fs.existsSync(absolute)) throw new Error(`Artefato obrigatório ausente: ${relative}`);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Link simbólico não permitido no artefato: ${relative}`);
    if (stat.isFile()) { files.push(normalizedRelative(root, absolute)); return; }
    if (!stat.isDirectory()) throw new Error(`Artefato inválido: ${relative}`);
    for (const child of fs.readdirSync(absolute).sort()) {
      if (relative === '.next' && ['cache', 'diagnostics', 'trace', 'types'].includes(child)) continue;
      visit(path.join(relative, child));
    }
  }
  for (const entry of entries) visit(entry);
  return [...new Set(files)].sort();
}

function hashArtifactGroup(rootDir, entries) {
  const files = collectArtifactFiles(rootDir, entries);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (const relative of files) {
    const content = fs.readFileSync(path.resolve(rootDir, relative));
    bytes += content.length;
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return { sha256: hash.digest('hex'), files: files.length, bytes };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function dependencyLockIssues(packageJson, packageLock) {
  const issues = [];
  const root = packageLock?.packages?.[''];
  if (packageLock?.lockfileVersion !== 3 || !root) return ['PACKAGE_LOCK_INVALID'];
  for (const field of ['dependencies', 'devDependencies']) {
    const declared = packageJson[field] || {};
    const locked = root[field] || {};
    if (JSON.stringify(Object.entries(declared).sort()) !== JSON.stringify(Object.entries(locked).sort())) {
      issues.push(`PACKAGE_LOCK_${field.toUpperCase()}_MISMATCH`);
    }
  }
  return issues;
}

function pinnedToolchain(rootDir) {
  const packageJson = readJson(path.join(rootDir, 'package.json'));
  const node = fs.readFileSync(path.join(rootDir, '.node-version'), 'utf8').trim().replace(/^v/, '');
  const npmMatch = /^npm@(.+)$/.exec(String(packageJson.packageManager || ''));
  return { node, npm: npmMatch?.[1] || '', packageJson };
}

function command(rootDir, executable, args) {
  const result = spawnSync(executable, args, { cwd: rootDir, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Não foi possível identificar a revisão do release.');
  return result.stdout.trim();
}

function gitReleaseIdentity(rootDir) {
  const commit = command(rootDir, 'git', ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Commit Git inválido.');
  const dirty = command(rootDir, 'git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirty) throw new Error('O release exige commit limpo; há alterações ou arquivos não rastreados.');
  return commit;
}

function currentNpmVersion(rootDir) {
  const result = runNpm(rootDir, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Não foi possível identificar a versão do npm.');
  return result.stdout.trim();
}

function runNpm(rootDir, args, options = {}) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && fs.existsSync(npmCli)) {
    return spawnSync(process.execPath, [npmCli, ...args], { cwd: rootDir, windowsHide: true, ...options });
  }
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: rootDir, windowsHide: true, ...options });
  }
  return spawnSync('npm', args, { cwd: rootDir, windowsHide: true, ...options });
}

function inspectReleaseState(rootDir, groups = RELEASE_GROUPS) {
  const toolchain = pinnedToolchain(rootDir);
  const packageLock = readJson(path.join(rootDir, 'package-lock.json'));
  const lockIssues = dependencyLockIssues(toolchain.packageJson, packageLock);
  const artifacts = {};
  for (const [name, entries] of Object.entries(groups)) artifacts[name] = hashArtifactGroup(rootDir, entries);
  return {
    rootDir: path.resolve(rootDir),
    nodeVersion: process.versions.node,
    pinnedNodeVersion: toolchain.node,
    packageVersion: toolchain.packageJson.version,
    packageManager: toolchain.packageJson.packageManager || '',
    packageLockSha256: sha256(fs.readFileSync(path.join(rootDir, 'package-lock.json'))),
    buildId: fs.readFileSync(path.join(rootDir, '.next', 'BUILD_ID'), 'utf8').trim(),
    artifacts,
    lockIssues,
  };
}

function createReleaseManifest(rootDir, now = new Date()) {
  const state = inspectReleaseState(rootDir);
  const commit = gitReleaseIdentity(rootDir);
  const npmVersion = currentNpmVersion(rootDir);
  if (state.nodeVersion !== state.pinnedNodeVersion) throw new Error(`Node deve ser exatamente ${state.pinnedNodeVersion}.`);
  if (npmVersion !== state.packageManager.replace(/^npm@/, '')) throw new Error(`npm deve ser exatamente ${state.packageManager}.`);
  if (state.lockIssues.length) throw new Error(`package-lock divergente: ${state.lockIssues.join(', ')}`);
  return {
    schemaVersion: 1,
    releaseId: `${state.packageVersion}+${commit.slice(0, 12)}.${state.buildId}`,
    packageVersion: state.packageVersion,
    gitCommit: commit,
    createdAt: now.toISOString(),
    nodeVersion: state.nodeVersion,
    npmVersion,
    packageLockSha256: state.packageLockSha256,
    buildId: state.buildId,
    artifacts: state.artifacts,
  };
}

function validateReleaseManifest(manifest, state) {
  const issues = [...state.lockIssues];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, issues: ['RELEASE_MANIFEST_INVALID'] };
  const allowed = ['schemaVersion', 'releaseId', 'packageVersion', 'gitCommit', 'createdAt', 'nodeVersion', 'npmVersion', 'packageLockSha256', 'buildId', 'artifacts'];
  if (Object.keys(manifest).some(key => !allowed.includes(key))) issues.push('RELEASE_MANIFEST_UNKNOWN_FIELD');
  if (manifest.schemaVersion !== 1) issues.push('RELEASE_SCHEMA_VERSION_INVALID');
  if (!/^[a-f0-9]{40}$/.test(String(manifest.gitCommit || ''))) issues.push('RELEASE_COMMIT_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(manifest.createdAt || '')) || !Number.isFinite(new Date(manifest.createdAt).getTime())) issues.push('RELEASE_DATE_INVALID');
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.npmVersion || ''))) issues.push('RELEASE_NPM_VERSION_INVALID');
  const expectedReleaseId = `${state.packageVersion}+${String(manifest.gitCommit || '').slice(0, 12)}.${state.buildId}`;
  if (manifest.releaseId !== expectedReleaseId) issues.push('RELEASE_ID_INVALID');
  for (const field of ['packageVersion', 'nodeVersion', 'packageLockSha256', 'buildId']) {
    const stateField = field === 'packageVersion' ? state.packageVersion : state[field];
    if (manifest[field] !== stateField) issues.push(`RELEASE_${field.toUpperCase()}_MISMATCH`);
  }
  if (state.nodeVersion !== state.pinnedNodeVersion) issues.push('RUNTIME_NODE_NOT_PINNED');
  if (manifest.nodeVersion !== state.pinnedNodeVersion) issues.push('RELEASE_NODE_NOT_PINNED');
  try {
    const currentCommit = gitReleaseIdentityForVerification(state.rootDir);
    if (currentCommit && currentCommit !== manifest.gitCommit) issues.push('RELEASE_COMMIT_MISMATCH');
  } catch { issues.push('RELEASE_COMMIT_UNREADABLE'); }
  for (const [name, expected] of Object.entries(state.artifacts)) {
    const recorded = manifest.artifacts?.[name];
    if (!recorded || recorded.sha256 !== expected.sha256 || recorded.files !== expected.files || recorded.bytes !== expected.bytes) {
      issues.push(`RELEASE_ARTIFACT_${name.toUpperCase()}_MISMATCH`);
    }
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)], releaseId: manifest.releaseId || null };
}

function inspectReleaseManifest(options) {
  if (!path.isAbsolute(options.manifestFile || '')) return { ok: false, issues: ['RELEASE_MANIFEST_PATH_NOT_ABSOLUTE'] };
  try {
    const stat = fs.lstatSync(options.manifestFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 64 * 1024) return { ok: false, issues: ['RELEASE_MANIFEST_FILE_INVALID'] };
    return validateReleaseManifest(readJson(options.manifestFile), inspectReleaseState(options.rootDir, options.groups));
  } catch { return { ok: false, issues: ['RELEASE_MANIFEST_UNREADABLE_OR_ARTIFACT_MISSING'] }; }
}

function gitReleaseIdentityForVerification(rootDir) {
  if (!rootDir || !fs.existsSync(path.join(rootDir, '.git'))) return null;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Git indisponível.');
  return result.stdout.trim();
}

function releaseReadinessDetail(result) {
  return result.ok ? `release ${result.releaseId} íntegro` : `${result.issues.length} divergência(s) de release: ${result.issues.slice(0, 5).join(', ')}${result.issues.length > 5 ? ', ...' : ''}`;
}

if (require.main === module) {
  const rootDir = path.join(__dirname, '..');
  if (process.argv.includes('--write')) {
    try {
      const output = process.env.RELEASE_MANIFEST_OUTPUT
        ? path.resolve(process.env.RELEASE_MANIFEST_OUTPUT)
        : path.join(rootDir, 'dist', 'release-manifest.json');
      const manifest = createReleaseManifest(rootDir);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
      console.log(`RELEASE_MANIFEST_CREATED: ${manifest.releaseId}`);
    } catch (error) { console.error(`RELEASE_MANIFEST_BLOCKED: ${error.message}`); process.exitCode = 1; }
  } else {
    const result = inspectReleaseManifest({ rootDir, manifestFile: process.env.RELEASE_MANIFEST_FILE });
    console.log(releaseReadinessDetail(result));
    console.log(result.ok ? 'RELEASE_OK' : 'RELEASE_BLOCKED');
    process.exitCode = result.ok ? 0 : 1;
  }
}

module.exports = {
  RELEASE_GROUPS, collectArtifactFiles, hashArtifactGroup, dependencyLockIssues, inspectReleaseState,
  createReleaseManifest, validateReleaseManifest, inspectReleaseManifest, releaseReadinessDetail,
  pinnedToolchain, currentNpmVersion, runNpm,
};

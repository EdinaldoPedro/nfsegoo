const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  dependencyLockIssues, inspectReleaseManifest, inspectReleaseState, validateReleaseManifest,
} = require('../scripts/release-artifact.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-release-'));
  const packageJson = {
    name: 'nfse-test', version: '1.2.3', packageManager: 'npm@12.0.2',
    dependencies: { next: '16.3.4' }, devDependencies: { typescript: '^5' },
  };
  const packageLock = {
    lockfileVersion: 3,
    packages: { '': { name: 'nfse-test', version: '1.2.3', dependencies: { ...packageJson.dependencies }, devDependencies: { ...packageJson.devDependencies } } },
  };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(packageLock));
  fs.writeFileSync(path.join(root, '.node-version'), `${process.versions.node}\n`);
  fs.mkdirSync(path.join(root, '.next'));
  fs.writeFileSync(path.join(root, '.next', 'BUILD_ID'), 'build-123');
  for (const directory of ['web', 'workers', 'runtime']) {
    fs.mkdirSync(path.join(root, directory));
    fs.writeFileSync(path.join(root, directory, `${directory}.txt`), `${directory}\n`);
  }
  const groups = { web: ['web'], workers: ['workers'], runtime: ['runtime'] };
  return { root, groups, packageJson, packageLock };
}

function manifestFor(state) {
  const commit = 'a'.repeat(40);
  return {
    schemaVersion: 1,
    releaseId: `${state.packageVersion}+${commit.slice(0, 12)}.${state.buildId}`,
    packageVersion: state.packageVersion,
    gitCommit: commit,
    createdAt: '2026-09-24T12:00:00.000Z',
    nodeVersion: state.nodeVersion,
    npmVersion: '12.0.2',
    packageLockSha256: state.packageLockSha256,
    buildId: state.buildId,
    artifacts: state.artifacts,
  };
}

test('manifesto aceita somente web, workers e runtime gerados juntos', () => {
  const data = fixture();
  try {
    const state = inspectReleaseState(data.root, data.groups);
    assert.deepEqual(validateReleaseManifest(manifestFor(state), state), {
      ok: true, issues: [], releaseId: `1.2.3+${'a'.repeat(12)}.build-123`,
    });
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('alteracao posterior em qualquer artefato invalida o release', () => {
  const data = fixture();
  try {
    const original = inspectReleaseState(data.root, data.groups);
    const manifest = manifestFor(original);
    fs.writeFileSync(path.join(data.root, 'workers', 'workers.txt'), 'worker adulterado\n');
    const result = validateReleaseManifest(manifest, inspectReleaseState(data.root, data.groups));
    assert.ok(result.issues.includes('RELEASE_ARTIFACT_WORKERS_MISMATCH'));
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('package-lock divergente das dependencias declaradas bloqueia o release', () => {
  const data = fixture();
  try {
    data.packageLock.packages[''].dependencies.next = '15.0.0';
    assert.deepEqual(dependencyLockIssues(data.packageJson, data.packageLock), ['PACKAGE_LOCK_DEPENDENCIES_MISMATCH']);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('manifesto exige caminho absoluto e arquivo pequeno legivel', () => {
  const data = fixture();
  try {
    assert.deepEqual(inspectReleaseManifest({ rootDir: data.root, manifestFile: 'release.json', groups: data.groups }), {
      ok: false, issues: ['RELEASE_MANIFEST_PATH_NOT_ABSOLUTE'],
    });
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('releaseId e campos extras nao podem ser forjados', () => {
  const data = fixture();
  try {
    const state = inspectReleaseState(data.root, data.groups);
    const manifest = { ...manifestFor(state), releaseId: 'qualquer', segredo: 'nao' };
    const result = validateReleaseManifest(manifest, state);
    assert.ok(result.issues.includes('RELEASE_ID_INVALID'));
    assert.ok(result.issues.includes('RELEASE_MANIFEST_UNKNOWN_FIELD'));
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

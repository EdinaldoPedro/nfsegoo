const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('PostgreSQL: outbox cifra, deduplica e entrega e-mail com posse durável', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async () => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { enqueueEmailDelivery, processNextEmailDelivery } = require('../../app/services/emailOutboxService.ts');
  const marker = randomUUID();
  let id;
  try {
    const payload = { to: `qa-${marker}@example.invalid`, subject: 'Mensagem sintética', html: `<p>conteudo-${marker}</p>`, context: { module: 'QA' } };
    const first = await enqueueEmailDelivery(payload, { dedupKey: marker, expiresAt: new Date(Date.now() + 60_000) });
    const replay = await enqueueEmailDelivery(payload, { dedupKey: marker, expiresAt: new Date(Date.now() + 60_000) });
    assert.ok(first); assert.equal(replay.id, first.id); id = first.id;
    const stored = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    assert.equal(stored.payloadEncrypted.includes(marker), false);
    let received;
    assert.equal(await processNextEmailDelivery(async value => { received = value; return { success: true, messageId: 'qa-provider-id' }; }), true);
    assert.equal(received.to, payload.to); assert.equal(received.html, payload.html);
    const sent = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    assert.equal(sent.status, 'ENVIADO'); assert.equal(sent.attempts, 1); assert.ok(sent.sentAt); assert.equal(sent.providerMessageId, 'qa-provider-id');
    await prisma.emailOutbox.update({ where: { id }, data: { status: 'ERRO_FINAL' } });
    assert.equal(await enqueueEmailDelivery(payload, { dedupKey: marker, expiresAt: new Date(Date.now() + 60_000) }), null);
    assert.equal(await enqueueEmailDelivery({ ...payload, to: `outro-${marker}@example.invalid` }, { expiresAt: new Date(Date.now() - 1) }), null);
  } finally { if (id) await prisma.emailOutbox.deleteMany({ where: { id } }); }
});

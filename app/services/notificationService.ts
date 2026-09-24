import { prisma } from '@/app/utils/prisma';
import { noticeAudiences } from '@/app/services/globalNoticeService';

type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH';

type CreateAppNotificationParams = {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  empresaId?: string | null;
  vendaId?: string | null;
  notaId?: string | null;
  eventKey: string;
  priority?: NotificationPriority;
  payload?: any;
};

type FiscalNotificationParams = {
  type: 'NOTA_AUTORIZADA' | 'NOTA_FALHA' | 'NOTA_RETRY' | 'NOTA_CANCELADA';
  vendaId: string;
  notaId?: string | null;
  actorUserId?: string | null;
  title: string;
  message: string;
  priority?: NotificationPriority;
  payload?: any;
  eventKeySuffix?: string;
};

const appNotificationModel = (prisma as any).appNotification;
let notificationTableReadyCache: boolean | null = null;
let globalNoticeAppColumnReadyCache: boolean | null = null;

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

async function notificationTableReady() {
  if (!appNotificationModel) return false;
  if (notificationTableReadyCache !== null) return notificationTableReadyCache;

  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'AppNotification'
      ) AS "exists"
    `;
    if (rows?.[0]?.exists === true) {
      notificationTableReadyCache = true;
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function globalNoticeAppColumnReady() {
  if (globalNoticeAppColumnReadyCache !== null) return globalNoticeAppColumnReadyCache;

  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'GlobalNotice'
          AND column_name = 'notificarApp'
      ) AS "exists"
    `;
    if (rows?.[0]?.exists === true) {
      globalNoticeAppColumnReadyCache = true;
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export async function notificationStorageReady() {
  return notificationTableReady();
}

export async function createAppNotification(params: CreateAppNotificationParams) {
  if (!params.recipientId || !params.eventKey) return null;
  if (!(await notificationTableReady())) return null;

  try {
    return await appNotificationModel.upsert({
      where: {
        recipientId_eventKey: {
          recipientId: params.recipientId,
          eventKey: params.eventKey,
        },
      },
      create: {
        recipientId: params.recipientId,
        type: params.type,
        title: params.title,
        message: params.message,
        empresaId: params.empresaId || null,
        vendaId: params.vendaId || null,
        notaId: params.notaId || null,
        eventKey: params.eventKey,
        priority: params.priority || 'NORMAL',
        payloadJson: params.payload ? JSON.stringify(params.payload) : null,
      },
      update: {
        title: params.title,
        message: params.message,
        priority: params.priority || 'NORMAL',
        payloadJson: params.payload ? JSON.stringify(params.payload) : null,
      },
    });
  } catch (error) {
    console.error('[NOTIFICATION_CREATE_SKIPPED]', error);
    return null;
  }
}

export async function notifyFiscalEvent(params: FiscalNotificationParams) {
  const venda = await prisma.venda.findUnique({
    where: { id: params.vendaId },
    include: {
      empresa: {
        select: {
          id: true,
          proprietarioUserId: true,
          donoFaturamentoId: true,
          contadorCustodianteId: true,
        } as any,
      },
    },
  });

  if (!venda) return { recipients: 0 };

  const [donoCompatibilidade, colaboradores] = await Promise.all([
    prisma.user.findFirst({
      where: { empresaId: venda.empresaId, role: { notIn: ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'] } },
      select: { id: true },
    }),
    prisma.userCliente.findMany({
      where: { empresaId: venda.empresaId, revokedAt: null },
      select: { userId: true },
      take: 50,
    }),
  ]);

  const empresa = venda.empresa as any;
  const recipients = uniq([
    params.actorUserId,
    empresa?.proprietarioUserId,
    empresa?.donoFaturamentoId,
    empresa?.contadorCustodianteId,
    donoCompatibilidade?.id,
    ...colaboradores.map((item) => item.userId),
  ]);

  const eventKey = [
    params.type,
    params.vendaId,
    params.notaId || 'sem-nota',
    params.eventKeySuffix || 'principal',
  ].join(':');

  await Promise.all(
    recipients.map((recipientId) =>
      createAppNotification({
        recipientId,
        type: params.type,
        title: params.title,
        message: params.message,
        empresaId: venda.empresaId,
        vendaId: params.vendaId,
        notaId: params.notaId || null,
        eventKey,
        priority: params.priority || 'NORMAL',
        payload: {
          ...params.payload,
          vendaId: params.vendaId,
          notaId: params.notaId || null,
          empresaId: venda.empresaId,
        },
      }),
    ),
  );

  return { recipients: recipients.length };
}

export async function syncGlobalNoticeNotificationsForUser(user: { id: string; role: string }) {
  if (!(await notificationTableReady()) || !(await globalNoticeAppColumnReady())) return 0;

  const now = new Date();
  const notices = await prisma.globalNotice.findMany({ where: { status: 'ATIVO', notificarApp: true,
    publico: { in: noticeAudiences(user.role) }, OR: [{ iniciaEm: null }, { iniciaEm: { lte: now } }],
    AND: [{ OR: [{ terminaEm: null }, { terminaEm: { gte: now } }] }] }, orderBy: [{ tipo: 'desc' }, { createdAt: 'desc' }],
    take: 20, select: { id: true, tipo: true, titulo: true, mensagem: true, publico: true, linkLabel: true,
      linkHref: true, anexoNome: true, terminaEm: true } });

  await Promise.all(
    notices.map((notice: any) =>
      createAppNotification({
        recipientId: user.id,
        type: `AVISO_${notice.tipo || 'INFO'}`,
        title: notice.titulo,
        message: notice.mensagem,
        eventKey: `GLOBAL_NOTICE:${notice.id}`,
        priority: notice.tipo === 'CRITICAL' ? 'HIGH' : notice.tipo === 'WARNING' ? 'NORMAL' : 'LOW',
        payload: {
          avisoId: notice.id,
          publico: notice.publico,
          tipo: notice.tipo,
          linkLabel: notice.linkLabel,
          linkHref: notice.linkHref,
          anexoNome: notice.anexoNome,
          attachmentHref: notice.anexoNome ? `/api/avisos/${notice.id}/anexo` : null,
          terminaEm: notice.terminaEm,
        },
      }),
    ),
  );

  return notices.length;
}

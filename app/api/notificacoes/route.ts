import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { notificationStorageReady, syncGlobalNoticeNotificationsForUser } from '@/app/services/notificationService';

export const dynamic = 'force-dynamic';

const appNotificationModel = (prisma as any).appNotification;

function parsePayload(payloadJson?: string | null) {
  if (!payloadJson) return null;
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function serializeNotification(item: any) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    message: item.message,
    status: item.status,
    priority: item.priority,
    channel: item.channel,
    empresaId: item.empresaId,
    vendaId: item.vendaId,
    notaId: item.notaId,
    payload: parsePayload(item.payloadJson),
    readAt: item.readAt,
    deliveredAt: item.deliveredAt,
    createdAt: item.createdAt,
  };
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  if (!appNotificationModel || !(await notificationStorageReady())) {
    return NextResponse.json({ unreadCount: 0, data: [], storageReady: false });
  }

  await syncGlobalNoticeNotificationsForUser({ id: user.id, role: user.role });

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unread') === '1';
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 30, 1), 100);

  const where = {
    recipientId: user.id,
    ...(unreadOnly ? { status: 'UNREAD' } : {}),
  };

  const [items, unreadCount] = await Promise.all([
    appNotificationModel.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    appNotificationModel.count({
      where: { recipientId: user.id, status: 'UNREAD' },
    }),
  ]);

  return NextResponse.json({
    unreadCount,
    data: items.map(serializeNotification),
  });
}

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  if (!appNotificationModel || !(await notificationStorageReady())) {
    return NextResponse.json({ success: false, storageReady: false, error: 'Tabela de notificacoes ainda nao aplicada.' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const now = new Date();

  if (body.markAllRead === true) {
    await appNotificationModel.updateMany({
      where: { recipientId: user.id, status: 'UNREAD' },
      data: { status: 'READ', readAt: now },
    });
    return NextResponse.json({ success: true });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Informe as notificacoes para marcar como lidas.' }, { status: 400 });
  }

  await appNotificationModel.updateMany({
    where: { recipientId: user.id, id: { in: ids } },
    data: { status: 'READ', readAt: now },
  });

  return NextResponse.json({ success: true });
}

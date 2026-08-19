import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api-utils";
import { z } from "zod";

export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "true";

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: ctx.userId, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId: ctx.userId, isRead: false } }),
  ]);

  return NextResponse.json({ items, unreadCount });
});

const markReadSchema = z.object({ ids: z.array(z.string()).min(1) });

export const PATCH = withApiHandler(async (ctx, req) => {
  const body = await req.json();
  const { ids } = markReadSchema.parse(body);
  await prisma.notification.updateMany({
    where: { id: { in: ids }, userId: ctx.userId },
    data: { isRead: true },
  });
  return NextResponse.json({ ok: true });
});

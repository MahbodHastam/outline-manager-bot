import type { PrismaClient } from '@prisma/client';

export const getCustomDomainBaseForOwner = async (
  prisma: PrismaClient,
  ownerTelegramId: bigint,
): Promise<string | null> => {
  const owner = await prisma.user.findUnique({
    where: { telegramId: ownerTelegramId },
    select: { customDomain: true },
  });
  return owner?.customDomain?.trim() || null;
};

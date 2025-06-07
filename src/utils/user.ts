import { UserState } from '@prisma/client';
import { MyContext } from '../types/context';

export const getOrCreateUser = async (context: MyContext) => {
  const from = context.from;
  if (!from) return null;

  return context.prisma.user.upsert({
    where: { telegramId: from.id },
    update: { firstName: from.first_name, username: from.username },
    create: {
      telegramId: from.id,
      firstName: from.first_name,
      username: from.username,
      state: UserState.IDLE,
    },
  });
};

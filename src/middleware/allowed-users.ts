import type { MiddlewareFn } from 'telegraf';
import type { MyContext } from '../types/context';

function parseAllowedUserIds(): Set<number> {
  const raw = process.env.ALLOWED_USER_IDS;
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'ALLOWED_USER_IDS is required. Use comma-separated Telegram user IDs, e.g. ALLOWED_USER_IDS=111,222,333',
    );
  }

  const ids: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(
        `Invalid ALLOWED_USER_IDS entry "${trimmed}". Each value must be a positive integer Telegram user ID.`,
      );
    }
    ids.push(n);
  }

  if (ids.length === 0) {
    throw new Error(
      'ALLOWED_USER_IDS must contain at least one valid Telegram user ID.',
    );
  }

  return new Set(ids);
}

const allowedUserIds = parseAllowedUserIds();

export const allowedUsersMiddleware: MiddlewareFn<MyContext> = async (
  context,
  next,
) => {
  const userId =
    context.message?.chat.id || context.from?.id || context.msg.chat.id;
  if (userId === undefined || !allowedUserIds.has(userId)) {
    console.warn(
      `Blocked ${context.updateType} from unauthorized user ${userId ?? '(no id)'}`,
    );
    return;
  }

  return next();
};

import { randomBytes } from 'crypto';
import type { PrismaClient, Server } from '@prisma/client';

const ALIAS_LENGTH = 10;
const MAX_ALIAS_GENERATION_ATTEMPTS = 10;

const createAliasCandidate = () =>
  randomBytes(ALIAS_LENGTH)
    .toString('base64url')
    .replace(/[_-]/g, '')
    .slice(0, ALIAS_LENGTH)
    .toLowerCase();

export const getOrCreateKeyAlias = async (
  prisma: PrismaClient,
  server: Server,
  outlineKeyId: string,
) => {
  const existingAlias = await prisma.accessKeyAlias.findUnique({
    where: {
      serverId_outlineKeyId: {
        serverId: server.id,
        outlineKeyId,
      },
    },
  });

  if (existingAlias) return existingAlias.alias;

  for (let attempt = 0; attempt < MAX_ALIAS_GENERATION_ATTEMPTS; attempt++) {
    const alias = createAliasCandidate();

    try {
      const createdAlias = await prisma.accessKeyAlias.create({
        data: {
          alias,
          outlineKeyId,
          serverId: server.id,
        },
      });

      return createdAlias.alias;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('Unique constraint')) {
        throw error;
      }
    }
  }

  throw new Error('Failed to generate a unique alias for this access key.');
};

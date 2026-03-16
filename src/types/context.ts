import { Context } from 'telegraf';
import type { PrismaClient } from '@prisma/client';

export interface MyContext extends Context {
  prisma: PrismaClient;
  match: string[];
}

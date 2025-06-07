import { PrismaClient } from '@prisma/client';
import { Context } from 'telegraf';

export interface MyContext extends Context {
  prisma: PrismaClient;
  match: string[];
}

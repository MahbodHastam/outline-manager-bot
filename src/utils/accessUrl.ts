import type { Server } from '@prisma/client';

export const getActualAccessUrl = (accessUrl: string) => {
  try {
    const normalizedUrl = new URL(accessUrl);
    normalizedUrl.searchParams.delete('outline');
    return normalizedUrl.toString();
  } catch {
    return accessUrl
      .replace(/\?outline=1$/, '')
      .replace(/&outline=1$/, '')
      .replace(/\?outline=1&/, '?')
      .replace(/&outline=1&/, '&');
  }
};

export const getDisplayAccessUrl = (
  accessUrl: string,
  server: Server,
  keyAlias?: string,
) => {
  const actualAccessUrl = getActualAccessUrl(accessUrl);
  if (!server.customDomain || !keyAlias) return actualAccessUrl;

  try {
    const customBase = new URL(
      server.customDomain.endsWith('/')
        ? server.customDomain
        : `${server.customDomain}/`,
    );

    const result = new URL(keyAlias, customBase.toString());
    return result.toString();
  } catch {
    return actualAccessUrl;
  }
};

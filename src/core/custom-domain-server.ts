import * as http from 'http';
import { prisma } from './prisma';
import OutlineService from '../services/outline.service';
import { getActualAccessUrl } from '../utils/accessUrl';

const toPathPrefix = (pathname: string) => {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
};

const findServerByHostAndPath = async (
  hostname: string,
  port: string,
  path: string,
) => {
  const servers = await prisma.server.findMany({
    where: { customDomain: { not: null } },
  });

  for (const server of servers) {
    if (!server.customDomain) continue;

    try {
      const customDomainUrl = new URL(server.customDomain);
      const domainHostname = customDomainUrl.hostname.toLowerCase();
      const domainPort = customDomainUrl.port;

      if (domainHostname !== hostname.toLowerCase()) continue;
      if (domainPort && domainPort !== port) continue;

      const pathPrefix = toPathPrefix(customDomainUrl.pathname);
      if (pathPrefix !== '/' && !path.startsWith(pathPrefix)) continue;

      return { server, pathPrefix };
    } catch {
      continue;
    }
  }

  return null;
};

export const startCustomDomainServer = () => {
  const port = Number(
    process.env.CUSTOM_DOMAIN_PORT || process.env.ENV === 'production'
      ? 80
      : 8080,
  );

  const server = http.createServer(async (req, res) => {
    try {
      const hostHeader = req.headers.host;
      if (!hostHeader) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing Host header.');
        return;
      }

      const requestUrl = new URL(req.url || '/', `http://${hostHeader}`);

      if (
        req.method === 'GET' &&
        requestUrl.pathname.startsWith('/access-key/')
      ) {
        const parts = requestUrl.pathname.split('/').filter(Boolean);
        // ['access-key', '<serverId>', '<keyId>']
        if (parts.length === 3) {
          const [, serverIdStr, keyId] = parts;
          const serverId = Number(serverIdStr);

          if (!Number.isNaN(serverId)) {
            const server = await prisma.server.findUnique({
              where: { id: serverId },
            });

            if (!server) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Server not found.' }));
              return;
            }

            const outline = new OutlineService(server.apiUrl);
            const keys = await outline.getKeys();
            const key = keys?.find((k) => k.id === keyId);

            if (!key) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Access key not found.' }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: key.id,
                name: key.name,
                accessUrl: getActualAccessUrl(key.accessUrl),
              }),
            );
            return;
          }
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid access-key route.' }));
        return;
      }
      const found = await findServerByHostAndPath(
        requestUrl.hostname,
        requestUrl.port,
        requestUrl.pathname,
      );

      if (!found) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('No custom-domain route found for this request.');
        return;
      }

      const relativePath =
        found.pathPrefix === '/'
          ? requestUrl.pathname.slice(1)
          : requestUrl.pathname.slice(found.pathPrefix.length);
      const keyAlias = relativePath.replace(/^\/+|\/+$/g, '');

      if (!keyAlias || keyAlias.includes('/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Access key alias not found.');
        return;
      }

      const aliasRecord = await prisma.accessKeyAlias.findUnique({
        where: { alias: keyAlias },
      });

      if (!aliasRecord || aliasRecord.serverId !== found.server.id) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Access key alias not found.');
        return;
      }

      const outline = new OutlineService(found.server.apiUrl);
      const keys = await outline.getKeys();
      const key = keys?.find((item) => item.id === aliasRecord.outlineKeyId);

      if (!key) {
        await prisma.accessKeyAlias.delete({
          where: { alias: keyAlias },
        });
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Access key not found.');
        return;
      }

      const actualAccessUrl = getActualAccessUrl(key.accessUrl);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(actualAccessUrl);
    } catch (error) {
      console.error('Custom domain routing error ->', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error.');
    }
  });

  server.listen(port, () => {
    console.log(`Custom domain router listening on port ${port}`);
  });

  return server;
};

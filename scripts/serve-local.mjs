// キーはローカルのNodeだけで使い、ブラウザには読み取り結果だけを渡す。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { steamLocal } from './steam-local.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

export function localAppServer({ directory, steam = null, covers = null, games = null }) {
  const base = resolve(directory);
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const port = response.socket.localPort;
    const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    if (!origins.includes(`http://${request.headers.host}`) || (request.headers.origin && !origins.includes(request.headers.origin))) {
      response.writeHead(403).end(); return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD' && !(request.method === 'POST' && request.url === '/__steam/logout')) { response.writeHead(405).end(); return; }
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (steam && await steam(request, response, url)) return;
    if (url.pathname === '/__local/games') {
      const id = url.searchParams.get('id');
      const query = url.searchParams.get('query')?.trim();
      if (id !== null ? !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) : !query || query.length > 100) {
        response.writeHead(400).end(); return;
      }
      if (!games) { response.writeHead(503).end(); return; }
      try {
        const result = id !== null ? await games.get(Number(id)) : await games.search(query, 12);
        response.writeHead(200, { 'Content-Type': mime['.json'] }).end(JSON.stringify({ games: result }));
      } catch { response.writeHead(502).end(); }
      return;
    }
    if (url.pathname === '/__local/covers') {
      try {
        const raw = url.searchParams.get('ids') ?? '';
        if (!/^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(raw) || raw.split(',').length > 50) { response.writeHead(400).end(); return; }
        if (!covers) { response.writeHead(503).end(); return; }
        const result = await covers(raw.split(',').map(Number));
        response.writeHead(200, { 'Content-Type': mime['.json'] }).end(JSON.stringify({ covers: result }));
      } catch { response.writeHead(502).end(); }
      return;
    }
    if (url.pathname === '/__local/status.json') {
      response.writeHead(200, { 'Content-Type': mime['.json'] }).end(JSON.stringify({ mode: 'local-integrations' })); return;
    }
    try {
      const decoded = decodeURIComponent(url.pathname);
      const relative = ['/auth/callback', '/auth/link-callback'].includes(decoded) ? 'index.html' : decoded.slice(1) || 'index.html';
      if (relative.split('/').some(part => part.startsWith('.')) || !/^(index\.html|favicon\.ico|metadata\.json|assets\/.+|_expo\/.+)$/.test(relative)) {
        response.writeHead(404).end(); return;
      }
      const path = resolve(base, relative);
      if (!path.startsWith(`${base}${sep}`)) { response.writeHead(404).end(); return; }
      const body = await readFile(path);
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' }).end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404).end(); }
  });
}

async function start() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = resolve(root, 'packages/integrations/.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const key = process.env.STEAM_WEB_API_KEY;
  const { SteamClient } = await import('../packages/integrations/dist/src/steam.js');
  const client = key ? new SteamClient(key) : null;
  const port = Number(process.env.STEAM_LOCAL_PORT ?? 4183);
  const origin = `http://127.0.0.1:${port}`;
  const { IgdbClient } = await import('../packages/integrations/dist/src/igdb.js');
  let tail = Promise.resolve();
  let nextRequest = 0;
  const igdb = process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET ? new IgdbClient({ clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET }, {
    async acquire() {
      const previous = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
      nextRequest = Date.now() + 260;
      return { async release() { unlock(); } };
    },
  }) : null;
  const server = localAppServer({ directory: resolve(root, 'dist'), steam: steamLocal({ origin, client }), covers: igdb ? ids => igdb.steamCovers(ids) : null, games: igdb });
  server.listen(port, '127.0.0.1', () => console.log(`Shumitomo：http://127.0.0.1:${port}/?design=play#/settings`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(() => { console.error('ローカル版を起動できませんでした。ビルドとローカル設定を確認してください。'); process.exitCode = 1; });
}

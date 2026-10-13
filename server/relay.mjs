// WebSocket room relay for co-op sessions.
//  - In dev it is attached to the Vite server at /net (see vite.config.ts).
//  - `npm run server` runs it standalone and also serves the production build (dist/) for LAN play.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

export function attachRelay(httpServer, path = '/net') {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  /** room code -> { host: ws, guests: Map<id, ws> } */
  const rooms = new Map();
  let nextId = 1;

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(path)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  wss.on('connection', (ws) => {
    ws.id = nextId++;
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      const room = ws.room ? rooms.get(ws.room) : null;
      switch (m.type) {
        case 'host': {
          const code = String(m.room || '').toUpperCase().slice(0, 12);
          if (!code || rooms.has(code)) return send(ws, { type: 'error', error: 'Кімната вже існує' });
          rooms.set(code, { host: ws, guests: new Map() });
          ws.room = code; ws.isHost = true;
          send(ws, { type: 'hosted', room: code });
          break;
        }
        case 'join': {
          const code = String(m.room || '').toUpperCase();
          const r = rooms.get(code);
          if (!r) return send(ws, { type: 'error', error: 'Кімнату не знайдено' });
          if (r.guests.size >= 3) return send(ws, { type: 'error', error: 'Кімната заповнена' });
          r.guests.set(ws.id, ws);
          ws.room = code;
          send(ws, { type: 'joined-room', room: code, id: ws.id });
          send(r.host, { type: 'joined', id: ws.id, name: String(m.name || 'Гравець').slice(0, 18) });
          break;
        }
        case 'to-host':
          if (room && !ws.isHost) send(room.host, { type: 'from', id: ws.id, data: m.data });
          break;
        case 'broadcast':
          if (room && ws.isHost) { const s = JSON.stringify({ type: 'data', data: m.data }); for (const g of room.guests.values()) if (g.readyState === 1) g.send(s); }
          break;
        case 'to':
          if (room && ws.isHost) send(room.guests.get(m.id), { type: 'data', data: m.data });
          break;
      }
    });
    ws.on('close', () => {
      const r = ws.room && rooms.get(ws.room);
      if (!r) return;
      if (ws.isHost) {
        for (const g of r.guests.values()) send(g, { type: 'host-left' });
        rooms.delete(ws.room);
      } else {
        r.guests.delete(ws.id);
        send(r.host, { type: 'left', id: ws.id });
      }
    });
  });
  return wss;
}

// ---------------------------------------------------------------- standalone mode
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent((req.url || '/').split('?')[0]));
      if (p.endsWith('/')) p += 'index.html';
      const file = join(root, p);
      if (!file.startsWith(root)) throw new Error('bad path');
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  attachRelay(server);
  const port = +(process.env.PORT || 8787);
  server.listen(port, '0.0.0.0', () => console.log(`Живі королівства: http://localhost:${port}  (relay at /net)`));
}

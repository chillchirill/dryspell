// Loopback-only fixture for browser QA, not a deployed controller service.
const http = require('node:http');
const {createHash} = require('node:crypto');
module.exports = async function startRelay() {
  const clients = new Set();
  function broadcast(payload) {
    const body = Buffer.from(JSON.stringify(payload));
    const header = Buffer.alloc(body.length < 126 ? 2 : 4);
    header[0] = 0x81;
    if (body.length < 126) header[1] = body.length;
    else {header[1] = 126; header.writeUInt16BE(body.length, 2);}
    for (const client of clients) client.write(Buffer.concat([header, body]));
  }
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/esp32' || req.method !== 'POST') {res.writeHead(404); return res.end();}
    let body = '';
    req.on('data', chunk => {body += chunk; if (body.length > 4096) req.destroy();});
    req.on('end', () => {
      try {
        broadcast({event:'request', time:new Date().toISOString(), query:{}, body:JSON.parse(body)});
        res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}');
      } catch {res.writeHead(400); res.end();}
    });
  });
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') return socket.destroy();
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    clients.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(socket));
    socket.on('data', chunk => {if ((chunk[0] & 15) === 8) socket.end(Buffer.from([0x88, 0]));});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {url:`ws://127.0.0.1:${port}/ws`, http:`http://127.0.0.1:${port}`, broadcast,
    drop:() => {for (const client of clients) client.destroy();},
    close:() => {for (const client of clients) client.destroy(); server.close(); server.closeAllConnections();}};
};

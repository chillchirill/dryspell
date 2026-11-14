const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
const port = 2500;
const logFile = path.join(__dirname, 'logs', 'esp32.log');

fs.mkdirSync(path.dirname(logFile), { recursive: true });

function log(record) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...record });
  console.log(line);

  try {
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  } catch (err) {
    console.error(`Cannot write log file ${logFile}:`, err.message);
  }

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    // Disconnect slow viewers instead of growing their outgoing queue forever.
    if (client.bufferedAmount > 1024 * 1024) {
      client.terminate();
      continue;
    }
    client.send(line, (err) => {
      if (err) client.terminate();
    });
  }
}

wss.on('connection', (client) => {
  client.isAlive = true;
  client.on('pong', () => { client.isAlive = true; });
  client.on('error', (err) => console.error('WebSocket error:', err.message));
});
wss.on('error', (err) => console.error('WebSocket server error:', err.message));

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!client.isAlive) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);
heartbeat.unref();
wss.on('close', () => clearInterval(heartbeat));

app.set('query parser', 'extended');
app.use(express.static(path.join(__dirname, 'static')));
app.use('/static', express.static(path.join(__dirname, 'static')));

// Accept form fields, then read any other content type (including a missing one).
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: () => true, limit: '10mb' }));

function receiveEsp32(req, res) {
  let body = req.body ?? null;

  if (typeof body === 'string' && body.trim()) {
    try {
      body = JSON.parse(body);
    } catch {
      // Keep plain text or malformed JSON as received, without rejecting it.
    }
  }

  const received = {
    time: new Date().toISOString(),
    method: req.method,
    query: req.query,
    body,
  };

  log({ event: 'request', ...received });
  res.json({ ok: true, ...received });
}

app.route('/api/esp32').get(receiveEsp32).post(receiveEsp32);

app.use((err, req, res, next) => {
  log({ event: 'request_error', method: req.method, url: req.originalUrl, error: err.message });
  res.status(err.status || 500).json({ ok: false, error: err.message });
});

server.listen(port, '0.0.0.0', () => {
  log({ event: 'server_started', url: `http://localhost:${port}/api/esp32`, viewer: `http://localhost:${port}/`, logFile });
}).on('error', (err) => {
  log({ event: 'server_error', error: err.message });
  process.exitCode = 1;
});

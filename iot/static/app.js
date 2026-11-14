const entries = document.querySelector('#entries');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const status = document.querySelector('#status');
let socket = null;
let retryTimer;
let enabled = false;

function connect() {
  enabled = true;
  clearTimeout(retryTimer);
  if (socket) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const connection = new WebSocket(`${protocol}//${location.host}/ws`);
  socket = connection;
  status.textContent = 'Connecting…';
  connectButton.disabled = true;
  disconnectButton.disabled = false;

  connection.addEventListener('open', () => {
    if (socket === connection) status.textContent = 'Connected';
  });

  connection.addEventListener('message', (message) => {
    if (socket !== connection) return;
    const entry = document.createElement('pre');
    entry.textContent = message.data;
    entries.prepend(entry);
  });

  connection.addEventListener('close', () => {
    if (socket !== connection) return;
    socket = null;
    status.textContent = 'Connection lost. Reconnecting…';
    if (enabled) retryTimer = setTimeout(connect, 1000);
  });

  connection.addEventListener('error', () => connection.close());
}

function disconnect() {
  enabled = false;
  clearTimeout(retryTimer);
  const connection = socket;
  socket = null;
  if (connection) connection.close();
  status.textContent = 'Disconnected';
  connectButton.disabled = false;
  disconnectButton.disabled = true;
}

connectButton.addEventListener('click', connect);
disconnectButton.addEventListener('click', disconnect);
connect();

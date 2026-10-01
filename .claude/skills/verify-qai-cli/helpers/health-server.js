#!/usr/bin/env node
// Verification scaffolding for qai check. Serves JSON health on an ephemeral port.
const fs = require('fs');
const http = require('http');

const portFile = process.argv[2];
if (!portFile) {
  process.stderr.write('usage: health-server.js <port-file>\n');
  process.exit(1);
}

const body = JSON.stringify({ status: 'healthy' });
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  fs.writeFileSync(portFile, `${port}\n`);
  process.stdout.write(`LISTENING ${port}\n`);
});

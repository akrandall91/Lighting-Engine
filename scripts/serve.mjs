import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8000);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ies': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer((request, response) => {
  try {
    const urlPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const requested = path.resolve(root, `.${urlPath === '/' ? '/index.html' : urlPath}`);
    if (!requested.startsWith(root) || !statSync(requested).isFile()) throw new Error('Not found');
    response.writeHead(200, {
      'Content-Type': types[path.extname(requested).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(requested).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`SELS Lighting Engine: http://127.0.0.1:${port}`));

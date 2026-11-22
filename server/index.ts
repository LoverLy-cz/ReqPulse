import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(currentDir, '../client');

createApp(clientDist).listen(port, '127.0.0.1', () => {
  console.log(`HTTP More 已启动：http://127.0.0.1:${port}`);
});

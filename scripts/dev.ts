import { createServer } from 'vite';
import { resolve } from 'node:path';
import { GraphStore } from '../src/core/store';
import { createService } from '../src/server/service';

const service = await createService({ store: new GraphStore(resolve('knowledge')) });
try {
  const vite = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await vite.listen();
  console.log('OSDU Schema Explorer: http://127.0.0.1:5173');
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void Promise.all([vite.close(), service.close()]).then(() => process.exit(0));
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch {
  await service.close();
  console.error('Development viewer failed to start; check port 5173.');
  process.exitCode = 1;
}

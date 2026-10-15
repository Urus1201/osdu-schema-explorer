import { resolve } from 'node:path';
import { GraphStore } from '../core/store';
import { createService } from './service';

try {
  const service = await createService({
    store: new GraphStore(resolve('knowledge')),
    staticDir: resolve('dist'),
    sourceDirectory: resolve('local-sources'),
  });
  console.log(`OSDU Schema Explorer: ${service.url}`);
  let closing = false;
  const close = () => {
    if (!closing) {
      closing = true;
      void service.close().then(() => process.exit(0));
    }
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch {
  console.error('Local service failed to start; check port 4310 and validated graph storage.');
  process.exitCode = 1;
}

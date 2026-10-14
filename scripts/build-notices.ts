import { copyFile } from 'node:fs/promises';
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt'])
  await copyFile(file, `dist/${file}`);

import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const source = join(process.cwd(), 'src', 'web');
const target = join(process.cwd(), 'dist', 'web');
await mkdir(target, { recursive: true });
for (const entry of await readdir(source)) await copyFile(join(source, entry), join(target, entry));

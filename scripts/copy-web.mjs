import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const source = join(process.cwd(), 'src', 'web');
const target = join(process.cwd(), 'dist', 'web');
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
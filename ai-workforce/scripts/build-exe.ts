import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWindowsDesktopExe } from '../src/server/exeBuilder.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_SHARED_URL = 'https://ais-pre-botgw4iqxna2lg7uvxkreg-442298881070.asia-east1.run.app';
const rawEnvUrl = process.env.SHARED_APP_URL || process.env.APP_URL || DEFAULT_SHARED_URL;
const resolvedUrl =
  rawEnvUrl && !rawEnvUrl.includes('MY_APP_URL')
    ? rawEnvUrl.replace('://ais-dev-', '://ais-pre-')
    : DEFAULT_SHARED_URL;

const exeBuffer = buildWindowsDesktopExe(resolvedUrl);

const publicDir = path.join(rootDir, 'public');
const downloadsDir = path.join(publicDir, 'downloads');
fs.mkdirSync(downloadsDir, { recursive: true });

fs.writeFileSync(path.join(publicDir, 'AI-Workforce.exe'), exeBuffer);
fs.writeFileSync(path.join(downloadsDir, 'AI-Workforce.exe'), exeBuffer);

console.log(
  `[build:exe] Compiled AI-Workforce.exe (${exeBuffer.length} bytes, PE32+ x86_64 GUI) -> ${resolvedUrl}`
);

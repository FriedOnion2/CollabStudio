import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";

export async function openMacTerminal({ cwd, executable, args }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'collabstudio-'));
  const script = path.join(directory, 'CollabStudio.command');
  const lines = [
    '#!/bin/sh',
    `/bin/rm -f ${shellQuote(script)}`,
    `/bin/rmdir ${shellQuote(directory)}`,
    `cd ${shellQuote(cwd)} || exit`,
    `export PATH=${shellQuote(process.env.PATH || '/usr/bin:/bin')}`,
    `exec ${[executable, ...args].map(shellQuote).join(' ')}`
  ];
  try {
    await fs.writeFile(script, lines.join('\n') + '\n', { mode: 0o700 });
    await exec('/usr/bin/open', ['-b', 'com.apple.Terminal', script]);
  } catch (err) {
    await fs.rm(directory, { recursive: true, force: true });
    throw err;
  }
}

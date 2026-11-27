import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import packager from '@electron/packager';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const root = fileURLToPath(new URL('../', import.meta.url));
const arch = process.argv[2] || process.arch;

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) {
  throw new Error('Run on macOS with arm64 or x64 as the optional architecture argument.');
}

// Build outside the checkout so cloud-synced folders cannot add Finder metadata
// to the bundle before codesign.
const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'collabstudio-package-'));
try {
  const [bundleDir] = await packager({
    dir: root,
    name: 'CollabStudio',
    platform: 'darwin',
    arch,
    appBundleId: 'com.friedonion2.collabstudio',
    appCategoryType: 'public.app-category.developer-tools',
    icon: path.join(root, 'assets/icon.icns'),
    out: staging,
    asar: true,
    ignore: /^\/(dist|release|data|scripts)(\/|$)/
  });

  const app = path.join(bundleDir, 'CollabStudio.app');
  execFileSync('/usr/bin/xattr', ['-cr', app]);
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);

  const name = `CollabStudio-v${version}-macos-${arch}.zip`;
  const stagedArchive = path.join(staging, name);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, stagedArchive]);

  const out = path.join(root, 'dist');
  await fs.mkdir(out, { recursive: true });
  const archive = path.join(out, name);
  await fs.copyFile(stagedArchive, archive);
  console.log(archive);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}

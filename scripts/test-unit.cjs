'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// This suite reads a developer's current game checkout and resource caches.
// Keep it explicit (test:misc), not an undocumented prerequisite for CI.
const integration = new Set(['extract/misc/misc.test.js']);
function tests(directory) {
    return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
        const file = `${directory}/${entry.name}`;
        if (entry.isDirectory()) return tests(file);
        return entry.isFile() && file.endsWith('.test.js') && !integration.has(file) ? [file] : [];
    });
}
const files = ['cache', 'extract', 'resources', 'versions'].flatMap(tests).sort();
if (!files.length) throw new Error('No unit tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

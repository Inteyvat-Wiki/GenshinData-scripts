'use strict';
console.error('Registry publishing is disabled. Scoped package names and npm dependencies do not authorize publication. Obtain explicit publication approval and complete the release/license review first. Local npm pack remains available for integration tests.');
process.exitCode = 1;

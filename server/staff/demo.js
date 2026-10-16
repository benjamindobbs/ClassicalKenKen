// `npm run staff:demo`: starts the normal server with STAFF_DEMO=1 set, so
// the same command works in PowerShell and bash.
process.env.STAFF_DEMO = '1';
require('../index.js');

import {fileURLToPath} from 'node:url';
const root=new URL('../../../',import.meta.url);
process.env.DOON_AUTONOMY_PLATFORM='api';
process.env.DOON_AUTONOMY_DIR||=fileURLToPath(new URL('test-output/agent-chain-validation',root));
process.env.DOON_BUILD_DIR||=fileURLToPath(new URL('test-output/agent-chain-build',root));
process.env.DOON_AUTONOMY_PORT||='8809';process.env.DOON_AUTONOMY_BACKEND_PORT||='8810';
await import('./start.mjs');

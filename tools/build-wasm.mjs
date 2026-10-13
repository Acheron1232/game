// Compiles the AssemblyScript navigation core to public/wasm/nav.wasm
import { execSync } from 'node:child_process';
execSync('npx asc wasm/nav.ts -o public/wasm/nav.wasm -O3 --runtime stub --noAssert --initialMemory 64', { stdio: 'inherit' });
console.log('built public/wasm/nav.wasm');

import { cp, mkdir, rm } from 'node:fs/promises';
const target = new URL('../.local/site/', import.meta.url);
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await cp(new URL('../docs/site/',import.meta.url),target,{recursive:true});
await cp(new URL('../docs/images/',import.meta.url),new URL('assets/',target),{recursive:true});
console.log('Built project introduction in .local/site');

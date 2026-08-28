import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),wb=path.resolve(here,'..'),input=process.argv[2];if(!input)throw new Error('请提供备份目录');
const backup=path.resolve(input),source=(await fs.stat(path.join(backup,'data')).catch(()=>null))?path.join(backup,'data'):backup,target=path.resolve(process.env.WORKBENCH_DATA_DIR||path.join(wb,'data'));
const safety=path.join(wb,'backups',`pre_restore_${new Date().toISOString().replace(/[:.]/g,'-')}`);await fs.mkdir(safety,{recursive:true});await fs.cp(target,path.join(safety,'data'),{recursive:true});
await fs.rm(target,{recursive:true,force:true});await fs.cp(source,target,{recursive:true});console.log(`恢复完成：${target}\n恢复前数据：${safety}`);

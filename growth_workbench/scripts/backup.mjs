import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),wb=path.resolve(here,'..'),root=path.resolve(wb,'..');
const source=path.resolve(process.env.WORKBENCH_DATA_DIR||path.join(wb,'data')),stamp=new Date().toISOString().replace(/[:.]/g,'-'),target=path.join(wb,'backups',`workbench_${stamp}`);
await fs.mkdir(target,{recursive:true});await fs.cp(source,path.join(target,'data'),{recursive:true});
if(process.argv.includes('--full'))await fs.cp(path.join(root,'outputs/content_os_v1_phase2/postgres_data_release'),path.join(target,'content_os_database_snapshot'),{recursive:true});
console.log(`备份完成：${target}`);

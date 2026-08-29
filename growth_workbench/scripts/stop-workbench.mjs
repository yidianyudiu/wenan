import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const workbench=path.resolve(here,'..');
const pidFile=path.join(workbench,'runtime','workbench.pid.json');
let state;
try{state=JSON.parse(await fs.readFile(pidFile,'utf8'))}catch{console.log('No Workbench PID record was found. It may already be stopped.');process.exit(0)}
const pid=Number(state.pid);if(!Number.isInteger(pid)||pid<=0)throw new Error('Invalid Workbench PID record.');
if(process.platform==='win32'){
  const child=spawn('taskkill.exe',['/PID',String(pid),'/T','/F'],{stdio:'inherit',windowsHide:true});
  await new Promise(resolve=>child.once('close',resolve));
}else{
  try{process.kill(pid,'SIGTERM')}catch{}
}
await fs.rm(pidFile,{force:true});console.log(`Workbench stopped. PID: ${pid}`);

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const workbench=path.resolve(here,'..');
const envFile=path.join(workbench,'.env');
if(fs.existsSync(envFile)){
  for(const rawLine of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line||line.startsWith('#'))continue;
    const at=line.indexOf('=');
    if(at<=0)continue;
    const key=line.slice(0,at).trim(),value=line.slice(at+1).trim();
    if(process.env[key]===undefined)process.env[key]=value;
  }
}
const contentRoot=path.resolve(process.env.CONTENT_OS_ROOT||path.join(workbench,'..'));
const logsDir=path.join(workbench,'logs');
const logFile=path.join(logsDir,'windows-startup.log');
const fallbackLogFile=path.join(logsDir,`windows-startup-${process.pid}.log`);
const host=process.env.WORKBENCH_HOST||'127.0.0.1';
const port=Number(process.env.WORKBENCH_PORT||4310);
const url=`http://${host}:${port}`;
const expectedWorkbench='0.1.5-audit-rectification-02';
fs.mkdirSync(logsDir,{recursive:true});
const stamp=()=>new Date().toISOString();
let activeLogFile=logFile;
const log=message=>{
  const line=`[${stamp()}] ${message}`;console.log(line);
  try{fs.appendFileSync(activeLogFile,`${line}\r\n`,'utf8')}
  catch(error){
    if(activeLogFile===fallbackLogFile){process.stderr.write(`${line}\n`);return}
    activeLogFile=fallbackLogFile;
    try{fs.appendFileSync(activeLogFile,`[${stamp()}] Primary log unavailable (${error.code||error.message}); switched to fallback log.\r\n${line}\r\n`,'utf8')}
    catch{process.stderr.write(`${line}\n`)}
  }
};
const fail=message=>{const error=new Error(message);error.userFacing=true;throw error};
const exists=async p=>{try{await fsp.access(p);return true}catch{return false}};

async function openBrowser(){
  if(process.env.WORKBENCH_SKIP_BROWSER==='1'){log('验收模式：跳过自动打开浏览器。');return}
  try{const p=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',`Start-Process '${url}'`],{detached:true,stdio:'ignore'});p.unref();log(`浏览器打开命令已发送：${url}`)}
  catch{const p=spawn('cmd.exe',['/d','/s','/c',`start "" "${url}"`],{detached:true,stdio:'ignore'});p.unref();log(`使用cmd打开浏览器：${url}`)}
}
async function existingHealth(){
  try{const controller=new AbortController();setTimeout(()=>controller.abort(),1200);const r=await fetch(`${url}/api/health`,{signal:controller.signal});if(!r.ok)return null;return await r.json()}catch{return null}
}
async function checkPort(){
  await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,host,()=>s.close(resolve))});
}
async function startDetachedServer(){
  const runtimeDir=path.join(workbench,'runtime');await fsp.mkdir(runtimeDir,{recursive:true});
  const runtimeLog=path.join(logsDir,'server-runtime.log');
  const stdout=fs.openSync(runtimeLog,'a'),stderr=fs.openSync(runtimeLog,'a');
  const child=spawn(process.execPath,[path.join(workbench,'server.mjs')],{
    cwd:workbench,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr],
    env:{...process.env,CONTENT_OS_ROOT:contentRoot,WORKBENCH_HOST:host,WORKBENCH_PORT:String(port),OPEN_BROWSER:'0'}
  });
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
  fs.closeSync(stdout);fs.closeSync(stderr);child.unref();
  await fsp.writeFile(path.join(runtimeDir,'workbench.pid.json'),`${JSON.stringify({pid:child.pid,started_at:stamp(),url,runtime_log:runtimeLog},null,2)}\r\n`,'utf8');
  return child;
}
async function waitForHealth(attempts=60){
  for(let i=0;i<attempts;i++){const health=await existingHealth();if(health?.ok)return health;await new Promise(resolve=>setTimeout(resolve,200))}
  return null;
}
async function main(){
  log('================ Windows 本地启动诊断 ================');
  log(`诊断日志：${activeLogFile}`);
  log(`工作台目录：${workbench}`);log(`Content OS目录：${contentRoot}`);log(`Node版本：${process.version}`);
  const major=Number(process.versions.node.split('.')[0]);if(major<20)fail(`Node.js版本过低：${process.version}，需要20或更高版本。`);
  const required=[
    path.join(workbench,'server.mjs'),path.join(workbench,'public','index.html'),path.join(workbench,'public','app.js'),path.join(workbench,'public','styles.css'),
    path.join(workbench,'config','content-os-paths.json'),path.join(workbench,'config','brand-thesis.json'),path.join(workbench,'config','topic-domain-map.json')
  ];
  for(const p of required){if(!await exists(p))fail(`缺少工程文件：${p}`)}log(`工程文件检查：PASS（${required.length}项）`);
  const packageJson=JSON.parse(await fsp.readFile(path.join(workbench,'package.json'),'utf8'));const dependencies=Object.keys(packageJson.dependencies||{});
  if(dependencies.length)fail(`检测到未封装的第三方运行依赖：${dependencies.join('、')}。当前完整包不应依赖手动npm install。`);
  log('运行依赖检查：PASS（第三方npm运行依赖0，不需要npm install）');
  const paths=JSON.parse(await fsp.readFile(path.join(workbench,'config','content-os-paths.json'),'utf8'));
  const runtimeRequired=['database_snapshot','topic_agent','script_agent','retrieval_snapshot','positive_samples','calibration_data','topic_domain_map_image'];
  const missing=[];
  for(const key of runtimeRequired){const p=path.resolve(contentRoot,paths[key]);if(!await exists(p))missing.push(key)}
  if(missing.length)fail(`未找到本机 Content OS 运行资产。安全交付包不会携带数据库快照或内部语料。请在 growth_workbench/.env 设置 CONTENT_OS_ROOT=你的Content OS根目录。当前目录：${contentRoot}；缺失项：${missing.join('、')}`)
  const control=path.resolve(contentRoot,paths.database_snapshot,'global','pg_control');if(!await exists(control))fail(`数据库快照不完整，缺少：${control}`);
  for(const key of ['retrieval_snapshot','positive_samples','calibration_data'])JSON.parse(await fsp.readFile(path.resolve(contentRoot,paths[key]),'utf8'));
  log('Content OS路径、数据库快照与JSON资产：PASS');
  await fsp.mkdir(path.join(workbench,'data'),{recursive:true});const probe=path.join(workbench,'data','.write-test');await fsp.writeFile(probe,'ok');await fsp.rm(probe);log('本地数据目录写入权限：PASS');
  const current=await existingHealth();
  if(current?.ok&&current.workbench===expectedWorkbench){log('检测到当前版本 Growth Workbench 已经运行，将直接打开浏览器。');await openBrowser();return}
  if(current?.ok)fail(`端口 ${port} 正在运行其他版本的 Growth Workbench（${current.workbench||'unknown'}）。请先用旧工程的停止脚本关闭它，再启动当前版本。`)
  try{await checkPort();log(`端口 ${port}：可用`)}catch(error){fail(`端口 ${port} 已被其他程序占用。请关闭占用程序后重试。原始错误：${error.message}`)}
  const child=await startDetachedServer();log(`后台API进程已创建，PID：${child.pid}`);
  const health=await waitForHealth();if(!health?.ok){try{process.kill(child.pid)}catch{};fail('API后台进程启动后健康检查失败，请查看server-runtime.log。')}
  log(`本地API：PASS，正在监听 ${url}`);log(`Content OS状态：${health.content_os?.state||'unknown'}；Content Skill：${health.content_os?.content_skill||'unknown'}`);
  await openBrowser();log('工作台启动完成。API已转入后台运行，启动窗口可以安全关闭。');
}

process.on('uncaughtException',error=>{log(`FATAL ${error.stack||error.message}`);process.exitCode=1});
process.on('unhandledRejection',error=>{log(`FATAL ${error?.stack||error}`);process.exitCode=1});
main().catch(error=>{log(`启动失败：${error.userFacing?error.message:(error.stack||error.message)}`);process.exit(1)});

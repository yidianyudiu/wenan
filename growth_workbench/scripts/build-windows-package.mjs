import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const workbench=path.resolve(here,'..');
const root=path.resolve(workbench,'..');
const dist=path.join(root,'dist');
const packageName='Yujie_Growth_Workbench_V0.1_OPENROUTER_FLYWHEEL_01_Windows';
const target=path.join(dist,packageName);
const includeLocalEnv=process.env.INCLUDE_LOCAL_ENV==='1';
const includeLocalData=process.env.INCLUDE_LOCAL_DATA==='1';
await fs.rm(target,{recursive:true,force:true});
await fs.mkdir(target,{recursive:true});

const copy=async(from,to)=>{await fs.mkdir(path.dirname(to),{recursive:true});await fs.cp(from,to,{recursive:true})};
await copy(workbench,path.join(target,'growth_workbench'));
// 默认仍生成无密钥包；只有用户明确要求并设置 INCLUDE_LOCAL_ENV=1 时才保留本机 .env。
if(!includeLocalEnv)await fs.rm(path.join(target,'growth_workbench','.env'),{force:true});
// 默认外发包不携带真实脚本、反馈或用户数据。私有本机备份必须显式设置 INCLUDE_LOCAL_DATA=1。
if(!includeLocalData){
  const dataDir=path.join(target,'growth_workbench','data');
  await fs.rm(dataDir,{recursive:true,force:true});
  await fs.mkdir(dataDir,{recursive:true});
  for(const name of ['topics','scripts','reviews','inspirations','knowledge_inbox','creators','performance','calibration_events','preference_rules']){
    await fs.writeFile(path.join(dataDir,`${name}.json`),'[]\n','utf8');
  }
}
const statusPath=path.join(target,'growth_workbench','STATUS.json');
try{
  const status=JSON.parse(await fs.readFile(statusPath,'utf8'));
  status.version='0.1.3';
  status.status='GROWTH_WORKBENCH_V0.1_FLYWHEEL_RECTIFICATION_01';
  status.lin_style={...(status.lin_style||{}),api_key_in_package:includeLocalEnv,package_distribution:(includeLocalEnv||includeLocalData)?'private_only':'shareable_without_api_key_or_user_data'};
  status.feedback_flywheel={...(status.feedback_flywheel||{}),schema_version:'feedback_flywheel_v2',revision_pairs:true,rule_effect_attribution:true,semantic_candidate_extraction:true};
  if(!includeLocalData)status.feedback_flywheel={...status.feedback_flywheel,existing_feedback_migrated:0,paired_revision_events:0,positive_examples:0,pending_rules:0,active_rules:0,rejected_rules:0};
  status.package_security={contains_local_env:includeLocalEnv,contains_local_data:includeLocalData,outputs_included:false,internal_corpus_included:false,content_os_root_required:true};
  await fs.writeFile(statusPath,`${JSON.stringify(status,null,2)}\n`,'utf8');
}catch{}
await fs.rm(path.join(target,'growth_workbench','backups'),{recursive:true,force:true});
await fs.mkdir(path.join(target,'growth_workbench','backups'),{recursive:true});
await fs.rm(path.join(target,'growth_workbench','logs'),{recursive:true,force:true});
await fs.mkdir(path.join(target,'growth_workbench','logs'),{recursive:true});
await fs.rm(path.join(target,'growth_workbench','runtime'),{recursive:true,force:true});
await fs.mkdir(path.join(target,'growth_workbench','runtime'),{recursive:true});
await copy(path.join(root,'启动屿洁说干货工作台.bat'),path.join(target,'启动屿洁说干货工作台.bat'));
await copy(path.join(root,'诊断并启动.bat'),path.join(target,'诊断并启动.bat'));
await copy(path.join(root,'停止屿洁说干货工作台.bat'),path.join(target,'停止屿洁说干货工作台.bat'));

// 安全交付只包含 Workbench 代码与空白数据容器。Content OS 核心快照、内部语料和 PII
// 默认一律不复制；运行时必须通过 CONTENT_OS_ROOT 指向用户本机受控的 Content OS。
await fs.writeFile(path.join(target,'EXTERNAL_PACKAGE_NOTICE.txt'),[
  'Growth Workbench V0.1 安全交付说明',
  '',
  '本包默认不含 .env、API Key、真实脚本、用户反馈、Content OS 数据库快照或内部语料。',
  '运行前请复制 growth_workbench/.env.example 为 .env，并设置 CONTENT_OS_ROOT 指向本机受控的 Content OS 根目录。',
  '请勿把 API Key 写入准备外发的副本。',
  '仅限私有本机备份时，才可显式设置 INCLUDE_LOCAL_ENV=1 与 INCLUDE_LOCAL_DATA=1。'
].join('\r\n'),'utf8');

await fs.writeFile(path.join(target,'README.md'),[
  '# wenan',
  '',
  '屿洁说干货 Growth Workbench V0.1（安全协作版）。',
  '',
  '## 安全边界',
  '',
  '- 仓库不包含 `.env`、API Key、真实脚本、用户反馈、Content OS 数据库快照或内部语料。',
  '- `outputs/**`、`verified_internal`、Brand Thesis 治理逻辑和 Content Skill V0.5 均不在本仓库内修改。',
  '- Content Skill 固定为 `0.5.0 locked`；外部内容不会写入 `verified_internal`。',
  '',
  '## Windows 启动',
  '',
  '1. 安装 Node.js 20 或更高版本。',
  '2. 将 `growth_workbench/.env.example` 复制为 `growth_workbench/.env`。',
  '3. 在本机 `.env` 设置 `OPENROUTER_API_KEY` 与 `CONTENT_OS_ROOT`。',
  '4. 双击 `诊断并启动.bat`；停止时双击 `停止屿洁说干货工作台.bat`。',
  '5. 浏览器访问 `http://127.0.0.1:4310/`。',
  '',
  '安全协作版不会携带 Content OS 内部资产；未配置 `CONTENT_OS_ROOT` 时启动器会给出明确提示。',
  '',
  '## 研发验收',
  '',
  '```powershell',
  'cd growth_workbench',
  'npm test',
  '```',
  '',
  '主要审计入口：',
  '',
  '- `growth_workbench/src/feedback-flywheel.mjs`：反馈事件、语义候选、规则效果与置信度。',
  '- `growth_workbench/src/lin-composer.mjs`：规则/样本/证据注入、CTA 处理与生成留痕。',
  '- `growth_workbench/src/style-linter.mjs`：动态适用性评分。',
  '- `growth_workbench/test/flywheel-quality.mjs`：规则消融、复现率、CTA、版本配对和冷启动回归。',
  '- `PACKAGE_MANIFEST.json`：安全边界与关键文件哈希。',
  '',
  '## 协作规则',
  '',
  '- 不提交 `.env`、密钥、真实运行数据、日志、备份和内部语料。',
  '- 所有改动通过分支和 Pull Request 提交，避免直接改 `main`。',
  '- 本仓库停留在 V0.1，不在此分支引入 V0.2 功能。'
].join('\n'),'utf8');

await fs.writeFile(path.join(target,'.gitignore'),[
  '.env',
  '**/.env',
  'node_modules/',
  '**/node_modules/',
  'outputs/',
  'upload/',
  'dist/',
  '*.zip',
  'growth_workbench/data/',
  'growth_workbench/logs/',
  'growth_workbench/runtime/',
  'growth_workbench/backups/'
].join('\n')+'\n','utf8');

const windowsTextFiles=[
  '启动屿洁说干货工作台.bat','诊断并启动.bat','停止屿洁说干货工作台.bat','growth_workbench/start-workbench.bat','growth_workbench/stop-workbench.bat',
  'growth_workbench/scripts/windows-launcher.bat','growth_workbench/scripts/install-node.ps1'
];
for(const rel of windowsTextFiles){const p=path.join(target,rel);const text=(await fs.readFile(p,'utf8')).replace(/\r?\n/g,'\r\n');await fs.writeFile(p,text,'utf8')}

const required=[
  '启动屿洁说干货工作台.bat','诊断并启动.bat','停止屿洁说干货工作台.bat','growth_workbench/server.mjs','growth_workbench/scripts/windows-diagnose.mjs','growth_workbench/scripts/stop-workbench.mjs',
  'growth_workbench/src/lin-composer.mjs','growth_workbench/src/style-linter.mjs','growth_workbench/src/styled-script-service.mjs','growth_workbench/config/lin-style-pack.json','growth_workbench/config/lin-fewshot.json',
  'growth_workbench/src/feedback-flywheel.mjs','growth_workbench/.env.example'
];
const hashes={};
for(const rel of required){const data=await fs.readFile(path.join(target,rel));hashes[rel]=crypto.createHash('sha256').update(data).digest('hex')}
const manifest={
  package:packageName,
  version:'0.1.3',
  status:'GROWTH_WORKBENCH_V0.1_FLYWHEEL_RECTIFICATION_01',
  built_at:new Date().toISOString(),
  startup:'启动屿洁说干货工作台.bat',diagnostic_startup:'诊断并启动.bat',stop:'停止屿洁说干货工作台.bat',
  runtime:{node:'20+',npm_install_required:false,content_os_root_required:true},
  listen:'http://127.0.0.1:4310',
  security:{contains_local_env:includeLocalEnv,contains_local_data:includeLocalData,data_mode:includeLocalData?'private_local_data':'empty_external_template',distribution:(includeLocalEnv||includeLocalData)?'private_only':'shareable_without_api_key_or_user_data',internal_corpus_included:false,outputs_included:false},
  lin_style:{style_pack:'1.0.0',default_mode:'lin',pass_threshold:82,api_key_in_package:includeLocalEnv},
  feedback_flywheel:{schema_version:'feedback_flywheel_v2',rule_activation:'human_confirmation_required',verified_internal_effect:'none',content_os_schema_effect:'none'},
  content_os:{database_included:false,external_root_required:true,schema_migrated:false,verified_internal_modified:false,brand_thesis_governance_modified:false,content_skill:'0.5.0 locked'},
  required_file_hashes:hashes
};
const manifestText=`${JSON.stringify(manifest,null,2)}\n`;
await fs.writeFile(path.join(target,'PACKAGE_MANIFEST.json'),manifestText,'utf8');
console.log(target);

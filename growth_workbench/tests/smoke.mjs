import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'growth-workbench-smoke-')),port=4391,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve('growth_workbench'),env:{...process.env,WORKBENCH_PORT:String(port),WORKBENCH_DATA_DIR:temp,OPEN_BROWSER:'0'},stdio:['ignore','pipe','pipe']});
const request=async(p,options={})=>{const r=await fetch(base+p,{headers:{'content-type':'application/json'},...options});const data=await r.json();return {status:r.status,data}};
try{
  for(let i=0;i<50;i++){try{if((await request('/api/health')).status===200)break}catch{}await new Promise(r=>setTimeout(r,100));if(i===49)throw new Error('服务未启动')}
  const boot=await request('/api/bootstrap');if(boot.status!==200||boot.data.topics.length!==4)throw new Error('bootstrap失败');
  if(boot.data.system.content_skill!=='0.5.0 locked')throw new Error('Content Skill锁定状态错误');
  const blocked=await request('/api/topics',{method:'POST',body:JSON.stringify({title:'教学体系怎么做',customer_problem:'教学体系'})});if(blocked.status!==422)throw new Error('Topic Orientation Gate未阻止solution-first选题');
  const topicId=boot.data.topics[0].topic_id,generated=await request(`/api/topics/${topicId}/generate`,{method:'POST'});if(generated.status!==201||!generated.data.script_id)throw new Error('单稿生成失败');
  const review=await request(`/api/scripts/${generated.data.script_id}/review`,{method:'POST',body:JSON.stringify({decision:'直接拍'})});if(review.status!==201)throw new Error('人工审稿失败');
  const inspiration=await request('/api/inspirations',{method:'POST',body:JSON.stringify({platform:'抖音',content:'球馆客户来了却不成交，问题到底出在哪里？'})});if(inspiration.status!==201||inspiration.data.intelligence_type!=='external_inspiration')throw new Error('外部灵感隔离失败');
  const derived=await request(`/api/inspirations/${inspiration.data.inspiration_id}/create-topic`,{method:'POST'});if(derived.status!==201||derived.data.external_inspiration_id!==inspiration.data.inspiration_id)throw new Error('屿洁版原创选题生成失败');
  const knowledge=await request('/api/knowledge',{method:'POST',body:JSON.stringify({file_name:'smoke.txt',asset_type:'测试',base64:Buffer.from('test').toString('base64')})});if(knowledge.status!==201||knowledge.data.verified_internal_effect!=='none'||knowledge.data.parse_status!=='text_parse_complete')throw new Error('知识候选治理失败');
  const perf=await request('/api/performance',{method:'POST',body:JSON.stringify({topic_id:topicId,platform:'抖音',metrics_24h:{views:100}})});if(perf.status!==201||perf.data.intelligence_type!=='own_content_performance')throw new Error('表现数据隔离失败');
  console.log(JSON.stringify({status:'PASS',checks:9,modules:['Dashboard','Topic Pool','Content Studio','Review','Inspiration','Original Topic Derivation','Knowledge','Performance','Governance']},null,2));
}finally{
  child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));await fs.rm(temp,{recursive:true,force:true});
}

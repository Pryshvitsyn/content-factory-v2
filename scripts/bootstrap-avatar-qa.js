'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const manifest=require('../config/avatar-studio/avatar-qa-models.json');const root=path.resolve(process.cwd(),'.artifacts/models/avatar-qa');
async function download(url){const response=await fetch(url,{redirect:'follow'});if(!response.ok)throw new Error(`model download failed: HTTP ${response.status}`);return Buffer.from(await response.arrayBuffer());}
function command(bin,args) {
  return new Promise((resolve,reject) => {
    const child=spawn(bin,args,{stdio:'inherit'});
    child.on('error',reject);
    child.on('exit',(code) => {
      if(code===0) resolve(); else reject(new Error(`${bin} exited ${code}`));
    });
  });
}
async function main(){if(manifest.schemaVersion!==1)throw new Error('unsupported Avatar QA model manifest');await fs.mkdir(root,{recursive:true,mode:0o700});let previous={installed:[]};try{previous=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));}catch{}const venv=path.join(root,'venv-3.13');const python=path.join(venv,'bin','python');try{await fs.access(python);}catch{await command('python3.13',['-m','venv',venv]);}try{await command(python,['-c','import cv2']);}catch{await command(python,['-m','pip','install','--upgrade','--force-reinstall','opencv-python-headless==4.10.0.84']);}const installed=[];for(const model of manifest.models){if(!['MIT','Apache-2.0','BSD-3-Clause'].includes(model.license))throw new Error(`unapproved model license: ${model.id}`);const target=path.join(root,model.filename);let bytes;try{bytes=await fs.readFile(target);}catch{bytes=await download(model.url);if(bytes.length<1024)throw new Error(`model artifact is unexpectedly small: ${model.filename}`);await fs.writeFile(target,bytes,{mode:0o600});}const sha256=crypto.createHash('sha256').update(bytes).digest('hex'), expected=previous.installed?.find((item)=>item.id===model.id)?.sha256;if(expected&&expected!==sha256)throw new Error(`model SHA-256 mismatch: ${model.id}`);installed.push({...model,sha256,installedAt:new Date().toISOString(),expectedRuntime:'python3.13 + opencv-python-headless==4.10.0.84'});}await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,root,installed},null,2)+'\n',{mode:0o600});console.log(`Avatar QA models ready locally: ${installed.map((x)=>x.id).join(', ')}`);}
main().catch((error)=>{console.error(`[AVATAR_QA_BOOTSTRAP_FAILED] ${error.message}`);process.exitCode=1;});

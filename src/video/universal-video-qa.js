'use strict';
const crypto=require('node:crypto');

const QA_PROFILES=Object.freeze({
  BASE_VIDEO_QA:Object.freeze({includes:['TECHNICAL_METADATA','REQUEST_OUTPUT_CONTRACT','REPRESENTATIVE_FRAMES','CONTACT_SHEET']}),
  AVATAR_MOTION_QA:Object.freeze({extends:'BASE_VIDEO_QA',includes:['IDENTITY','FACE_GEOMETRY','BODY_GEOMETRY','POSE','MOTION_CONTINUITY','COMPOSITION']}),
  LOOP_CONTENT_QA:Object.freeze({extends:'BASE_VIDEO_QA',includes:['FIRST_LAST_COMPARISON','REPEATED_PREVIEW','LOOP_SEAM','LUMINANCE','BACKGROUND','DISPLACEMENT']}),
  AUDIO_VIDEO_QA:Object.freeze({extends:'BASE_VIDEO_QA',includes:['AUDIO_STREAM','AUDIO_VIDEO_DURATION','SYNCHRONIZATION']}),
});
function mismatch(code,message,expected,actual){return Object.freeze({code,message,expected,actual});}
function compareRequestToOutput({requestSnapshot,probe,contentType}={}){
  const request=requestSnapshot?.resolvedRequest||{},out=[];
  if(!probe.videoCodec)out.push(mismatch('VIDEO_STREAM_MISSING','Decoded output has no video stream','video stream',0));
  if(request.generateAudio===false&&probe.hasAudio)out.push(mismatch('UNEXPECTED_AUDIO_STREAM','Approved request disabled audio',0,1));
  if(request.generateAudio===true&&!probe.hasAudio)out.push(mismatch('AUDIO_CONTRACT_MISMATCH','Approved request required generated audio',1,0));
  if(request.outputFormat==='mp4'&&!['video/mp4','application/mp4'].includes(contentType))out.push(mismatch('OUTPUT_FORMAT_CONTRACT_MISMATCH','Output container differs from approved request','mp4',contentType));
  if(Number(request.duration)>0&&Math.abs(probe.durationMs-Number(request.duration)*1000)>1500)out.push(mismatch('VIDEO_DURATION_MISMATCH','Decoded duration differs materially from approved request',Number(request.duration)*1000,probe.durationMs));
  const ratios={'16:9':16/9,'9:16':9/16,'1:1':1,'4:3':4/3,'3:4':3/4},expected=ratios[request.aspectRatio],actual=probe.width&&probe.height?probe.width/probe.height:null;
  if(expected&&actual&&Math.abs(expected-actual)>.03)out.push(mismatch('RESOLUTION_CONTRACT_MISMATCH','Decoded geometry differs from approved aspect ratio',request.aspectRatio,`${probe.width}x${probe.height}`));
  if(!Number.isFinite(probe.fps)||probe.fps<=0)out.push(mismatch('FRAME_TIMING_IRREGULARITY','Decoded frame rate is unavailable or invalid','positive FPS',probe.fps));
  return Object.freeze(out);
}
async function universalVideoTechnicalQa({bytes,contentType='video/mp4',requestSnapshot,inspector}={}){
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw new Error('Immutable video bytes are required');if(!inspector?.inspect)throw new Error('A provider-independent media inspector is required');
  const probe=await inspector.inspect({bytes,contentType,kind:'video'}),mismatches=compareRequestToOutput({requestSnapshot,probe,contentType});
  return Object.freeze({profile:'BASE_VIDEO_QA',status:mismatches.length?'REVIEW_REQUIRED':'PASS',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),byteSize:bytes.length,contentType,technical:Object.freeze({container:contentType,videoCodec:probe.videoCodec,audioCodec:probe.audioCodec,width:probe.width,height:probe.height,durationMs:probe.durationMs,fps:probe.fps,hasAudio:probe.hasAudio,videoStreamCount:probe.videoCodec?1:0,audioStreamCount:probe.hasAudio?1:0,fileSize:probe.size}),requestFingerprint:requestSnapshot?.requestFingerprint||null,mismatches});
}
module.exports={QA_PROFILES,compareRequestToOutput,universalVideoTechnicalQa};

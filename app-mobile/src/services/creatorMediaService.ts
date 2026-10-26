import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

type Purpose='showcase'|'delivery'|'local_review'|'dispute_evidence';
type Intent={jobId:string;aspectWarning:boolean;upload:{tusEndpoint:string;libraryId:string;videoId:string;authorizationExpire:number;authorizationSignature:string}};
const uuid=()=>{const c=(globalThis as {crypto?:Crypto}).crypto;if(typeof c?.randomUUID==='function')return c.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,t=>{const n=Math.floor(Math.random()*16);return(t==='x'?n:(n&3)|8).toString(16);});};
const base64Ascii=(value:string)=>{const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';let out='';for(let i=0;i<value.length;i+=3){const a=value.charCodeAt(i),b=i+1<value.length?value.charCodeAt(i+1):NaN,c=i+2<value.length?value.charCodeAt(i+2):NaN;out+=chars[a>>2]+chars[((a&3)<<4)|(b>>4)]+(Number.isNaN(b)?'=':chars[((b&15)<<2)|(c>>6)])+(Number.isNaN(c)?'=':chars[c&63]);}return out;};
const resolveLocation=(base:string,location:string)=>{try{return new URL(location,base).toString();}catch{return location;}};

export async function chooseAndUploadCreatorMedia(input:{purpose:Purpose;contractId?:string|null;localMonthId?:string|null;onProgress:(fraction:number)=>void}):Promise<{jobId:string;aspectWarning:boolean}>{
  const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Videos,allowsEditing:false,videoMaxDuration:90,quality:1});
  if(picked.canceled||!picked.assets[0])throw new Error('No video selected.');
  const asset=picked.assets[0];const bytes=asset.fileSize??0;const durationSeconds=Math.max(0,(asset.duration??0)/1000);
  if(bytes<=0)throw new Error('We couldn’t read that video’s size. Choose it again.');
  if(bytes>157_286_400)throw new Error('Choose a video no larger than 150 MB.');
  if(durationSeconds<=0||durationSeconds>90)throw new Error('Choose a video up to 90 seconds.');
  const ownerKind=input.purpose==='local_review'?'local':'creator';
  const {data,error}=await supabase.functions.invoke<Intent>('creator-media-upload-intent',{body:{ownerKind,purpose:input.purpose,contractId:input.contractId??null,localMonthId:input.localMonthId??null,clientOperationId:uuid(),sourceBytes:bytes,durationSeconds,width:asset.width,height:asset.height}});
  if(error||!data?.upload)throw new Error(error?.message??'Creator uploads are not available yet.');
  const mime=asset.mimeType??'video/mp4';const fields={AuthorizationSignature:data.upload.authorizationSignature,AuthorizationExpire:String(data.upload.authorizationExpire),VideoId:data.upload.videoId,LibraryId:data.upload.libraryId};
  const create=await fetch(data.upload.tusEndpoint,{method:'POST',headers:{...fields,'Tus-Resumable':'1.0.0','Upload-Length':String(bytes),'Upload-Metadata':`filetype ${base64Ascii(mime)},title ${base64Ascii(`creator-media-job:${data.jobId}`)}`}});
  const location=create.headers.get('Location');if(!create.ok||!location)throw new Error('We couldn’t start the secure upload. Try again.');
  const uploadUrl=resolveLocation(data.upload.tusEndpoint,location);const {File}=await import('expo-file-system');const {fetch:expoFetch}=await import('expo/fetch');const handle=new File(asset.uri).open();
  try{let offset=0;const chunkSize=5*1024*1024;while(offset<bytes){handle.offset=offset;const body=handle.readBytes(Math.min(chunkSize,bytes-offset));const response=await expoFetch(uploadUrl,{method:'PATCH',headers:{...fields,'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body});if(response.status!==204)throw new Error(`Secure upload stopped (${response.status}). Try again.`);const next=Number(response.headers.get('Upload-Offset')??offset+body.byteLength);if(!Number.isFinite(next)||next<=offset)throw new Error('Secure upload did not advance. Try again.');offset=next;input.onProgress(Math.min(1,offset/bytes));}}
  finally{handle.close();}
  return {jobId:data.jobId,aspectWarning:data.aspectWarning};
}

export async function creatorMediaStatus(jobId:string):Promise<{status:string}>{
  const {data,error}=await supabase.functions.invoke<{status:string}>('creator-media-status',{body:{jobId}});
  if(error||!data)throw new Error(error?.message??'Couldn’t check the video.');
  return data;
}

export async function publicCreatorMedia(jobId:string):Promise<{playback:{url:string;expiresAt:string}}>{
  const {data,error}=await supabase.functions.invoke<{playback:{url:string;expiresAt:string}}>('creator-media-public',{body:{jobId}});
  if(error||!data?.playback?.url)throw new Error(error?.message??'This public video is not available.');
  return data;
}

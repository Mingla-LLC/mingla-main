import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { programEdge } from './programApi';
import { ProgramActionError } from './programResult';

type Purpose='showcase'|'delivery'|'local_review'|'dispute_evidence';
type Intent={jobId:string;aspectWarning:boolean;upload:{tusEndpoint:string;libraryId:string;videoId:string;authorizationExpire:number;authorizationSignature:string}};
const uuid=()=>{const c=(globalThis as {crypto?:Crypto}).crypto;if(typeof c?.randomUUID==='function')return c.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,t=>{const n=Math.floor(Math.random()*16);return(t==='x'?n:(n&3)|8).toString(16);});};
const base64Ascii=(value:string)=>{const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';let out='';for(let i=0;i<value.length;i+=3){const a=value.charCodeAt(i),b=i+1<value.length?value.charCodeAt(i+1):NaN,c=i+2<value.length?value.charCodeAt(i+2):NaN;out+=chars[a>>2]+chars[((a&3)<<4)|(b>>4)]+(Number.isNaN(b)?'=':chars[((b&15)<<2)|(c>>6)])+(Number.isNaN(c)?'=':chars[c&63]);}return out;};
const resolveLocation=(base:string,location:string)=>{try{return new URL(location,base).toString();}catch{return location;}};

export async function chooseAndUploadCreatorMedia(input:{purpose:Purpose;contractId?:string|null;localMonthId?:string|null;onProgress:(fraction:number)=>void}):Promise<{jobId:string;aspectWarning:boolean}>{
  const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Videos,allowsEditing:false,videoMaxDuration:90,quality:1});
  if(picked.canceled||!picked.assets[0])throw new ProgramActionError('picker_cancelled');
  const asset=picked.assets[0];const bytes=asset.fileSize??0;const durationSeconds=Math.max(0,(asset.duration??0)/1000);
  if(bytes<=0)throw new ProgramActionError('video_unreadable');
  if(bytes>157_286_400)throw new ProgramActionError('video_too_large');
  if(durationSeconds<=0||durationSeconds>90)throw new ProgramActionError('video_too_long');
  const ownerKind=input.purpose==='local_review'?'local':'creator';
  // media_capacity / media_unavailable come back as friendly ProgramActionErrors.
  const data=await programEdge<Intent>('creator-media-upload-intent',{ownerKind,purpose:input.purpose,contractId:input.contractId??null,localMonthId:input.localMonthId??null,clientOperationId:uuid(),sourceBytes:bytes,durationSeconds,width:asset.width,height:asset.height});
  if(!data?.upload)throw new ProgramActionError('media_unavailable');
  const mime=asset.mimeType??'video/mp4';const fields={AuthorizationSignature:data.upload.authorizationSignature,AuthorizationExpire:String(data.upload.authorizationExpire),VideoId:data.upload.videoId,LibraryId:data.upload.libraryId};
  const create=await fetch(data.upload.tusEndpoint,{method:'POST',headers:{...fields,'Tus-Resumable':'1.0.0','Upload-Length':String(bytes),'Upload-Metadata':`filetype ${base64Ascii(mime)},title ${base64Ascii(`creator-media-job:${data.jobId}`)}`}});
  const location=create.headers.get('Location');if(!create.ok||!location)throw new ProgramActionError('upload_failed');
  const uploadUrl=resolveLocation(data.upload.tusEndpoint,location);const {File}=await import('expo-file-system');const {fetch:expoFetch}=await import('expo/fetch');const handle=new File(asset.uri).open();
  try{let offset=0;const chunkSize=5*1024*1024;while(offset<bytes){handle.offset=offset;const body=handle.readBytes(Math.min(chunkSize,bytes-offset));const response=await expoFetch(uploadUrl,{method:'PATCH',headers:{...fields,'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body});if(response.status!==204)throw new ProgramActionError('upload_failed');const next=Number(response.headers.get('Upload-Offset')??offset+body.byteLength);if(!Number.isFinite(next)||next<=offset)throw new ProgramActionError('upload_failed');offset=next;input.onProgress(Math.min(1,offset/bytes));}}
  finally{handle.close();}
  return {jobId:data.jobId,aspectWarning:data.aspectWarning};
}

export type CreatorMediaStatus={jobId?:string;status:string;aspectWarning?:boolean;failureCode?:string|null;playback?:{url:string;expiresAt:string}|null};
export async function creatorMediaStatus(jobId:string):Promise<CreatorMediaStatus>{
  return programEdge<CreatorMediaStatus>('creator-media-status',{jobId});
}

/** Your own showcase videos (owner-read RLS), newest first. */
export async function myShowcaseMedia():Promise<Array<{id:string;status:string;created_at:string;aspect_warning:boolean|null}>>{
  const {data:auth}=await supabase.auth.getUser();const id=auth.user?.id;if(!id)return[];
  const {data,error}=await supabase.from('creator_media_jobs').select('id,status,created_at,aspect_warning').eq('owner_id',id).eq('purpose','showcase').is('deleted_at',null).order('created_at',{ascending:false}).limit(6);
  if(error)return[];
  return (data??[]) as Array<{id:string;status:string;created_at:string;aspect_warning:boolean|null}>;
}

export async function publicCreatorMedia(jobId:string):Promise<{playback:{url:string;expiresAt:string};thumbnail?:string|null}>{
  const data=await programEdge<{playback?:{url:string;expiresAt:string};thumbnail?:string|null}>('creator-media-public',{jobId});
  if(!data?.playback?.url)throw new ProgramActionError('media_unavailable');
  return {playback:data.playback,thumbnail:data.thumbnail??null};
}

/** True when the person just closed the picker without choosing. */
export function isPickerCancel(error:unknown):boolean{return error instanceof ProgramActionError&&error.code==='picker_cancelled';}

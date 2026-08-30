export type PreparedEventCoverVideoSource = {
  uri: string; bytes: number; durationMs: number; fileName: string; mimeType: string;
  extension: "mp4" | "mov" | "m4v"; sha256: string; fingerprint: string;
};

const allowed = new Map<string, PreparedEventCoverVideoSource["extension"]>([
  ["video/mp4", "mp4"], ["video/quicktime", "mov"], ["video/x-m4v", "m4v"],
]);
const K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];
const rotr = (x:number,n:number):number => (x>>>n)|(x<<(32-n));
class Sha256 {
  private h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  private pending:number[]=[]; private total=0;
  update(bytes:Uint8Array):void { this.total+=bytes.length; for(const byte of bytes){this.pending.push(byte);if(this.pending.length===64)this.block(this.pending.splice(0,64));} }
  private block(b:number[]):void { const w=new Array<number>(64); for(let i=0;i<16;i++)w[i]=((b[i*4]<<24)|(b[i*4+1]<<16)|(b[i*4+2]<<8)|b[i*4+3])|0; for(let i=16;i<64;i++){const a=w[i-15],c=w[i-2];w[i]=(w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-7]+(rotr(c,17)^rotr(c,19)^(c>>>10)))|0;} let [a,c,d,e,f,g,h,i]=this.h; for(let j=0;j<64;j++){const t1=(i+(rotr(f,6)^rotr(f,11)^rotr(f,25))+((f&g)^(~f&h))+K[j]+w[j])|0;const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&c)^(a&d)^(c&d)))|0;i=h;h=g;g=f;f=(e+t1)|0;e=d;d=c;c=a;a=(t1+t2)|0;} this.h=[a,c,d,e,f,g,h,i].map((v,j)=>(v+this.h[j])|0); }
  digest():string { const bits=this.total*8; this.pending.push(0x80); while(this.pending.length%64!==56)this.pending.push(0); for(let i=7;i>=0;i--)this.pending.push(Math.floor(bits/2**(i*8))&255); while(this.pending.length)this.block(this.pending.splice(0,64)); return this.h.map(v=>(v>>>0).toString(16).padStart(8,"0")).join(""); }
}

export const prepareEventCoverVideoSource = async (input: {
  uri:string; bytes:number; durationMs:number; fileName?:string|null; mimeType?:string|null; operationId:string;
}):Promise<PreparedEventCoverVideoSource> => {
  const mimeType=String(input.mimeType??"").toLowerCase(); const extension=allowed.get(mimeType);
  const named=input.fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if(!extension||named!==extension)throw new Error("video_source_type_unknown");
  const FileSystem=await import("expo-file-system/legacy"); const base=FileSystem.cacheDirectory;
  if(typeof base!=="string")throw new Error("video_storage_unavailable");
  const destination=`${base}event-cover-${input.operationId}.${extension}`;
  if(input.uri!==destination){try{await FileSystem.deleteAsync(destination,{idempotent:true});}catch{} await FileSystem.copyAsync({from:input.uri,to:destination});}
  const {File}=await import("expo-file-system"); const file=new File(destination); const handle=file.open(); const sha=new Sha256(); let size=0;
  try { while(true){const chunk=handle.readBytes(1024*1024);if(chunk.length===0)break;sha.update(chunk);size+=chunk.length;} } finally { handle.close(); }
  if(size<=0||size!==input.bytes)throw new Error("video_source_size_changed"); const sha256=sha.digest();
  return {uri:destination,bytes:size,durationMs:input.durationMs,fileName:input.fileName!,mimeType,extension,sha256,fingerprint:`${sha256}:${size}`};
};

export const deletePreparedEventCoverVideoSource = async (uri:string):Promise<void> => {
  const FileSystem=await import("expo-file-system/legacy");
  const base=FileSystem.cacheDirectory;
  if(typeof base!=="string"||!uri.startsWith(`${base}event-cover-`))return;
  await FileSystem.deleteAsync(uri,{idempotent:true});
};

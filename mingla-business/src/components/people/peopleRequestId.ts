import "react-native-get-random-values";

export function createPeopleRequestId():string{
  const cryptoValue=(globalThis as {crypto?:{randomUUID?:()=>string;getRandomValues?:<T extends ArrayBufferView|null>(array:T)=>T}}).crypto;
  if(typeof cryptoValue?.randomUUID==="function")return cryptoValue.randomUUID();
  if(typeof cryptoValue?.getRandomValues!=="function")throw new Error("secure_random_unavailable");
  const bytes=cryptoValue.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40; bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,(byte)=>byte.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

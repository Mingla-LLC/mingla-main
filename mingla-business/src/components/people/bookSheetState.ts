export type BookSheetViewMode="forbidden"|"loading"|"error"|"offlineEmpty"|"empty"|"rows";
export function resolveBookSheetView(input:{kind:string;rowCount:number;hasSearch:boolean;bookTotal:number|null;filteredTotal:number|null}):{mode:BookSheetViewMode;subtitle:string;status:string|null}{
  if(input.kind==="forbidden")return{mode:"forbidden",subtitle:"",status:null};
  if((input.kind==="authLoading"||input.kind==="roleLoading"||input.kind==="loading")&&input.rowCount===0)return{mode:"loading",subtitle:input.hasSearch?"Searching…":"Loading your book…",status:null};
  if(input.kind==="offlineEmpty"&&input.rowCount===0)return{mode:"offlineEmpty",subtitle:"",status:null};
  if(input.kind==="error"&&input.rowCount===0)return{mode:"error",subtitle:"",status:null};
  if(input.rowCount===0)return{mode:"empty",subtitle:input.hasSearch?`${input.filteredTotal??0} matches`:`${input.bookTotal??0} contacts`,status:null};
  const status=input.kind==="offlineStale"?"Offline — showing saved contacts.":input.kind==="staleError"?"Couldn’t update — showing saved contacts.":input.kind==="refreshing"?"Updating…":null;
  return{mode:"rows",subtitle:input.hasSearch&&input.filteredTotal!==null?`${input.filteredTotal} matches`:input.bookTotal!==null?`${input.bookTotal} contacts`:"",status};
}

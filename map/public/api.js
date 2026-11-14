let origin='';
export async function configureApi(){
  const response=await fetch('/api-config.json',{cache:'no-store'});
  if(response.ok){const config=await response.json();origin=config.apiOrigin||'';}
}
export function apiUrl(path){return origin+path;}

// Copied into the versioned Chatwoot source by the frontend patch workflow.
export function createLocaleLoader({bundled,loaders}){
 const pending=new Map(),selections=new WeakMap();
 return async(target,locale)=>{
  if(!locale)return false;
  const selection=Symbol(locale);selections.set(target,selection);
  if(Object.prototype.hasOwnProperty.call(bundled,locale)){target.locale=locale;return true;}
  if(!Object.prototype.hasOwnProperty.call(loaders,locale))return false;
  let promise=pending.get(locale);
  if(!promise){
   promise=Promise.resolve().then(()=>loaders[locale]()).then(module=>{
    const messages=module.default;
    if(!messages||typeof messages!=='object'||Array.isArray(messages))throw Error('Invalid language resource');
    return messages;
   }).catch(error=>{pending.delete(locale);throw error;});
   pending.set(locale,promise);
  }
  const messages=await promise;
  if(selections.get(target)!==selection)return false;
  target.setLocaleMessage(locale,messages);target.locale=locale;return true;
 };
}

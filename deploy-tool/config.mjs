import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function loadConfig(filename=path.join(path.dirname(fileURLToPath(import.meta.url)),'local-config.json'),env=process.env){
 const local=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):{};
 if(!local||typeof local!=='object'||Array.isArray(local))throw Error('Invalid local deployment config');
 return {...local,workbench:env.WORKBENCH||local.workbench||'workbench',healthHost:env.DOON_DEPLOY_HEALTH_HOST||local.healthHost||'127.0.0.1:8787'};
}
export function validateConfig(config){
 for(const key of ['instance','region'])if(typeof config[key]!=='string'||!/^[A-Za-z0-9-]+$/.test(config[key]))throw Error('请在本地部署配置或向导中填写 '+key);
 for(const key of ['releasesDir','dropinDir','nodeBin','envFile','dataDir']){
  const value=config[key];
  if(typeof value!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(value)||value.split('/').some(part=>part==='.'||part==='..')||value.endsWith('/'))throw Error('请在 local-config.json 中配置安全的绝对路径：'+key);
 }
 if(path.posix.dirname(config.releasesDir)==='/')throw Error('版本目录不能直接位于文件系统根目录');
 if(typeof config.service!=='string'||!/^[A-Za-z0-9_.-]+\.service$/.test(config.service))throw Error('请配置有效的 systemd 服务名');
 if(typeof config.healthHost!=='string'||!/^[A-Za-z0-9.:[\]-]+$/.test(config.healthHost))throw Error('请配置有效的健康检查 Host');
 return config;
}

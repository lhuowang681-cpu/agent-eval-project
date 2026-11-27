// Node-only harness resolver: installed validator's genuine CJS implementation.
// No auth/DB/procedure mocking and no node_modules edits.
const Module=require('node:module');const original=Module._load;
Module._extensions['.md']=(mod,filename)=>{mod.exports=require('node:fs').readFileSync(filename,'utf8');};
Module._load=function(name,parent,...rest){
 if(name==='path-browserify-esm')name=require('node:path').resolve(__dirname,'../../../platform/packages/builtin-tool-local-system/node_modules/path-browserify-esm/index.esm.js');
 if(name==='@lobehub/analytics/server')name=require('node:path').resolve(__dirname,'../../../platform/node_modules/@lobehub/analytics/dist/server.js');
 const match=/^validator\/es\/lib\/([A-Za-z]+)(?:\.cjs|\.js)?$/.exec(name);
 return original.call(this,match?'validator/lib/'+match[1]+'.js':name,parent,...rest);
};

import {pathToFileURL} from 'node:url';
export function resolve(specifier,context,next){
 if(specifier==='three')return {url:process.env.THREE_MODULE?pathToFileURL(process.env.THREE_MODULE).href:new URL('../vendor/three.module.js',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}

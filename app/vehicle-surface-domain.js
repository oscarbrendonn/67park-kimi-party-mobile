import {createCityHeightSampler58} from '../island/city-height-sampler58.js';

// Only public asphalt and its exterior sidewalk carrier. Parcel floors,
// promenades, lawns and sand are deliberately NOT driving surfaces.
const permitted=new Set(['5_YOL','6_BORDUR','7_KALDIRIM_TABANI']);
export function createVehicleSurfaceDomain(terrain){
 const floors=[],exclusions=[];
 terrain.updateWorldMatrix(true,true);
 terrain.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  if(permitted.has(mesh.name))floors.push(mesh);
  else if(/^(3_.*CIM|3_CIM|5_PARSEL|7_MERKEZ|8_PARK|9_PARK|9_GOLET|67D_REF_HILL)/.test(mesh.name))exclusions.push(mesh);
 });
 if(!floors.some(m=>m.name==='5_YOL')||!floors.some(m=>m.name==='7_KALDIRIM_TABANI'))throw Error('Vehicle road/sidewalk geometry missing');
 const allowed=createCityHeightSampler58(floors);
 const denied=exclusions.length?createCityHeightSampler58(exclusions):null;
 return {
  height(x,z){
   const y=allowed.height(x,z);if(y==null)return null;
   const forbidden=denied?.height(x,z);
   return forbidden!=null&&forbidden>=y-.025?null:y;
  },
  stats:{allowed: floors.map(m=>m.name),excluded:exclusions.map(m=>m.name),triangles:allowed.stats.triangles}
 };
}

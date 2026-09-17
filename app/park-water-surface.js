// Park pond uses the same palette, moving surface and swimmer wake as the coast.
// The authored pond mesh supplies its boundary; the ocean's land mask must not clip it.
export function applyParkWaterSurface(world) {
  if (world.parkWaterSurface) return world.parkWaterSurface;
  const ocean = world.scene?.getObjectByName('KIMI_WATERBODY_GORUNUR');
  const pond = world.terrain?.getObjectByName('67D_PARK_WATER_UNIFIED_V65');
  if (!ocean?.material?.isShaderMaterial || !pond?.isMesh) return null;
  const source = ocean.material;
  const mask = /if\(all\(greaterThanEqual\(uv,vec2\(0\.\)\)\)&&all\(lessThanEqual\(uv,vec2\(1\.\)\)\)&&texture2D\(uLand,uv\)\.r>\.5\)discard;/;
  if (!mask.test(source.fragmentShader)) throw Error('Park water: coast shader mask changed');
  const original = pond.material;
  const material = source.clone();
  material.name = '67P_PARK_WATER_COAST_SURFACE';
  // Share the existing clock/player uniforms. No extra loop, texture or audio/physics changes.
  material.uniforms = {...source.uniforms};
  material.fragmentShader = source.fragmentShader.replace(mask, '');
  // Pond geometry is authored in XYZ, unlike the rotated XY ocean plane.
  // Keep the shoreline level exact and obtain wave detail from the shared fragment shader.
  material.vertexShader = `varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  material.needsUpdate = true;
  pond.material = material;
  const report = {version:'park-water-3',mesh:pond.name,source:ocean.name,
    sharedWaves:true,sharedSwimmerWake:true,geometryUnchanged:true,extraDrawCalls:0};
  world.parkWaterSurface = report;
  world.renderer.domElement.dataset.parkWaterSurface = JSON.stringify(report);
  const dispose = world.dispose?.bind(world);
  if (dispose) world.dispose = () => {
    pond.material = original; material.dispose(); delete world.parkWaterSurface; dispose();
  };
  return report;
}

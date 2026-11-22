import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3-geo@3.1.0/+esm";
import { feature as topoFeature, merge as topoMerge } from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";

const canvas=document.getElementById("globe");
const label=document.getElementById("globe-label");
const backButton=document.getElementById("globe-back");
const mapHeading=document.getElementById("map-heading");
const mapCredit=document.getElementById("map-credit");
const journal=window.ANDY_JOURNAL;
const aliases={"United States":"United States of America","Czech Republic":"Czechia","South Korea":"South Korea","North Korea":"North Korea"};
const normalizeName=name=>aliases[name]||name;
const visited=new Set((journal?.places||[]).map(p=>normalizeName(p.n)));

// Keep the published names intact while assigning broad geographic regions.
const europeNames=new Set("Albania|Andorra|Austria|Belarus|Belgium|Bosnia and Herz.|Bulgaria|Croatia|Cyprus|Czechia|Denmark|Estonia|Finland|France|Germany|Greece|Hungary|Iceland|Ireland|Italy|Kosovo|Latvia|Liechtenstein|Lithuania|Luxembourg|Malta|Moldova|Monaco|Montenegro|Netherlands|North Macedonia|Norway|Poland|Portugal|Romania|Russia|San Marino|Serbia|Slovakia|Slovenia|Spain|Sweden|Switzerland|Turkey|Ukraine|United Kingdom|Vatican City".split("|"));
const asiaNames=new Set("Afghanistan|Armenia|Azerbaijan|Bahrain|Bangladesh|Bhutan|Brunei|Cambodia|China|Cyprus|Georgia|India|Indonesia|Iran|Iraq|Israel|Japan|Jordan|Kazakhstan|Kuwait|Kyrgyzstan|Laos|Lebanon|Malaysia|Maldives|Mongolia|Myanmar|Nepal|North Korea|Oman|Pakistan|Palestine|Philippines|Qatar|Russia|Saudi Arabia|Singapore|South Korea|Sri Lanka|Syria|Taiwan|Tajikistan|Thailand|Timor-Leste|Turkey|Turkmenistan|United Arab Emirates|Uzbekistan|Vietnam|Yemen".split("|"));
const oceaniaNames=new Set("Australia|Fiji|Kiribati|Marshall Is.|Micronesia|Nauru|New Caledonia|New Zealand|Palau|Papua New Guinea|Samoa|Solomon Is.|Tonga|Tuvalu|Vanuatu|N. Mariana Is.".split("|"));

function continentForFeature(f){
  const name=f.properties?.name||"";
  if(name==="Greenland")return "North America";
  if(europeNames.has(name)&&asiaNames.has(name))return "Europe";
  if(europeNames.has(name))return "Europe";
  if(asiaNames.has(name))return "Asia";
  if(oceaniaNames.has(name))return "Oceania";
  const info=featureGeoInfo.get(f)||{bounds:d3.geoBounds(f),centroid:d3.geoCentroid(f)};
  const [[west,south],[east,north]]=info.bounds,[lon,lat]=info.centroid;
  if(lat<-68)return "Antarctica";
  if(lat>-37&&lat<38&&lon>-20&&lon<55)return "Africa";
  if(lat>-58&&lat<15&&lon>-83&&lon<-30)return "South America";
  if(lat>5&&lat<84&&lon>-172&&lon<-35)return "North America";
  if(lat>-48&&lat<0&&lon>108&&lon<180)return "Oceania";
  if(lon>25&&lon<180&&lat>-15&&lat<84)return "Asia";
  if(lon>-32&&lon<62&&lat>34&&lat<84)return "Europe";
  if(west>110&&east<180&&south>-50&&north<0)return "Oceania";
  return "Other";
}
function belongsTo(f,continent){
  const name=f.properties?.name||"";
  if((name==="Russia"||name==="Turkey"||name==="Cyprus")&&(continent==="Europe"||continent==="Asia"))return true;
  return continentForFeature(f)===continent;
}
function continentAtCountry(f,lon){
  const name=f?.properties?.name||"";
  if(name==="Russia")return lon<60?"Europe":"Asia";
  if(name==="Turkey")return lon<35?"Europe":"Asia";
  if(name==="Greenland")return "North America";
  return continentForFeature(f);
}
function visitedFeature(f){return visited.has(normalizeName(f.properties?.name||""))}
function showLabel(title,sub){label.querySelector("strong").textContent=title||"";label.querySelector("span").textContent=sub||"";label.classList.toggle("visible",!!title)}

const globeScene=new THREE.Scene();
const earthGroup=new THREE.Group();
// Center Europe and Asia on the front of the globe at startup.
earthGroup.rotation.set(THREE.MathUtils.degToRad(32),-Math.PI/2-THREE.MathUtils.degToRad(70),0);
globeScene.add(earthGroup);
globeScene.add(new THREE.HemisphereLight(0xf5f0e3,0x45483d,2.0));
const keyLight=new THREE.DirectionalLight(0xfff5e4,3.1);keyLight.position.set(-3,2.8,4);globeScene.add(keyLight);
const fillLight=new THREE.DirectionalLight(0x8d9b8d,.55);fillLight.position.set(3,-1,-3);globeScene.add(fillLight);
const camera=new THREE.PerspectiveCamera(34,1,.1,50);camera.position.set(0,0,3.45);
let renderer,earthMesh=null,features=[],topologyData=null,topologyGeometryByName=new Map(),featureGeoInfo=new WeakMap(),continentGroups=new Map(),visitedMeshes=new Map(),currentMap=null;
let hoveredContinent=null,hoveredCountry=null,drag=null,velocityX=0,velocityY=0,lastFrame=0,mode="globe",transition=null,regionRayTargets=[];
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();

function globePoint(lon,lat,radius){
  const la=THREE.MathUtils.degToRad(lat),lo=THREE.MathUtils.degToRad(lon),c=Math.cos(la);
  return new THREE.Vector3(radius*c*Math.cos(lo),radius*Math.sin(la),-radius*c*Math.sin(lo));
}
function makeShape(rings,project){
  if(!rings?.length||rings[0].length<4)return null;
  const shape=new THREE.Shape();
  function trace(path,ring){
    ring.forEach(([lon,lat],i)=>{const [x,y]=project(lon,lat);if(i===0)path.moveTo(x,y);else path.lineTo(x,y)});path.closePath();
  }
  trace(shape,rings[0]);
  for(const ring of rings.slice(1)){if(ring.length<4)continue;const hole=new THREE.Path();trace(hole,ring);shape.holes.push(hole)}
  return shape;
}
function addRingLines(group,rings,radius,material){
  rings.forEach(ring=>{
    const points=ring.map(([lon,lat])=>globePoint(lon,lat,radius));
    const geometry=new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.LineLoop(geometry,material));
  });
}
function addCountryBorders(group,featureList,radius,material){
  const points=[];
  featureList.forEach(f=>{
    const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
    polys.forEach(poly=>poly.forEach(ring=>{for(let i=0;i<ring.length-1;i++){points.push(globePoint(ring[i][0],ring[i][1],radius),globePoint(ring[i+1][0],ring[i+1][1],radius))}}));
  });
  if(points.length)group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),material));
}
function makeSphericalPolygon(rings,radius,height,material,glowColor){
  const group=new THREE.Group();
  const outer=rings[0];
  if(!outer||outer.length<4)return group;
  const centerLon=outer.reduce((a,c)=>a+c[0],0)/outer.length;
  const unwrapped=rings.map(ring=>{
    let prev=ring[0]?.[0]||0;
    return ring.map(([rawLon,lat])=>{let lon=rawLon;while(lon-prev>180)lon-=360;while(lon-prev< -180)lon+=360;while(lon-centerLon>180)lon-=360;while(lon-centerLon< -180)lon+=360;prev=lon;return [lon,lat]});
  });
  const shape=makeShape(unwrapped,(lon,lat)=>[lon,lat]);
  if(!shape)return group;
  const flat=new THREE.ShapeGeometry(shape,1),flatPos=flat.attributes.position,flatIndex=flat.index;
  const sphericalPositions=[],maxAngle=THREE.MathUtils.degToRad(height<.008?2.5:1.4);
  const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  function addTriangle(a,b,c,depth=0){
    const va=globePoint(a[0],a[1],1),vb=globePoint(b[0],b[1],1),vc=globePoint(c[0],c[1],1);
    const longest=Math.max(va.angleTo(vb),vb.angleTo(vc),vc.angleTo(va));
    if(longest>maxAngle&&depth<8){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);addTriangle(a,ab,ca,depth+1);addTriangle(ab,b,bc,depth+1);addTriangle(ca,bc,c,depth+1);addTriangle(ab,bc,ca,depth+1);return}
    for(const point of [a,b,c]){const v=globePoint(point[0],point[1],radius+height);sphericalPositions.push(v.x,v.y,v.z)}
  }
  const triangles=flatIndex?flatIndex.array:Array.from({length:flatPos.count},(_,i)=>i);
  for(let i=0;i<triangles.length;i+=3){const a=triangles[i],b=triangles[i+1],c=triangles[i+2];addTriangle([flatPos.getX(a),flatPos.getY(a)],[flatPos.getX(b),flatPos.getY(b)],[flatPos.getX(c),flatPos.getY(c)])}
  flat.dispose();
  const top=new THREE.BufferGeometry();top.setAttribute("position",new THREE.Float32BufferAttribute(sphericalPositions,3));top.computeVertexNormals();group.add(new THREE.Mesh(top,material));
  const sidePositions=[];
  unwrapped.forEach(ring=>{for(let i=0;i<ring.length-1;i++){
    const a=globePoint(ring[i][0],ring[i][1],radius),b=globePoint(ring[i+1][0],ring[i+1][1],radius),c=globePoint(ring[i+1][0],ring[i+1][1],radius+height),d=globePoint(ring[i][0],ring[i][1],radius+height);
    sidePositions.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,a.x,a.y,a.z,c.x,c.y,c.z,d.x,d.y,d.z);
  }});
  if(sidePositions.length){const sideGeo=new THREE.BufferGeometry();sideGeo.setAttribute("position",new THREE.Float32BufferAttribute(sidePositions,3));sideGeo.computeVertexNormals();group.add(new THREE.Mesh(sideGeo,material))}
  const edgeMaterial=new THREE.LineBasicMaterial({color:glowColor||0x71684e,transparent:true,opacity:.9});
  addRingLines(group,unwrapped,radius+height+.001,edgeMaterial);
  return group;
}
function countryMaterial(isVisited,hover=false){
  return new THREE.MeshStandardMaterial({color:isVisited?(hover?0xc6b487:0x909879):0xd1cdbf,emissive:isVisited?0x4a503e:0x000000,emissiveIntensity:isVisited?(hover?.28:.10):0,roughness:.78,metalness:0,side:THREE.DoubleSide});
}
function disposeObject(root){
  const geometries=new Set(),materials=new Set();
  root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material){for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material)}});
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
}
function buildTexture(){
  const map=document.createElement("canvas");map.width=2048;map.height=1024;
  const ctx=map.getContext("2d");ctx.fillStyle="#77796c";ctx.fillRect(0,0,map.width,map.height);
  const projection=d3.geoEquirectangular().scale(map.width/(2*Math.PI)).translate([map.width/2,map.height/2]);
  const path=d3.geoPath(projection,ctx);
  features.forEach(f=>{
    ctx.beginPath();path(f);ctx.fillStyle=visitedFeature(f)?"#8d9677":"#d8d4c8";ctx.fill("evenodd");ctx.strokeStyle="#938d7e";ctx.lineWidth=.75;ctx.stroke();
  });
  ctx.beginPath();path(d3.geoGraticule10());ctx.strokeStyle="rgba(79,76,66,.16)";ctx.lineWidth=.7;ctx.stroke();
  const texture=new THREE.CanvasTexture(map);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();texture.needsUpdate=true;return texture;
}
function buildGlobe(){
  const texture=buildTexture();
  earthMesh=new THREE.Mesh(new THREE.SphereGeometry(1,128,96),new THREE.MeshPhysicalMaterial({color:0xffffff,map:texture,roughness:.72,metalness:.02,clearcoat:.18,clearcoatRoughness:.72}));
  earthMesh.userData.isEarth=true;earthGroup.add(earthMesh);
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.018,96,64),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,uniforms:{glow:{value:new THREE.Color("#a9ad96")}},vertexShader:"varying vec3 vNormal; void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"uniform vec3 glow; varying vec3 vNormal; void main(){float rim=pow(0.72-max(dot(normalize(vNormal),vec3(0.0,0.0,1.0)),0.0),3.0);gl_FragColor=vec4(glow,clamp(rim*0.22,0.0,0.18));}"}));
  earthGroup.add(atmosphere);
  features.forEach(f=>{
    if(!visitedFeature(f))return;
    const name=f.properties?.name;if(!name)return;
    const group=new THREE.Group();group.userData.country=name;
    const base=1.0,height=.009;
    const material=countryMaterial(true);
    const geometries=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
    geometries.forEach(poly=>group.add(makeSphericalPolygon(poly,base,height,material,0xb4a174)));
    group.userData.baseScale=1;earthGroup.add(group);visitedMeshes.set(name,group);
  });
}
function countryAt(lon,lat){
  const candidates=features.filter(f=>{
    const [[w,s],[e,n]]=(featureGeoInfo.get(f)||{bounds:d3.geoBounds(f)}).bounds;return lat>=s-.3&&lat<=n+.3&&(w<=e?lon>=w-.3&&lon<=e+.3:lon>=w-.3||lon<=e+.3);
  });
  return candidates.find(f=>d3.geoContains(f,[lon,lat]))||null;
}
function clearVisitedHover(){
  if(hoveredCountry&&visitedMeshes.has(hoveredCountry))visitedMeshes.get(hoveredCountry).scale.setScalar(1);
  hoveredCountry=null;
}
function clearGlobeHover(){
  setHoveredContinent(null);clearVisitedHover();showLabel("","");
}
function projectCountryCoordinate(projection,centerLon,lon,lat){
  let adjusted=lon;while(adjusted-centerLon>180)adjusted-=360;while(adjusted-centerLon< -180)adjusted+=360;
  const [x,y]=projection([adjusted,lat]);return [x,-y];
}
function flatCountryGroup(f,projection,centerLon){
  const name=f.properties?.name||"",isVisited=visitedFeature(f),group=new THREE.Group();group.userData.feature=f;group.userData.country=name;group.userData.visited=isVisited;
  const height=isVisited?2.0:.18;
  const material=new THREE.MeshStandardMaterial({color:isVisited?0x879173:0xd7d3c8,emissive:isVisited?0x303827:0x000000,emissiveIntensity:isVisited?.16:0,roughness:.84,side:THREE.DoubleSide});
  const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
  polys.forEach(rings=>{
    const projected=rings.map(ring=>ring.map(([lon,lat])=>projectCountryCoordinate(projection,centerLon,lon,lat)));
    const shape=makeShape(projected,(x,y)=>[x,y]);if(!shape)return;
    const geo=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:1});geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,material);mesh.userData.feature=f;group.add(mesh);
    projected.forEach(ring=>{
      const pts=ring.map(([x,y])=>new THREE.Vector3(x,y,height+.12));
      const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:isVisited?0x766b4c:0x918c80,transparent:true,opacity:isVisited?.86:.7}));
      line.userData.isBorder=true;line.userData.baseOpacity=isVisited?.86:.7;group.add(line);
      if(isVisited){const halo=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map(([x,y])=>new THREE.Vector3(x,y,height+.3))),new THREE.LineBasicMaterial({color:0xb9a474,transparent:true,opacity:.16}));halo.userData.isBorder=true;halo.userData.baseOpacity=.16;group.add(halo)}
    });
  });
  return group;
}
function mapProjection(continent,w,h){
  const config={
    Europe:{center:[17,53],lat:53,lon:17,scale:Math.min(w/1.35,h/1.0)*.9},
    Asia:{center:[100,35],lat:35,lon:100,scale:Math.min(w/2.8,h/2.75)*.9},
    Africa:{center:[20,2],lat:2,lon:20,scale:Math.min(w/1.35,h/1.35)*.9},
    "North America":{center:[-102,42],lat:42,lon:-102,scale:Math.min(w/2.2,h/1.42)*.86},
    "South America":{center:[-60,-15],lat:-15,lon:-60,scale:Math.min(w/1.6,h/2.3)*.88},
    Oceania:{center:[135,-24],lat:-24,lon:135,scale:Math.min(w/1.95,h/1.45)*.88},
    Antarctica:{center:[0,-82],lat:-82,lon:0,scale:Math.min(w/5.4,h/1.6)*.9},
    Other:{center:[0,0],lat:0,lon:0,scale:Math.min(w/2.5,h/1.8)*.8}
  }[continent]||{center:[0,0],lat:0,lon:0,scale:Math.min(w/2.5,h/1.8)*.8};
  const projection=continent==="Antarctica"?d3.geoNaturalEarth1():d3.geoMercator();
  return projection.center(config.center).scale(config.scale).translate([w/2,h/2]);
}
function buildRegionMap(continent){
  const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;
  const scene=new THREE.Scene();scene.background=new THREE.Color("#f2f1ee");
  scene.add(new THREE.AmbientLight(0xffffff,2.0));const light=new THREE.DirectionalLight(0xffffff,2.4);light.position.set(-w*.25,h*.55,500);scene.add(light);
  const water=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({color:0xc8cbc1,roughness:.94}));water.position.z=-3;scene.add(water);
  const projection=mapProjection(continent,w,h),centerLon=projection.invert([w/2,h/2])[0];
  const selected=features.filter(f=>belongsTo(f,continent));
  const group=new THREE.Group();regionRayTargets=[];
  selected.forEach(f=>{const country=flatCountryGroup(f,projection,centerLon);country.children.forEach(child=>{if(child.isMesh)regionRayTargets.push(child)});group.add(country)});
  scene.add(group);
  const camera=new THREE.OrthographicCamera(-w/2,w/2,h/2,-h/2,.1,1000);camera.position.set(0,0,600);camera.lookAt(0,0,0);
  return {scene,camera,group,projection,continent};
}
function enterRegion(continent){
  if(!continent)return;
  clearGlobeHover();
  mode="transition-in";transition={start:performance.now(),from:earthGroup.scale.x,to:1.65};
  currentMap=buildRegionMap(continent);mapHeading.textContent=continent;mapHeading.hidden=false;mapCredit.hidden=false;backButton.hidden=false;
  const isExplored=(journal?.places||[]).some(p=>p.continent===continent);
  showLabel(continent.toUpperCase(),isExplored?"EXPLORED CONTINENT":"YET TO EXPLORE");
  setTimeout(()=>{if(mode==="transition-in"){mode="map";earthGroup.scale.setScalar(1.65)}},480);
}
function returnToGlobe(){
  mode="transition-out";transition={start:performance.now(),from:earthGroup.scale.x,to:1};clearRegionHover();if(currentMap)disposeObject(currentMap.scene);currentMap=null;regionRayTargets=[];
  mapHeading.hidden=true;mapCredit.hidden=true;backButton.hidden=true;hoveredCountry=null;showLabel("","");
  setTimeout(()=>{if(mode==="transition-out"){mode="globe";earthGroup.scale.setScalar(1)}},480);
}
function setHoveredContinent(continent){
  if(hoveredContinent===continent)return;
  if(hoveredContinent&&continentGroups.has(hoveredContinent))continentGroups.get(hoveredContinent).visible=false;
  hoveredContinent=continent;
  if(!continent)return;
  if(!continentGroups.has(continent)){
    const group=new THREE.Group(),featuresForContinent=features.filter(f=>belongsTo(f,continent)),geometries=featuresForContinent.map(f=>topologyGeometryByName.get(f.properties?.name)).filter(Boolean),merged=topoMerge(topologyData,geometries);
    const polygons=merged.type==="Polygon"?[merged.coordinates]:merged.coordinates;
    polygons.forEach(poly=>group.add(makeSphericalPolygon(poly,1.0,.007,countryMaterial(false,true),0xb3a172)));
    addCountryBorders(group,featuresForContinent,1.009,new THREE.LineBasicMaterial({color:0xafa27f,transparent:true,opacity:.55}));
    // Keep a lazy cache under the rotating earth; reusing it avoids rebuilding
    // dense continent geometry while moving the pointer across country borders.
    group.visible=false;earthGroup.add(group);continentGroups.set(continent,group);
  }
  continentGroups.get(continent).visible=true;
}
function updateGlobeHover(event){
  const rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
  globeScene.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);const hit=earthMesh?raycaster.intersectObject(earthMesh,false)[0]:null;
  if(!hit){clearGlobeHover();return}
  const local=earthGroup.worldToLocal(hit.point.clone()).normalize();const lat=Math.asin(THREE.MathUtils.clamp(local.y,-1,1))*180/Math.PI;const lon=Math.atan2(-local.z,local.x)*180/Math.PI;
  const f=countryAt(lon,lat),country=f?.properties?.name||"",continent=f?continentAtCountry(f,lon):null;
  setHoveredContinent(continent);
  clearVisitedHover();
  hoveredCountry=country;
  const visitedNow=f&&visitedFeature(f);
  if(country&&visitedNow&&visitedMeshes.has(country))visitedMeshes.get(country).scale.setScalar(1.012);
  if(country)showLabel(country.toUpperCase(),visitedNow?"VISITED":"YET TO EXPLORE");
  else if(continent)showLabel(continent.toUpperCase(),(journal.places||[]).some(p=>p.continent===continent)?"EXPLORED":"YET TO EXPLORE");
  else showLabel("","");
}
function updateRegionHover(event){
  const rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,currentMap.camera);const hit=raycaster.intersectObjects(regionRayTargets,false)[0];
  if(hoveredCountry&&currentMap){const old=currentMap.group.children.find(g=>g.userData.country===hoveredCountry);if(old){old.position.z=0;old.children.forEach(c=>{if(c.userData.isBorder)c.material.opacity=c.userData.baseOpacity;if(c.material?.emissive)c.material.emissiveIntensity=old.userData.visited?.16:0})}}
  if(!hit){hoveredCountry=null;showLabel("","");return}
  const f=hit.object.userData.feature,name=f?.properties?.name||"",isVisited=visitedFeature(f);
  hoveredCountry=name;
  const countryGroup=currentMap.group.children.find(g=>g.userData.country===name);
  if(countryGroup){countryGroup.position.z=isVisited?1.25:.32;countryGroup.children.forEach(c=>{if(c.userData.isBorder&&c.material)c.material.opacity=isVisited?.98:.82;if(c.material?.emissive)c.material.emissiveIntensity=isVisited?.38:.05})}
  showLabel(name.toUpperCase(),isVisited?"VISITED":"YET TO EXPLORE");
}
function clearRegionHover(){
  if(hoveredCountry&&currentMap){const old=currentMap.group.children.find(g=>g.userData.country===hoveredCountry);if(old){old.position.z=0;old.children.forEach(c=>{if(c.userData.isBorder)c.material.opacity=c.userData.baseOpacity;if(c.material?.emissive)c.material.emissiveIntensity=old.userData.visited?.16:0})}}
  hoveredCountry=null;showLabel("","");
}
function animate(now){
  requestAnimationFrame(animate);
  const dt=lastFrame?Math.min((now-lastFrame)/1000,.05):0;lastFrame=now;
  if(mode==="globe"){
    if(!drag){earthGroup.rotation.y+=dt*(.075+velocityX);earthGroup.rotation.x=THREE.MathUtils.clamp(earthGroup.rotation.x+dt*velocityY,-Math.PI*.47,Math.PI*.47);velocityX*=.94;velocityY*=.94;if(Math.abs(velocityX)<.00008)velocityX=0;if(Math.abs(velocityY)<.00008)velocityY=0}
  }else if(mode.startsWith("transition")&&transition){const t=THREE.MathUtils.clamp((now-transition.start)/480,0,1),ease=1-Math.pow(1-t,3);earthGroup.scale.setScalar(transition.from+(transition.to-transition.from)*ease)}
  if(mode==="map"&&currentMap)renderer.render(currentMap.scene,currentMap.camera);else renderer.render(globeScene,camera);
}
function resize(){
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(rect.width,rect.height,false);
  camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();
  if(currentMap&&(mode==="map"||mode==="transition-in")){const continent=currentMap.continent;clearRegionHover();disposeObject(currentMap.scene);currentMap=buildRegionMap(continent)}
}
function bindInteractions(){
  canvas.addEventListener("pointerdown",e=>{if(mode!=="globe")return;clearGlobeHover();drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);velocityX=velocityY=0});
  canvas.addEventListener("pointermove",e=>{
    if(drag){const dx=e.clientX-drag.lastX,dy=e.clientY-drag.lastY;if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>3)drag.moved=true;earthGroup.rotation.y+=dx*.008;earthGroup.rotation.x=THREE.MathUtils.clamp(earthGroup.rotation.x+dy*.008,-Math.PI*.47,Math.PI*.47);velocityX=dx*.00045;velocityY=dy*.00045;drag.lastX=e.clientX;drag.lastY=e.clientY;return}
    if(mode==="globe")updateGlobeHover(e);else if(mode==="map")updateRegionHover(e);
  });
  canvas.addEventListener("pointerup",e=>{
    if(!drag)return;const moved=drag.moved;drag=null;
    updateGlobeHover(e);if(!moved&&hoveredContinent)enterRegion(hoveredContinent);
  });
  canvas.addEventListener("pointercancel",()=>{drag=null;clearGlobeHover()});
  canvas.addEventListener("pointerleave",()=>{if(drag)return;if(mode==="globe")clearGlobeHover();else if(mode==="map")clearRegionHover()});
  canvas.addEventListener("keydown",e=>{if(e.key==="Escape"&&mode==="map")returnToGlobe();if(e.key==="ArrowLeft")earthGroup.rotation.y+=.15;if(e.key==="ArrowRight")earthGroup.rotation.y-=.15;if(e.key==="ArrowUp")earthGroup.rotation.x=THREE.MathUtils.clamp(earthGroup.rotation.x-.15,-Math.PI*.47,Math.PI*.47);if(e.key==="ArrowDown")earthGroup.rotation.x=THREE.MathUtils.clamp(earthGroup.rotation.x+.15,-Math.PI*.47,Math.PI*.47)});
  backButton.addEventListener("click",returnToGlobe);
}
async function start(){
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"});
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    const response=await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json",{cache:"force-cache"});
    if(!response.ok)throw new Error("Map boundary data could not be loaded.");
    topologyData=await response.json();topologyGeometryByName=new Map(topologyData.objects.countries.geometries.map(g=>[g.properties?.name,g]));features=topoFeature(topologyData,topologyData.objects.countries).features;features.forEach(f=>featureGeoInfo.set(f,{bounds:d3.geoBounds(f),centroid:d3.geoCentroid(f)}));
    buildGlobe();resize();bindInteractions();showLabel("","");requestAnimationFrame(animate);
    if("ResizeObserver" in window)new ResizeObserver(resize).observe(canvas);else window.addEventListener("resize",resize);
  }catch(error){
    console.error("Andy Journal map failed to initialize",error);
    showLabel("Map unavailable","CHECK INTERNET CONNECTION");
  }
}
start();

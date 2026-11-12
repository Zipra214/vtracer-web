import { imageDimensions, checkDimensions } from '../../../image-header.js';
import { presets, fields, validateParams } from '../../../trace-config.js?v=20261112c';
import { toneGroups, anchoredPalette } from './palette-model.js?v=20261112d';
const $=id=>document.getElementById(id);
let mode='vector',inputImage=null,inputUrl=null,resultUrl=null,result=null,filename='image';
let zoom=1,panX=0,panY=0,width=1,height=1,version=0,job=null,timer,view='compare',toolsHidden=false;
const rasterViews={before:{scale:null,x:0,y:0},after:{scale:null,x:0,y:0}};
let activeRaster='after';
let svgRoot=null,originalSvg=null,colorGroups=[],colorRecords=[],selectedColor=null,selectedSource=null;
const colorPositions=new Map();
const svgNode=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);return node;};
function refreshRepresentative(group){if(!group.records.length)return;const weights=new Map();for(const r of group.records){const hex=r.node.getAttribute('fill').toLowerCase();weights.set(hex,(weights.get(hex)||0)+r.weight);}group.hex=[...weights].sort((a,b)=>b[1]-a[1])[0][0];}
function pickedRecords(){const group=colorGroups[selectedColor];return group?group.records.filter(record=>selectedSource===null||record.hex===selectedSource):[];}
let bubbleFrames=new Map();
const bubbleKeys=new WeakMap();
function animateBubble(node,key,frame,previous){
 bubbleKeys.set(node,key);
 const from=previous.get(key);if(from&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  node.style.transformBox='fill-box';node.style.transformOrigin='center';
  node.animate([{transform:`translate(${from.x-frame.x}px,${from.y-frame.y}px) scale(${from.r/frame.r})`},{transform:'translate(0px,0px) scale(1)'}],{duration:380,easing:'cubic-bezier(.22,1,.36,1)'});
 }
 bubbleFrames.set(key,frame);
}
function editView(){const focused=$('view-switcher').contains(document.activeElement)?document.activeElement:null;const editing=view==='vector'&&result?.kind==='vector';$('palette-panel').hidden=!editing;$('vector-settings').hidden=editing;for(const id of ['palette-panel','vector-settings']){$(id).inert=toolsHidden;$(id).setAttribute('aria-hidden',String(toolsHidden||$(id).hidden));}$('view-switcher').hidden=mode==='upscale';(editing?$('palette-panel'):$('vector-settings')).prepend($('view-switcher'));document.querySelector('.editor-shell').classList.toggle('color-editing',editing);if(editing)renderColors();focused?.focus();}
function chooseView(next){if(mode==='upscale')next='compare';if(next!=='vector'&&svgRoot)selectColor(null);view=next;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));$('comparison-panes').classList.toggle('result-only',view==='vector');editView();updateZoom();}
function message(text){clearTimeout(timer);$('message').textContent=text;$('message').hidden=false;timer=setTimeout(()=>$('message').hidden=true,5000);}
function show(screen){if(screen==='editor'&&!inputImage)screen='home';document.querySelectorAll('.screen').forEach(e=>e.hidden=e.id!==screen);history.replaceState(null,'','#'+screen);window.scrollTo(0,0);updateZoom();}
function clearResult(){if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;result=null;svgRoot=null;originalSvg=null;colorGroups=[];colorRecords=[];selectedColor=null;selectedSource=null;colorMerged=false;colorPositions.clear();$('artboard').replaceChildren();$('color-bubbles').replaceChildren();$('color-editor').hidden=true;$('result-placeholder').hidden=false;$('result-placeholder').textContent='Chọn chế độ và bắt đầu xử lý.';$('result-label').textContent='Kết quả';$('download').disabled=true;editView();}
function cancel(){version++;if(job){job.controller.abort();job.worker?.terminate();job=null;}$('cancel-process').hidden=true;controls();}
function upscaleSize(){const value=Number($('upscale-scale').value),scale=value||1,w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));$('upscale-value').textContent=value===0?'0 · Giữ gốc':value.toLocaleString('vi-VN')+'×';const valid=w<=10000&&h<=10000&&w*h<=16000000;$('upscale-size').textContent=inputImage?`${w} × ${h} px${valid?'':' · Vượt giới hạn, hãy giảm mức phóng.'}`:'';return valid;}
$('upscale-scale').addEventListener('input',()=>{upscaleSize();controls();});
function controls(){const busy=!!job;$('upscale-scale').disabled=busy;for(const id of ['vector-action','upscale-action'])$(id).disabled=busy||!inputImage;for(const b of document.querySelectorAll('[data-mode]'))b.disabled=busy;$('download').disabled=busy||!result;const validUpscale=upscaleSize();$('upscale-action').disabled=busy||!inputImage||!validUpscale;}
function setMode(next){if(!['vector','upscale'].includes(next)||job)return;mode=next;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));$('vector-options').hidden=mode!=='vector';$('upscale-options').hidden=mode!=='upscale';for(const option of $('download-format').options)option.disabled=mode==='upscale'&&option.value!=='png';$('download-format').value=mode==='upscale'?'png':'svg';clearResult();chooseView('compare');resetView();$('process-status').textContent='';controls();}
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>setMode(b.dataset.mode));
$('back-home').addEventListener('click',()=>{cancel();show('home');});
function fitScale(){const v=$('after-viewport');return Math.min(Math.max(1,v.clientWidth-24)/width,Math.max(1,v.clientHeight-24)/height);}
function rasterScale(key){const v=$(key+'-viewport'),w=key==='after'&&result?result.width:width,h=key==='after'&&result?result.height:height;return rasterViews[key].scale??Math.max(.01,Math.min(32,Math.max(1,v.clientWidth-24)/w,Math.max(1,v.clientHeight-24)/h));}
function updateZoom(){
 if(mode==='upscale'){
  for(const [key,id] of [['before','before-content'],['after','artboard']]){const e=$(id),s=rasterViews[key],w=key==='after'&&result?result.width:width,h=key==='after'&&result?result.height:height;e.style.width=w+'px';e.style.height=h+'px';e.style.transform=`translate(calc(-50% + ${s.x}px),calc(-50% + ${s.y}px)) scale(${rasterScale(key)})`;}
  $('zoom-label').textContent=Math.round(rasterScale(activeRaster)*100)+'%';return;
 }
 const scale=fitScale()*zoom;for(const id of ['before-content','artboard']){const e=$(id),w=id==='artboard'&&result?result.width:width,h=id==='artboard'&&result?result.height:height;e.style.width=w+'px';e.style.height=h+'px';e.style.transform=`translate(calc(-50% + ${panX}px),calc(-50% + ${panY}px)) scale(${scale*width/w})`;}$('zoom-label').textContent=Math.round(zoom*100)+'%';
}
function resetView(){zoom=1;panX=panY=0;for(const s of Object.values(rasterViews)){s.scale=null;s.x=s.y=0;}updateZoom();}
$('toggle-tools').addEventListener('click',()=>{toolsHidden=!toolsHidden;document.querySelector('.editor-shell').classList.toggle('panels-hidden',toolsHidden);$('toggle-tools').textContent=toolsHidden?'›':'‹';$('toggle-tools').setAttribute('aria-label',toolsHidden?'Mở thanh công cụ':'Thu thanh công cụ');$('toggle-tools').title=toolsHidden?'Mở thanh công cụ':'Thu thanh công cụ';$('toggle-tools').setAttribute('aria-expanded',String(!toolsHidden));editView();updateZoom();});
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>chooseView(b.dataset.view));
function mountVector(text){
 const doc=new DOMParser().parseFromString(text,'image/svg+xml'),root=doc.documentElement;
 if(root.localName!=='svg'||doc.querySelector('parsererror')||root.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('Kết quả SVG không hợp lệ.');
 for(const node of [root,...root.querySelectorAll('*')]){
  if(!['svg','path'].includes(node.localName))throw Error('SVG chứa thành phần không được hỗ trợ.');
  for(const a of [...node.attributes])if(!['xmlns','version','viewBox','width','height','d','fill','transform'].includes(a.name))node.removeAttribute(a.name);
  if(node.localName==='path'&&!/^#[a-f\d]{6}$/i.test(node.getAttribute('fill')||''))throw Error('Màu SVG không hợp lệ.');
  if(node.hasAttribute('transform')&&!/^translate\(\s*[-+\d.eE]+[ ,]+[-+\d.eE]+\s*\)$/.test(node.getAttribute('transform')))throw Error('Biến đổi SVG không hợp lệ.');
 }
 svgRoot=document.importNode(root,true);$('artboard').replaceChildren(svgRoot);colorRecords=[...svgRoot.querySelectorAll('path')].map(node=>{const box=node.getBBox();return {node,hex:node.getAttribute('fill').toLowerCase(),weight:Math.max(1,box.width*box.height)/(width*height)};});colorPositions.clear();
 bubbleFrames.clear();colorGroups=toneGroups(colorRecords);
 svgRoot.addEventListener('click',e=>{if(panMoved||view!=='vector')return;const record=colorRecords.find(r=>r.node===e.target);const index=colorGroups.findIndex(g=>g.records.includes(record));if(index>=0)selectColor(index);});
 selectColor(null);
}
function cleanSvg(){const clone=svgRoot.cloneNode(true);clone.querySelectorAll('[class]').forEach(n=>n.removeAttribute('class'));return new XMLSerializer().serializeToString(clone);}
function syncVector(){if(!result||!svgRoot)return;result.svg=cleanSvg();result.blob=new Blob([result.svg],{type:'image/svg+xml'});}
function selectColor(index,source=null){if(index===null)colorMerged=false;selectedColor=index;selectedSource=source;$('color-editor').hidden=index===null;const group=colorGroups[index];if(group){const hex=source===null?group.hex:pickedRecords()[0]?.node.getAttribute('fill')||group.hex;$('edit-color').value=hex;$('edit-hex').value=hex;}$('color-error').textContent='';const picked=pickedRecords();for(const record of colorRecords){record.node.classList.toggle('ink-selected',picked.includes(record));record.node.classList.toggle('ink-muted',!!group&&!picked.includes(record));}renderColors();}
function renderColors(){
 const board=$('color-bubbles'),previous=bubbleFrames;
 const matrix=board.getScreenCTM();
 if(matrix)for(const circle of board.querySelectorAll('circle[role="button"]')){
  if(!circle.getAnimations().length)continue;
  const m=matrix.inverse().multiply(circle.getScreenCTM()),center=new DOMPoint(+circle.getAttribute('cx'),+circle.getAttribute('cy')).matrixTransform(m);
  previous.set(bubbleKeys.get(circle),{x:center.x,y:center.y,r:+circle.getAttribute('r')*Math.hypot(m.a,m.b)});
 }
 bubbleFrames=new Map();board.replaceChildren();
 const layout=anchoredPalette(colorGroups,Math.max(280,board.parentElement.clientWidth-4));
 colorPositions.clear();for(const p of layout.entries)colorPositions.set(p.group,p);
 board.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);board.style.width=layout.width+'px';board.style.height=layout.height+'px';
 colorGroups.forEach((g,i)=>{
  const p=colorPositions.get(g),wrapper=svgNode('g',{'data-color-index':i});
  const outer=svgNode('circle',{cx:p.x,cy:p.y,r:p.r,fill:g.hex,role:'button',tabindex:0,class:'output-bubble'+(i===selectedColor&&selectedSource===null?' selected':''),'aria-label':`Xuất ra ${g.hex}, ${g.records.length} vùng`,'aria-pressed':i===selectedColor&&selectedSource===null});
  const title=svgNode('title',{});title.textContent=`${g.hex} · ${g.records.length} vùng`;outer.append(title);wrapper.append(outer);
  const children=p.children;
  animateBubble(outer,g,p,previous);
  const representative=g.records.find(r=>r.hex===g.hex);if(representative)bubbleFrames.set(representative,p);
  for(const child of children){const circle=svgNode('circle',{cx:p.x+child.x,cy:p.y+child.y,r:child.r,fill:child.hex,role:'button',tabindex:0,'data-source-color':child.hex,class:'source-bubble'+(i===selectedColor&&selectedSource===child.hex?' selected':''),'aria-label':`Gốc ${child.hex}, xuất ra ${g.hex}`,'aria-pressed':i===selectedColor&&selectedSource===child.hex});const hit=svgNode('circle',{cx:p.x+child.x,cy:p.y+child.y,r:child.r+6,fill:'transparent','data-source-color':child.hex,class:'source-hit','aria-hidden':'true'});const t=svgNode('title',{});t.textContent=`Gốc ${child.hex}`;circle.append(t);wrapper.append(hit,circle);animateBubble(circle,g.records.find(r=>r.hex===child.hex),{x:p.x+child.x,y:p.y+child.y,r:child.r},previous);}
  if(p.pages>1){
   const pager=svgNode('g',{'data-page-group':i,role:'button',tabindex:0,'aria-label':`Cụm ${g.hex}, trang ${p.page+1}/${p.pages}. Xem màu tiếp theo`,class:'bubble-pager'});
   pager.append(svgNode('rect',{x:p.x-40,y:p.y+p.r+3,width:80,height:28,rx:10,fill:'#f3f0fc'}));
   const label=svgNode('text',{x:p.x,y:p.y+p.r+22,'text-anchor':'middle',fill:'#443887','font-size':12});label.textContent=`${p.page+1}/${p.pages} ›`;pager.append(label);wrapper.append(pager);
  }
  board.append(wrapper);
 });

 $('color-hint').textContent=colorGroups.length?`${colorGroups.length} màu`:'Không còn vùng màu. Đặt lại để khôi phục.';
}
$('edit-color').addEventListener('input',e=>{$('edit-hex').value=e.target.value;$('color-error').textContent='';});
$('apply-color').addEventListener('click',()=>{const g=colorGroups[selectedColor],hex=$('edit-hex').value;if(!g)return;if(!/^#[a-f\d]{6}$/i.test(hex)){$('color-error').textContent='Nhập màu dạng #RRGGBB.';return;}const records=pickedRecords();if(selectedSource!==null&&records.length<g.records.length){g.records=g.records.filter(r=>!records.includes(r));refreshRepresentative(g);const separate={hex:hex.toLowerCase(),records};colorGroups.push(separate);}else g.hex=hex.toLowerCase();for(const r of records)r.node.setAttribute('fill',hex.toLowerCase());colorPositions.clear();syncVector();selectColor(null);});
$('cancel-color').addEventListener('click',()=>selectColor(null));
$('delete-color').addEventListener('click',()=>{const g=colorGroups[selectedColor];if(!g)return;const records=pickedRecords();for(const r of records)r.node.remove();colorRecords=colorRecords.filter(r=>!records.includes(r));g.records=g.records.filter(r=>!records.includes(r));if(!g.records.length)colorGroups.splice(selectedColor,1);else refreshRepresentative(g);colorPositions.clear();syncVector();selectColor(null);});
$('reset-colors').addEventListener('click',()=>{if(originalSvg){mountVector(originalSvg);syncVector();}});
let colorDrag=null,colorMerged=false,colorPointerHandled=false;
function turnPalettePage(e){const page=e.target.closest('[data-page-group]');if(!page)return false;const group=colorGroups[Number(page.dataset.pageGroup)],p=colorPositions.get(group);group.page=(p.page+1)%p.pages;renderColors();$('color-bubbles').querySelector(`[data-page-group="${page.dataset.pageGroup}"]`)?.focus();return true;}
$('color-bubbles').addEventListener('click',e=>{if(turnPalettePage(e))return;const t=e.target.closest('[data-color-index]');if(t&&!colorPointerHandled)selectColor(Number(t.dataset.colorIndex),e.target.getAttribute('data-source-color'));});
$('color-bubbles').addEventListener('pointerdown',e=>{if(e.target.closest('[data-page-group]'))return;const t=e.target.closest('[data-color-index]');if(t&&e.button===0){e.preventDefault();colorDrag={index:Number(t.dataset.colorIndex),source:e.target.getAttribute('data-source-color'),x:e.clientX,y:e.clientY,pointer:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);}});
$('color-bubbles').addEventListener('pointermove',e=>{if(!colorDrag||Math.hypot(e.clientX-colorDrag.x,e.clientY-colorDrag.y)<4)return;const group=e.currentTarget.querySelector(`[data-color-index="${colorDrag.index}"]`),node=colorDrag.source?group?.querySelector(`.source-bubble[data-source-color="${colorDrag.source}"]`):group,matrix=e.currentTarget.getScreenCTM();if(node&&matrix){const a=new DOMPoint(colorDrag.x,colorDrag.y).matrixTransform(matrix.inverse()),b=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());const dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),limit=150,scale=distance>limit?limit/distance:1;node.setAttribute('transform',`translate(${dx*scale} ${dy*scale})`);node.classList.add('dragging');node.style.pointerEvents='none';if(colorDrag.source)group.append(node);else e.currentTarget.append(group);}});
function mergeColors(from,into,source=null){if(from===into||!colorGroups[from]||!colorGroups[into])return;const a=colorGroups[from],b=colorGroups[into],records=a.records.filter(r=>source===null||r.hex===source);for(const r of records)r.node.setAttribute('fill',b.hex);b.records.push(...records);a.records=a.records.filter(r=>!records.includes(r));if(!a.records.length)colorGroups.splice(from,1);else refreshRepresentative(a);colorPositions.clear();syncVector();selectColor(null);}
function splitColor(index,source=null,point=null){const group=colorGroups[index];if(!group)return;const records=group.records.filter(r=>source===null||r.hex===source),originals=new Map();for(const r of records){r.node.setAttribute('fill',r.hex);if(!originals.has(r.hex))originals.set(r.hex,[]);originals.get(r.hex).push(r);}group.records=group.records.filter(r=>!records.includes(r));if(!group.records.length)colorGroups.splice(index,1);else refreshRepresentative(group);colorPositions.clear();for(const [hex,members] of originals){const g={hex,records:members};const frame=bubbleFrames.get(members[0]);if(frame)bubbleFrames.set(g,frame);colorGroups.push(g);}syncVector();selectColor(null);}
$('color-bubbles').addEventListener('pointerup',e=>{
 if(!colorDrag)return;const d=colorDrag,board=e.currentTarget,draggedGroup=colorGroups[d.index];
 for(const circle of board.querySelectorAll(`[data-color-index="${d.index}"] circle[role="button"]`)){
  const source=circle.getAttribute('data-source-color'),key=source===null?draggedGroup:draggedGroup.records.find(r=>r.hex===source);
  const center=new DOMPoint(+circle.getAttribute('cx'),+circle.getAttribute('cy')).matrixTransform(circle.getScreenCTM()).matrixTransform(board.getScreenCTM().inverse());
  bubbleFrames.set(key,{x:center.x,y:center.y,r:+circle.getAttribute('r')});
 }
 colorDrag=null;colorPointerHandled=true;setTimeout(()=>colorPointerHandled=false,0);if(board.hasPointerCapture(e.pointerId))board.releasePointerCapture(e.pointerId);
 const inverse=board.getScreenCTM().inverse(),start=new DOMPoint(d.x,d.y).matrixTransform(inverse),raw=new DOMPoint(e.clientX,e.clientY).matrixTransform(inverse),dx=raw.x-start.x,dy=raw.y-start.y,distance=Math.hypot(dx,dy),limit=distance>150?150/distance:1,point={x:start.x+dx*limit,y:start.y+dy*limit},group=colorGroups[d.index];
 const target=colorGroups.findIndex(g=>{if(g===group)return false;const p=colorPositions.get(g);return Math.hypot(point.x-p.x,point.y-p.y)<=p.r;});
 if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<6){if(colorMerged&&selectedColor!==null){colorMerged=false;mergeColors(selectedColor,d.index,selectedSource);}else selectColor(d.index,d.source);}
 else if(target>=0)mergeColors(d.index,target,d.source);
 else if(d.source!==null){const p=colorPositions.get(group);if(Math.hypot(point.x-p.x,point.y-p.y)>p.r)splitColor(d.index,d.source,point);else renderColors();}
 else renderColors();
});
$('color-bubbles').addEventListener('pointercancel',()=>{colorDrag=null;renderColors();});
$('color-bubbles').addEventListener('keydown',e=>{
 if(e.target.closest('[data-page-group]')){if(e.key==='Enter'||e.key===' '){e.preventDefault();turnPalettePage(e);}return;}
 const t=e.target.closest('[data-color-index]');if(!t)return;
 const index=Number(t.dataset.colorIndex),source=e.target.getAttribute('data-source-color'),record=colorGroups[index]?.records.find(r=>source===null||r.hex===source);
 if(e.key==='Enter'||e.key===' '){e.preventDefault();if(colorMerged&&selectedColor!==null){colorMerged=false;mergeColors(selectedColor,index,selectedSource);}else selectColor(index,source);}
 else if(e.key.toLowerCase()==='m'){e.preventDefault();selectColor(index,source);colorMerged=true;$('color-hint').textContent='Chọn màu đích rồi Enter để gộp.';}
 else if(e.key.toLowerCase()==='t'){e.preventDefault();splitColor(index,source);}
 else if(e.key==='Escape'){selectColor(null);}else return;
 const next=colorGroups.findIndex(g=>g.records.includes(record));
 if(next>=0)e.currentTarget.querySelector(`[data-color-index="${next}"] ${source===null?'.output-bubble':`.source-bubble[data-source-color="${source}"]`}`)?.focus();
});
function zoomBy(factor){if(mode==='upscale')rasterViews[activeRaster].scale=Math.max(.01,Math.min(32,rasterScale(activeRaster)*factor));else zoom=Math.max(.05,Math.min(32,zoom*factor));updateZoom();}
$('zoom-in').addEventListener('click',()=>zoomBy(1.2));$('zoom-out').addEventListener('click',()=>zoomBy(1/1.2));$('fit').addEventListener('click',resetView);$('actual').addEventListener('click',()=>{if(mode==='upscale'){for(const s of Object.values(rasterViews)){s.scale=1;s.x=s.y=0;}}else{zoom=Math.max(.05,Math.min(32,1/fitScale()));panX=panY=0;}updateZoom();});
let panDrag=null,panMoved=false;
for(const viewport of document.querySelectorAll('.image-viewport')){
 viewport.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();activeRaster=viewport.id==='before-viewport'?'before':'after';zoomBy(Math.exp(-Math.max(-1000,Math.min(1000,e.deltaY))*.001));},{passive:false});
 viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;activeRaster=viewport.id==='before-viewport'?'before':'after';const s=mode==='upscale'?rasterViews[activeRaster]:{x:panX,y:panY};panMoved=false;panDrag={id:e.pointerId,x:e.clientX,y:e.clientY,px:s.x,py:s.y,key:activeRaster};});
 viewport.addEventListener('pointermove',e=>{if(!panDrag||panDrag.id!==e.pointerId)return;if(!panMoved&&Math.hypot(e.clientX-panDrag.x,e.clientY-panDrag.y)<5)return;panMoved=true;viewport.setPointerCapture(e.pointerId);if(mode==='upscale'){rasterViews[panDrag.key].x=panDrag.px+e.clientX-panDrag.x;rasterViews[panDrag.key].y=panDrag.py+e.clientY-panDrag.y;}else{panX=panDrag.px+e.clientX-panDrag.x;panY=panDrag.py+e.clientY-panDrag.y;}updateZoom();});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(event,()=>{panDrag=null;setTimeout(()=>panMoved=false,0);});
}
new ResizeObserver(updateZoom).observe($('comparison-panes'));
new ResizeObserver(([entry])=>{document.querySelector('.editor-shell').style.setProperty('--toolbar-height',entry.target.getBoundingClientRect().height+'px');updateZoom();}).observe(document.querySelector('.editor-toolbar'));
let paletteWidth=0;new ResizeObserver(([entry])=>{const width=Math.round(entry.contentRect.width);if(width!==paletteWidth){paletteWidth=width;if(!$('palette-panel').hidden)renderColors();}}).observe(document.querySelector('.color-scroll'));
const labels={filter_speckle:['Lọc đốm nhỏ','Loại cụm màu có diện tích nhỏ hơn bình phương giá trị này: 4 tương ứng 16 pixel². Tăng để bỏ đốm và giảm path; giảm để giữ nét mảnh, chấm nhỏ. Không trực tiếp làm tròn đường viền.'],color_precision:['Độ chính xác màu','Số bit giữ cho mỗi kênh RGB, từ 1 đến 8. Giảm để gom các sắc gần nhau thành mảng phẳng, nhẹ file nhưng có thể mất chuyển sắc; tăng để phân biệt nhiều màu hơn. Không đảm bảo số màu đầu ra cố định.'],layer_difference:['Chênh lệch lớp màu','Ngưỡng phân biệt lớp màu trong phân cụm của VTracer. Tăng thường gộp nhiều sắc gần nhau, tạo mảng lớn; giảm giữ nhiều lớp và chi tiết chuyển sắc hơn. Kết quả phụ thuộc ảnh và độ chính xác màu, không phải số lớp đặt trước.'],corner_threshold:['Ngưỡng góc','Góc đổi hướng từ ngưỡng này trở lên được giữ thành góc nhọn. Tăng để làm tròn nhiều góc hơn; giảm để giữ góc và chi tiết sắc. Quá cao có thể bo mất góc chữ/logo.'],path_precision:['Chữ số thập phân tọa độ SVG','Số chữ số thập phân khi ghi tọa độ SVG. 2–3 thường đủ cho web; 4–5 giảm sai số làm tròn nhưng file lớn hơn; −1 không đặt giới hạn chữ số theo tham số này. Không thay thuật toán làm mượt, không sửa đường cong gãy.'],length_threshold:['Ngưỡng độ dài đoạn','Độ dài đoạn theo pixel ảnh đầu vào: bước làm mượt không chia tiếp đoạn ngắn hơn hoặc bằng ngưỡng này. Giảm để xử lý đường viền chi tiết hơn, có thể chậm và nhiều điểm; tăng để dừng sớm hơn. Không phải thanh độ mượt tuyến tính.'],splice_threshold:['Ngưỡng nối đường cong','Ngưỡng góc đổi hướng tích lũy để tách đường viền thành các đoạn Bézier. Giảm tạo nhiều đoạn ngắn, bám biên hơn; tăng tạo đoạn dài hơn, có thể bỏ chi tiết hoặc méo đường cong. Điểm đổi chiều cong vẫn có thể bị tách.'],max_iterations:['Số vòng lặp khớp đường','Số vòng chia và làm mượt tối đa, từ 1 đến 20. Tăng cho phép tinh chỉnh thêm nếu chưa đạt điều kiện dừng; tốn thời gian hơn và không luôn đổi kết quả. Không phải số lần chạy vector hóa hay mức khử nhiễu.']};
for(const [key,[,min,max]] of Object.entries(fields)){const label=document.createElement('label');label.textContent=labels[key][0];const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=key==='length_threshold'?.1:1;input.id='setting-'+key;input.value=presets.don_gian[key];input.addEventListener('input',()=>$('trace-preset').value='custom');const note=document.createElement('small');note.textContent=labels[key][1];label.append(input,note);$('advanced-fields').append(label);}
$('trace-preset').addEventListener('change',e=>{const preset=presets[e.target.value];if(preset)for(const key of Object.keys(fields))$('setting-'+key).value=preset[key];});
function canvas(){const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').drawImage(inputImage,0,0,width,height);return c;}
function trace(c,params,active){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('../../../worker.js',import.meta.url),{type:'module'});active.worker=worker;
 const cleanup=()=>{clearTimeout(timeout);worker.terminate();active.controller.signal.removeEventListener('abort',abort);};
 const abort=()=>{cleanup();reject(new DOMException('Đã hủy','AbortError'));};
 const timeout=setTimeout(()=>{cleanup();reject(Error('Xử lý quá thời gian. Hãy thử ảnh nhỏ hơn.'));},180000);
 active.controller.signal.addEventListener('abort',abort,{once:true});
 worker.onmessage=({data})=>{cleanup();data.error?reject(Error(data.error)):resolve(data.svg);};worker.onerror=()=>{cleanup();reject(Error('Không thể xử lý ảnh.'));};
 const rgba=c.getContext('2d').getImageData(0,0,width,height).data.buffer;
 worker.postMessage({rgba,width,height,preset:'custom',params,alpha:'preserve',mode:'spline',hierarchy:'stacked'},[rgba]);
});}
async function process(kind){
 if(job||!inputImage)return;
 let params;try{if(kind==='vector')params=validateParams(Object.fromEntries(Object.keys(fields).map(key=>[key,$('setting-'+key).value])));}catch(e){message(e.message);return;}
 const active={id:++version,controller:new AbortController(),worker:null};job=active;clearResult();controls();$('cancel-process').hidden=false;$('process-status').textContent=kind==='vector'?'Đang vector hóa…':'Đang phóng to ảnh…';
 try{
  const c=canvas();let blob,svg=null,outputWidth=width,outputHeight=height;
  if(kind==='vector'){
   svg=await trace(c,params,active);
   if(svg.length>20000000||(svg.match(/<path\b/g)||[]).length>20000)throw Error('Kết quả quá nhiều chi tiết. Tăng lọc đốm hoặc giảm độ chính xác màu.');
   blob=new Blob([svg],{type:'image/svg+xml'});
  }else{
   const {upscaleAI}=await import('../../../upscale-ai.js?v=scale-range-2');
   if(job!==active||active.controller.signal.aborted)return;
   let backend='';
   const output=await upscaleAI(c,Number($('upscale-scale').value),{signal:active.controller.signal,onProgress:n=>{if(job===active)$('process-status').textContent=`Đang phóng to ảnh… ${Math.round(n)}%${backend?' · '+backend:''}`;},onBackend:text=>{backend=text.startsWith('CPU')?'CPU (có thể chậm)':'GPU';if(job===active)$('process-status').textContent='Đang chuẩn bị phóng to ảnh… '+backend;}});
   outputWidth=output.width;outputHeight=output.height;blob=await new Promise((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(Error('Không thể tạo PNG.')),'image/png'));
  }
  if(job!==active||active.controller.signal.aborted)return;
  const url=URL.createObjectURL(blob),img=new Image();img.src=url;
  try{await img.decode();}catch(e){URL.revokeObjectURL(url);throw e;}
  if(job!==active||active.controller.signal.aborted){URL.revokeObjectURL(url);return;}
  resultUrl=url;result={kind,blob,svg,width:outputWidth,height:outputHeight};img.alt=kind==='vector'?'Kết quả vector hóa':'Ảnh đã phóng to';img.draggable=false;if(kind==='vector'){originalSvg=svg;mountVector(svg);}else $('artboard').replaceChildren(img);editView();$('result-placeholder').hidden=true;$('result-label').textContent=kind==='vector'?'Vector':'PNG '+outputWidth+' × '+outputHeight;$('process-status').textContent='Hoàn tất.';updateZoom();
 }catch(e){if(job===active)$('process-status').textContent=e.name==='AbortError'?'Đã hủy.':e.message;}
 finally{if(job===active){job=null;$('cancel-process').hidden=true;controls();}}
}
$('vector-action').addEventListener('click',()=>process('vector'));$('upscale-action').addEventListener('click',()=>process('upscale'));$('cancel-process').addEventListener('click',()=>{cancel();$('process-status').textContent='Đã hủy.';});
$('download').addEventListener('click',async()=>{
 const output=result;if(!output)return;const id=version,format=$('download-format').value;$('download').disabled=true;
 try{let blob=output.blob,extension=output.kind==='upscale'?'png':format;
  if(output.kind==='vector'&&format!=='svg'){const {exportVector}=await import('../../../export.js');const exported=await exportVector(output.svg,format,{widthMm:width*25.4/96,heightMm:height*25.4/96});blob=exported.blob;extension=exported.extension;if(exported.warnings?.length)message(exported.warnings.join(' '));}
  if(id!==version||result!==output)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename+'.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){message(e.message);}finally{controls();}
});
async function loadImage(file){
 cancel();const id=version;$('load-error').textContent='';
 try{
  if(!file||file.size>20*1024*1024)throw Error('Ảnh tối đa 20 MiB.');
  if(!['image/png','image/jpeg','image/webp','image/bmp'].includes(file.type))throw Error('Chỉ nhận PNG, JPG, WebP hoặc BMP.');
  const [w,h]=imageDimensions(await file.arrayBuffer());checkDimensions(w,h);if(id!==version)return;
  const url=URL.createObjectURL(file),img=new Image();img.src=url;
  try{await img.decode();checkDimensions(img.naturalWidth,img.naturalHeight);}catch(e){URL.revokeObjectURL(url);throw e;}
  if(id!==version){URL.revokeObjectURL(url);return;}
  if(inputUrl)URL.revokeObjectURL(inputUrl);inputUrl=url;inputImage=img;width=img.naturalWidth;height=img.naturalHeight;filename=(file.name||'image').replace(/\.[^.]+$/,'');img.alt='Ảnh gốc';img.draggable=false;
  $('before-content').replaceChildren(img);clearResult();$('file-info').textContent=`${file.name||'Ảnh đã dán'} · ${width} × ${height}`;$('canvas-size').textContent=width+' × '+height+' px';$('process-status').textContent='';show('editor');resetView();controls();
 }catch(e){if(id===version){$('load-error').textContent=e.message;message(e.message);}}
}
$('choose-image').addEventListener('click',()=>$('image-file').click());$('image-file').addEventListener('change',e=>{if(e.target.files[0])loadImage(e.target.files[0]);e.target.value='';});
const zone=$('upload-zone');for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('drag-over');});zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');if(e.dataTransfer.files[0])loadImage(e.dataTransfer.files[0]);});
window.addEventListener('paste',e=>{if(e.target.closest('input,textarea,[contenteditable]'))return;const file=[...e.clipboardData.items].find(item=>item.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();loadImage(file);}});
window.addEventListener('pagehide',()=>{cancel();if(inputUrl)URL.revokeObjectURL(inputUrl);if(resultUrl)URL.revokeObjectURL(resultUrl);});
window.addEventListener('hashchange',()=>{if(location.hash==='#home')cancel();show(location.hash==='#editor'?'editor':'home');});show('home');controls();

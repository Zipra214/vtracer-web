import { checkDimensions, imageDimensions } from './image-header.js';
import { presets, fields, validateParams } from './trace-config.js';
import { optimizeGeometry } from './geometry.js';

const $ = (id) => document.getElementById(id);
const descriptions = { don_gian: 'Khối màu lớn, ít path, phù hợp in ấn và cắt decal.', can_bang: 'Cân bằng giữa chi tiết và số lượng đường nét.', chi_tiet: 'Giữ chi tiết nhỏ và nhiều sắc độ; có thể xử lý lâu hơn.', custom: 'Giữ thông số bạn đã chỉnh, kể cả chiều dài và ngưỡng nối.' };
let original, prepared, svgRoot, filename = 'vector', inputUrl, resultUrl, downloadUrl, pngUrl;
let task, generation = 0, loadId = 0, step = 1, selectedColor = '', selectedPath = -1;
const history = [];
let zoom = 1, panX = 0, panY = 0, view = 'split', picking = false, drag;
function status(message, error = false) { $('status').textContent = message; $('status').dataset.error = String(error); }
function progress(value) { $('progress').hidden = false; if (Number.isFinite(value)) $('progress').value = value; else $('progress').removeAttribute('value'); }
function controls() {
  const busy = Boolean(task), ready = Boolean(original);
  for (const id of ['file','demo','prepare-options','options','edit-options']) $(id).disabled = busy;
  for (const id of ['next-prepare','next-trace','apply-prepare','reset-prepare','btn-upscale','convert']) $(id).disabled = busy || !ready;
  $('export').disabled = busy || !svgRoot; $('undo').disabled = busy || history.length === 0;
  $('cancel').hidden = !busy; $('previews').setAttribute('aria-busy', String(busy));
  for (const b of document.querySelectorAll('[data-step]')) {
    const n = Number(b.dataset.step); b.disabled = busy || n > 1 && !ready || n === 4 && !svgRoot;
    if (n === step) b.setAttribute('aria-current','step'); else b.removeAttribute('aria-current');
  }
}
function goStep(n) {
  if (task || n > 1 && !original || n === 4 && !svgRoot) return;
  step = n; for (let i=1;i<=4;i++) $(`step-${i}`).hidden = i !== n;
  if (n === 4) setView('after'); controls();
}
function revoke(url) { if (url) URL.revokeObjectURL(url); }
function invalidateDownload() { revoke(downloadUrl); downloadUrl=undefined; $('download').hidden=true; $('download').removeAttribute('href'); }
function clearVector() {
  svgRoot=undefined; history.length=0; selectedPath=-1; selectedColor='';
  $('vector-preview').replaceChildren(); $('vector-preview').hidden=true; invalidateDownload(); controls();
}
function cancelTask(message='Đã hủy. Ảnh gốc và kết quả trước vẫn giữ nguyên.') {
  ++generation; ++loadId; if (task) { task.controller.abort(); task.worker?.terminate(); }
  task=undefined; $('progress').hidden=true; controls(); status(message);
}
async function runTask(work) {
  if (task) return;
  const current={id:++generation,controller:new AbortController(),worker:undefined}; task=current; controls(); progress();
  try { await work(current); }
  catch(error) { if(task===current && !current.controller.signal.aborted) status(error.message || String(error),true); }
  finally { current.worker?.terminate(); if(task===current) { task=undefined; $('progress').hidden=true; controls(); } }
}
function guard(current) { if(task!==current || current.controller.signal.aborted) throw new DOMException('Đã hủy.','AbortError'); }
function canvas(width,height) {
  checkDimensions(width,height); const c=document.createElement('canvas'); c.width=width;c.height=height;
  if(!c.getContext('2d')) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.'); return c;
}
function blobOf(c) { return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Không tạo được PNG. Thử ảnh nhỏ hơn.')),'image/png')); }
function configureCrop() { $('crop-x').value=$('crop-y').value=0; $('crop-width').value=original.width; $('crop-height').value=original.height; }
async function loadFile(file) {
  if(!file || task) return; const id=++loadId;
  await runTask(async current=>{
    status('Đang kiểm tra ảnh…');
    if(!(file instanceof Blob)||!file.size||file.size>20*1024*1024) throw new Error('Ảnh phải lớn hơn 0 byte và không quá 20 MB.');
    imageDimensions(await file.arrayBuffer());guard(current);
    const url=URL.createObjectURL(file);
    try {
      const image=new Image();image.src=url;await image.decode();guard(current);
      checkDimensions(image.naturalWidth,image.naturalHeight);
      const c=canvas(image.naturalWidth,image.naturalHeight);c.getContext('2d').drawImage(image,0,0);
      if(id!==loadId)return;
      revoke(inputUrl);revoke(resultUrl);resultUrl=undefined;inputUrl=url;original=c;prepared=undefined;clearVector();
      filename=(file.name||'clipboard').replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)||'vector';
      $('source').src=url;$('stage').hidden=false;$('preview-empty').hidden=true;$('result').src=url;$('result').hidden=false;
      $('source-size').textContent=`${c.width} × ${c.height}`;$('file-info').textContent=`${file.name||'Ảnh clipboard'} · ${(file.size/1024).toFixed(0)} KB`;
      $('preview-badge').textContent='Ảnh gốc';$('stats').textContent='Có thể bỏ qua chuẩn bị để trace trực tiếp.';
      revoke(pngUrl);pngUrl=undefined;$('download-png').hidden=true;configureCrop();resetPrepareOptions();fitView();setView('split');
      step=1;for(let i=1;i<=4;i++)$(`step-${i}`).hidden=i!==1;
      status('Ảnh sẵn sàng. Chọn Chuẩn bị ảnh hoặc Vector hóa.');
    } finally { if(inputUrl!==url)URL.revokeObjectURL(url); }
  });
}
function syncPresetToInputs(key) { if(presets[key])for(const [name,[id]]of Object.entries(fields))$(id).value=presets[key][name]; }
function getAdvancedParams() { return validateParams(Object.fromEntries(Object.entries(fields).map(([key,[id]])=>[key,$(id).value]))); }
function workerCall(file,payload,current) {
  guard(current);
  return new Promise((resolve,reject)=>{
    const w=new Worker(new URL(file,import.meta.url),{type:'module'});current.worker=w;
    const cleanup=()=>{w.terminate();if(current.worker===w)current.worker=undefined;current.controller.signal.removeEventListener('abort',abort);clearTimeout(timeout);};
    const abort=()=>{cleanup();reject(new DOMException('Đã hủy.','AbortError'));};
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Đã dừng sau 180 giây. Thử ảnh nhỏ hơn hoặc ít màu hơn.'));},180000);
    current.controller.signal.addEventListener('abort',abort,{once:true});
    w.onerror=e=>{e.preventDefault();cleanup();reject(new Error('Worker thất bại hoặc hết bộ nhớ. Thử ảnh nhỏ hơn.'));};
    w.onmessage=({data})=>{if(data.progress!==undefined){if(task===current){progress(data.progress);if(data.message)status(data.message);}return;}cleanup();data.error?reject(new Error(data.error)):resolve(data);};
    w.postMessage(payload,payload.rgba?[payload.rgba]:[]);
  });
}
async function raster(c,operation,options,current) {
  const rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data.buffer;
  const out=await workerCall('./raster-worker.js',{id:current.id,operation,rgba,width:c.width,height:c.height,options},current);guard(current);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.rgba),c.width,c.height),0,0);return c;
}
function cropOriginal() {
  const nums=['crop-x','crop-y','crop-width','crop-height'].map(id=>Number($(id).value)),[x,y,w,h]=nums;
  if(nums.some(n=>!Number.isInteger(n))||x<0||y<0||w<1||h<1||x+w>original.width||y+h>original.height)throw new Error('Vùng cắt phải nằm trong ảnh, dùng số pixel nguyên.');
  const c=canvas(w,h);c.getContext('2d').drawImage(original,x,y,w,h,0,0,w,h);return c;
}
async function prepare(current,upscale=$('upscale-before-trace').checked) {
  let c=cropOriginal();const mode=$('background-mode').value;
  if(mode==='ai') {
    status('Đang tải / chạy AI tách chủ thể tại máy…');
    if(typeof OffscreenCanvas==='undefined') {
      const {removeBackgroundAI}=await import('./background-ai.js');guard(current);
      c=await removeBackgroundAI(c,{signal:current.controller.signal,onProgress:({progress:p})=>progress(p*100)});
    } else {
      const rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data.buffer;
      const out=await workerCall('./background-worker.js',{rgba,width:c.width,height:c.height},current);guard(current);
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.rgba),c.width,c.height),0,0);
    }
  } else if(mode!=='none') {
    status('Đang xóa nền theo màu…');c=await raster(c,'removeBackground',{color:$('background-color').value,tolerance:Number($('background-tolerance').value),contiguous:mode==='edge'},current);
  }
  guard(current);
  if(upscale) {
    const scale=Number($('upscale-scale').value);checkDimensions(c.width*scale,c.height*scale);
    if($('upscale-method').value==='ai') {
      status('Đang tải AI ESRGAN. Ảnh vẫn ở trên thiết bị…');progress();const {upscaleAI}=await import('./upscale-ai.js');guard(current);
      c=await upscaleAI(c,scale,{signal:current.controller.signal,onProgress:p=>{guard(current);progress(p);},onBackend:text=>{guard(current);$('upscale-info').textContent=typeof text==='string'?text:JSON.stringify(text);status('Đang làm nét bằng AI tại máy…');}});
    } else {
      const out=canvas(c.width*scale,c.height*scale),ctx=out.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(c,0,0,out.width,out.height);c=out;
    }
    guard(current);if(Number($('sharpen-amount').value))c=await raster(c,'sharpen',{amount:Number($('sharpen-amount').value)},current);
  }
  const count=Number($('palette-limit').value);if(count){status('Đang gom bảng màu trên thiết bị…');c=await raster(c,'quantize',{maxColors:count},current);}
  guard(current);return c;
}
async function showPrepared(c,current) {
  const blob=await blobOf(c);guard(current);prepared=c;clearVector();revoke(resultUrl);resultUrl=URL.createObjectURL(blob);
  $('result').src=resultUrl;$('result').hidden=false;revoke(pngUrl);pngUrl=URL.createObjectURL(blob);
  $('download-png').href=pngUrl;$('download-png').download=`${filename}_processed.png`;$('download-png').hidden=false;
  $('preview-badge').textContent='PNG đã xử lý';$('result-size').textContent=`${c.width} × ${c.height} px`;
  $('stats').textContent='So với ảnh gốc; vùng cắt giữ tỷ lệ, căn giữa khung (không cùng tọa độ gốc).';fitView();setView('split');
}
function resetPrepareOptions(){ $('background-mode').value='none';$('palette-limit').value='0';$('upscale-before-trace').checked=false;$('background-color-options').hidden=true; }
async function trace(current) {
  const params=getAdvancedParams(),c=await prepare(current);guard(current);status('Đang vector hóa bằng VTracer WASM…');progress();
  const rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data.buffer;
  const data=await workerCall('./worker.js',{rgba,width:c.width,height:c.height,preset:$('preset').value,params,alpha:document.querySelector('input[name=alpha]:checked').value,mode:$('trace-mode').value,hierarchy:$('hierarchy').value},current);guard(current);
  if(typeof data.svg!=='string')throw new Error('Kết quả vector không hợp lệ.');
  if(data.svg.length>20_000_000||(data.svg.match(/<path\b/g)||[]).length>20000)throw new Error('Kết quả quá phức tạp để chỉnh sửa an toàn (tối đa 20.000 vùng / 20 MB SVG). Tăng lọc nhiễu, giảm độ chính xác màu hoặc giới hạn bảng màu rồi thử lại.');
  const parsed=new DOMParser().parseFromString(data.svg,'image/svg+xml'),root=parsed.documentElement;
  if(root.localName!=='svg'||parsed.querySelector('parsererror')||[...root.querySelectorAll('*')].some(e=>!['path','g','title','desc'].includes(e.localName))||[...root.querySelectorAll('*')].some(e=>[...e.attributes].some(a=>/^on|href/i.test(a.name))))throw new Error('SVG chứa nội dung không được hỗ trợ.');
  history.length=0;prepared=c;svgRoot=document.importNode(root,true);$('vector-preview').replaceChildren(svgRoot);$('vector-preview').hidden=false;$('result').hidden=true;
  if($('geometry-fit').checked){history.push(serializeSVG());const fits=optimizeGeometry(svgRoot,{tolerance:.6});status(`Đã khớp ${fits.rectangles} hình chữ nhật, ${fits.ellipses} elip. Có thể hoàn tác.`);}else status('Vector sẵn sàng. Chọn vùng để sửa màu hoặc xuất file.');
  $('preview-badge').textContent='Vector có thể chỉnh';$('export-width').value=200;$('export-height').value=Number((200*c.height/c.width).toFixed(2));
  invalidateDownload();renderEditor();fitView();task=undefined;$('progress').hidden=true;goStep(4);
}
function serializeSVG(){const clean=svgRoot.cloneNode(true);for(const p of clean.querySelectorAll('[data-selected]'))p.removeAttribute('data-selected');return new XMLSerializer().serializeToString(clean);}
function paths(){return [...(svgRoot?.querySelectorAll('path')||[])];}
function selectPath(index){selectedPath=index;paths().forEach((p,i)=>i===index?p.setAttribute('data-selected','true'):p.removeAttribute('data-selected'));$('path-select').value=index<0?'':String(index);const p=paths()[index];if(p){$('region-color').value=p.getAttribute('fill');selectedColor=p.getAttribute('fill');}}
function renderEditor(){
  const list=paths();$('path-select').replaceChildren(new Option('Chọn vùng',''));list.forEach((p,i)=>{p.dataset.region=String(i);$('path-select').add(new Option(`Vùng ${i+1} · ${p.getAttribute('fill')}`,String(i)));});
  const colors=[...new Set(list.map(p=>p.getAttribute('fill')))];$('palette').replaceChildren();
  for(const color of colors.slice(0,256)){const b=document.createElement('button');b.type='button';b.style.backgroundColor=color;b.title=color;b.setAttribute('aria-label',`Chọn màu ${color}`);b.setAttribute('aria-pressed',String(selectedColor===color));b.addEventListener('click',()=>{selectedPath=-1;selectedColor=color;$('region-color').value=color;renderEditor();});$('palette').append(b);}
  $('palette-info').textContent=`${colors.length} màu${colors.length>256?' (hiện 256 màu đầu)':''}. Chọn màu để đổi/xóa mọi vùng cùng màu.`;
  $('stats').textContent=`${list.length.toLocaleString('vi-VN')} vùng · ${colors.length} màu · ${prepared?.width||original.width} × ${prepared?.height||original.height} px đầu vào`;
  $('result-size').textContent=`${(new Blob([serializeSVG()]).size/1024).toFixed(1)} KB SVG`;selectPath(selectedPath<list.length?selectedPath:-1);controls();
}
function edit(change){if(!svgRoot||task)return;const before=serializeSVG();change();if(serializeSVG()===before)return;history.push(before);if(history.length>12)history.shift();selectedPath=-1;invalidateDownload();renderEditor();status('Đã sửa vector. Có thể hoàn tác.');}
function dimensions(){return original?[original.width,original.height]:[1,1];}
function drawView(){const [w,h]=dimensions();$('stage').style.width=`${w}px`;$('stage').style.height=`${h}px`;$('stage').style.transform=`translate(${panX-w*zoom/2}px, ${panY-h*zoom/2}px) scale(${zoom})`;$('zoom-value').textContent=`${Math.round(zoom*100)}%`;}
function fitView(){if(!original)return;const r=$('viewport').getBoundingClientRect();zoom=Math.min((r.width-36)/original.width,(r.height-36)/original.height,8);panX=panY=0;drawView();}
function setView(mode){
  view=mode;for(const name of ['before','split','after'])$(`view-${name}`).setAttribute('aria-pressed',String(mode===name));
  const percent=mode==='before'?100:mode==='after'?0:Number($('compare').value),r=$('viewport').getBoundingClientRect(),[w]=dimensions();
  const left=r.width/2+panX-w*zoom/2,local=((r.width*percent/100-left)/(w*zoom))*100;
  $('after-layer').style.clipPath=`inset(0 0 0 ${mode==='before'?100:mode==='after'?0:Math.max(0,Math.min(100,local))}%)`;
  $('split-line').hidden=mode!=='split'||!original;$('split-line').style.left=`${percent}%`;
}
function updateView(){drawView();setView(view);}function zoomBy(factor){zoom=Math.min(32,Math.max(.01,zoom*factor));updateView();}
$('file').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';loadFile(f);});
for(const name of ['dragenter','dragover'])$('drop').addEventListener(name,e=>{e.preventDefault();if(!task)$('drop').classList.add('dragover');});
$('drop').addEventListener('dragleave',()=>$('drop').classList.remove('dragover'));window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>{e.preventDefault();$('drop').classList.remove('dragover');if(!task)loadFile(e.dataTransfer?.files[0]);});
window.addEventListener('paste',e=>{if(e.target.closest('input:not([type=file]),textarea,select,[contenteditable]')||task)return;const item=[...(e.clipboardData?.items||[])].find(i=>i.kind==='file');if(item){e.preventDefault();loadFile(item.getAsFile());}});
for(const b of document.querySelectorAll('[data-step]'))b.addEventListener('click',()=>goStep(Number(b.dataset.step)));
$('next-prepare').addEventListener('click',()=>goStep(2));$('next-trace').addEventListener('click',()=>goStep(3));$('cancel').addEventListener('click',()=>cancelTask());
$('options').addEventListener('change',e=>{if(e.target.id==='preset'&&$('preset').value!=='custom')syncPresetToInputs($('preset').value);else if(e.target.closest('.adv-grid'))$('preset').value='custom';$('preset-info').textContent=descriptions[$('preset').value];status('Thông số đã đổi. Tạo vector lại để áp dụng; kết quả cũ vẫn giữ.');});
$('background-mode').addEventListener('change',()=>{const mode=$('background-mode').value;$('background-color-options').hidden=!['edge','color'].includes(mode);$('background-help').textContent=mode==='ai'?'U²-Net compact nhận diện chủ thể ở 320 × 320; tóc/nét mảnh hoặc nền phức tạp có thể mất. Tải model khoảng 4,6 MB và runtime WASM lần đầu.':mode==='color'?'Xóa mọi vùng gần màu đã chọn, kể cả trong họa tiết. Hãy so preview.':'Chế độ từ mép giữ vùng cùng màu bị bao kín bên trong.';});
$('background-tolerance').addEventListener('input',()=>$('tolerance-value').value=$('background-tolerance').value);$('sharpen-amount').addEventListener('input',()=>$('sharpen-value').value=$('sharpen-amount').value);
$('pick-background').addEventListener('click',()=>{picking=!picking;$('pick-background').setAttribute('aria-pressed',String(picking));if(picking){setView('before');status('Chạm màu nền trên ảnh gốc.');}});
$('apply-prepare').addEventListener('click',()=>runTask(async current=>{const c=await prepare(current);await showPrepared(c,current);status('Đã xử lý bản sao. Có thể tải PNG hoặc vector hóa.');}));
$('btn-upscale').addEventListener('click',()=>runTask(async current=>{const c=await prepare(current,true);await showPrepared(c,current);status('PNG sẵn sàng. Nút tải nằm bên dưới.');}));
$('reset-prepare').addEventListener('click',()=>{if(!original||task)return;configureCrop();resetPrepareOptions();prepared=undefined;clearVector();$('result').src=inputUrl;$('result').hidden=false;$('preview-badge').textContent='Ảnh gốc';$('download-png').hidden=true;status('Đã trả về ảnh gốc.');fitView();setView('split');});
$('convert').addEventListener('click',()=>runTask(trace));
$('path-select').addEventListener('change',()=>selectPath($('path-select').value===''?-1:Number($('path-select').value)));
$('recolor-region').addEventListener('click',()=>edit(()=>paths()[selectedPath]?.setAttribute('fill',$('region-color').value)));$('delete-region').addEventListener('click',()=>edit(()=>paths()[selectedPath]?.remove()));
$('recolor-palette').addEventListener('click',()=>edit(()=>paths().filter(p=>p.getAttribute('fill')===selectedColor).forEach(p=>p.setAttribute('fill',$('region-color').value))));$('delete-palette').addEventListener('click',()=>edit(()=>paths().filter(p=>p.getAttribute('fill')===selectedColor).forEach(p=>p.remove())));
$('undo').addEventListener('click',()=>{if(!history.length||task)return;const doc=new DOMParser().parseFromString(history.pop(),'image/svg+xml');svgRoot=document.importNode(doc.documentElement,true);$('vector-preview').replaceChildren(svgRoot);selectedPath=-1;invalidateDownload();renderEditor();status('Đã hoàn tác.');});
for(const id of ['export-width','export-height'])$(id).addEventListener('change',()=>{invalidateDownload();if($('lock-ratio').checked&&prepared){const ratio=prepared.width/prepared.height;if(id==='export-width')$('export-height').value=Number((Number($(id).value)/ratio).toFixed(2));else $('export-width').value=Number((Number($(id).value)*ratio).toFixed(2));}});
$('export-format').addEventListener('change',()=>{invalidateDownload();const f=$('export-format').value;$('export-dpi').disabled=f!=='png';$('export-help').textContent=f==='dxf'?'DXF chỉ đường biên đa đoạn, đường cong được xấp xỉ. Không phải centerline; kiểm tra lớp chồng và đường cắt trùng.':f==='eps'?'EPS giữ vector, không hỗ trợ alpha mềm. RGB, không tự chuyển CMYK.':f==='png'?'PNG raster theo khổ mm và DPI; tối đa 16 triệu pixel. Khác SVG/PDF vector.':'Giữ vector và khổ mm. RGB, không chứng nhận CMYK/PDF/X hay đạt chuẩn máy in.';});
$('export-dpi').addEventListener('change',invalidateDownload);
$('export').addEventListener('click',()=>runTask(async current=>{
  if(!svgRoot)return;const format=$('export-format').value,widthMm=Number($('export-width').value),heightMm=Number($('export-height').value);
  if(!Number.isFinite(widthMm)||!Number.isFinite(heightMm)||widthMm<1||heightMm<1||widthMm>5000||heightMm>5000)throw new Error('Khổ xuất phải từ 1 đến 5.000 mm mỗi chiều.');
  const text=serializeSVG();status('Đang tạo file trên thiết bị…');const {exportVector}=await import('./export.js');guard(current);
  const out=await exportVector(text,format,{widthMm,heightMm,resolution:Number($('export-dpi').value)});guard(current);invalidateDownload();downloadUrl=URL.createObjectURL(out.blob);
  $('download').href=downloadUrl;$('download').download=`${filename}.${out.extension}`;$('download').textContent=`Tải ${format.toUpperCase()} (${(out.blob.size/1024).toFixed(1)} KB)`;$('download').hidden=false;status(`File ${format.toUpperCase()} sẵn sàng.${out.warnings?.length?' '+out.warnings.join(' '):''}`);
}));
for(const mode of ['before','split','after'])$(`view-${mode}`).addEventListener('click',()=>setView(mode));$('compare').addEventListener('input',()=>setView('split'));
$('zoom-in').addEventListener('click',()=>zoomBy(1.3));$('zoom-out').addEventListener('click',()=>zoomBy(1/1.3));$('zoom-fit').addEventListener('click',()=>{fitView();setView(view);});$('zoom-actual').addEventListener('click',()=>{zoom=1;panX=panY=0;updateView();});
$('viewport').addEventListener('wheel',e=>{if(!original)return;e.preventDefault();zoomBy(e.deltaY<0?1.12:1/1.12);},{passive:false});
$('viewport').addEventListener('keydown',e=>{if(e.key==='+'||e.key==='=')zoomBy(1.3);else if(e.key==='-')zoomBy(1/1.3);else if(e.key==='0'){fitView();setView(view);}});
$('viewport').addEventListener('pointerdown',e=>{if(!original)return;drag={x:e.clientX,y:e.clientY,px:panX,py:panY,target:e.target};$('viewport').setPointerCapture(e.pointerId);});
$('viewport').addEventListener('pointermove',e=>{if(!drag)return;panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;updateView();});
$('viewport').addEventListener('pointerup',e=>{
  if(!drag)return;const clicked=Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5,target=drag.target;drag=undefined;if(!clicked||task)return;
  if(picking){const r=$('stage').getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/zoom),y=Math.floor((e.clientY-r.top)/zoom);if(x>=0&&y>=0&&x<original.width&&y<original.height){const p=original.getContext('2d').getImageData(x,y,1,1).data;$('background-color').value='#'+[...p.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('');picking=false;$('pick-background').setAttribute('aria-pressed','false');status('Đã chọn màu nền. Bấm Xem ảnh đã xử lý để áp dụng.');}}
  else if(step===4&&target.closest('path'))selectPath(Number(target.closest('path').dataset.region));
});
$('viewport').addEventListener('pointercancel',()=>drag=undefined);window.addEventListener('resize',()=>{fitView();setView(view);});window.addEventListener('pagehide',()=>{if(task)cancelTask('Đã dừng tác vụ khi rời trang.');});
$('demo').addEventListener('click',async()=>{if(task)return;const c=canvas(480,360),ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,480,360);ctx.fillStyle='#2057cf';ctx.beginPath();ctx.arc(240,180,118,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f3c850';ctx.beginPath();ctx.moveTo(240,72);ctx.lineTo(350,250);ctx.lineTo(130,250);ctx.closePath();ctx.fill();ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(240,205,34,0,Math.PI*2);ctx.fill();await loadFile(new File([await blobOf(c)],'mau-hinh-hoc.png',{type:'image/png'}));});
syncPresetToInputs('don_gian');controls();

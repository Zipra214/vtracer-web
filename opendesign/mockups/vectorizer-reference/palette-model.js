// Dữ liệu minh họa độc lập; không lấy màu từ ảnh hoặc gọi VTracer.
export const sources = Object.freeze([
  ['#d93627', 6], ['#ed4934', 4], ['#ff7918', 12], ['#ff9435', 7],
  ['#f8a34c', 6], ['#ffc17f', 4], ['#ffe5b6', 15], ['#ffedc9', 9],
  ['#fbd9a3', 5], ['#fff3d9', 7], ['#fffef8', 9], ['#f8f7ed', 5],
  ['#fff9e8', 4], ['#87501f', 3], ['#9d622e', 2], ['#e9a650', 1],
  ['#f3bfaf', 1], ['#eeb19e', 1], ['#ffffff', 16],

].map(([hex, weight], id) => Object.freeze({ id, hex, weight })));
export const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(c => parseInt(c, 16));
export function initialGroups() {
  return [[0, 1], [2, 3, 4, 5], [6, 7, 8, 9], [10, 11, 12], [13, 14], [15], [16, 17], [18]]
    .map(ids => ({ id: ids[0], hex: sources[ids[0]].hex, sources: ids }));
}
export const weight = group => group.sources.reduce((sum, id) => sum + sources[id].weight, 0);
export function merge(groups, from, into, sourceId = null) {
  const a = groups.find(g => g.id === from), b = groups.find(g => g.id === into);
  if (!a || !b || a === b || (sourceId !== null && !a.sources.includes(sourceId))) throw new RangeError('Nhóm màu không hợp lệ.');
  const ids = sourceId === null ? a.sources : [sourceId];
  return groups.map(g => {
    const members = g === b ? [...g.sources, ...ids] : g.sources.filter(id => !ids.includes(id));
    return { ...g, id: g === a && members.length ? members[0] : g.id, sources: members };
  }).filter(g => g.sources.length);
}
export function split(groups, groupId, sourceId = null) {
  const group = groups.find(g => g.id === groupId);
  if (!group || (sourceId !== null && !group.sources.includes(sourceId))) throw new RangeError('Màu gốc không hợp lệ.');
  if (group.sources.length === 1) return groups;
  const ids = sourceId === null ? group.sources : [sourceId];
  const remaining = group.sources.filter(id => !ids.includes(id));
  // IDs lấy từ màu gốc; cấp lại ID phần còn lại để tránh trùng khi tách màu đại diện.
  return groups.filter(g => g !== group).concat(remaining.length ? [{ ...group, id: remaining[0], sources: remaining }] : [],
    ids.map(id => ({ id, hex: sources[id].hex, sources: [id] })));
}
export function removeColor(groups, groupId, sourceId = null) {
  const group = groups.find(g => g.id === groupId);
  if (!group || (sourceId !== null && !group.sources.includes(sourceId))) throw new RangeError('Màu không hợp lệ.');
  if (sourceId === null) return groups.filter(g => g !== group);
  return groups.map(g => {
    if (g !== group) return g;
    const remaining = g.sources.filter(id => id !== sourceId);
    return { ...g, id: remaining[0], sources: remaining };
  }).filter(g => g.sources.length);
}
export function recolor(groups, id, hex) {
  if (!/^#[a-f\d]{6}$/i.test(hex) || !groups.some(g => g.id === id)) throw new RangeError('Nhập HEX dạng #RRGGBB.');
  return groups.map(g => g.id === id ? { ...g, hex: hex.toLowerCase() } : g);
}
export function preset(count) {
  if (!Number.isInteger(count) || count < 1 || count > sources.length) throw new RangeError('Số màu từ 1 đến 18.');
  let groups = sources.map(s => ({ id: s.id, hex: s.hex, sources: [s.id] }));
  // ponytail: gom gần nhất trong RGB cho 18 màu mẫu; tích hợp thật cần bộ gom màu ảnh riêng.
  while (groups.length > count) {
    let pair, best = Infinity;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = rgb(groups[i].hex), b = rgb(groups[j].hex);
      const distance = a.reduce((sum, value, k) => sum + (value - b[k]) ** 2, 0);
      if (distance < best) { best = distance; pair = [groups[i], groups[j]]; }
    }
    const [a, b] = pair;
    groups = weight(a) > weight(b) ? merge(groups, b.id, a.id) : merge(groups, a.id, b.id);
  }
  return groups;
}
// ponytail: RGB kèm kiểm tra sắc độ tránh lẫn hồng/cam; nâng OKLab khi cần phân nhóm cảm nhận chính xác hơn.
function sameTone(a,b){
  const hsv=hex=>{const c=rgb(hex),max=Math.max(...c),min=Math.min(...c),d=max-min;return {s:max?d/max:0,h:!d?0:((max===c[0]?(c[1]-c[2])/d+6:max===c[1]?(c[2]-c[0])/d+2:(c[0]-c[1])/d+4)%6)*60};};
  const x=hsv(a),y=hsv(b),h=Math.abs(x.h-y.h);
  return Math.abs(x.s-y.s)<=.13&&(Math.max(x.s,y.s)<.08||Math.min(h,360-h)<=12)&&Math.hypot(...rgb(a).map((v,i)=>v-rgb(b)[i]))<=36;;
}
export function toneGroups(records) {
  const colors = new Map();
  for (const record of records) {
    if (!colors.has(record.hex)) colors.set(record.hex, {hex: record.hex, records: [], weight: 0});
    const color = colors.get(record.hex);color.records.push(record);color.weight += record.weight;
  }
  const groups = [];
  for (const color of [...colors.values()].sort((a,b)=>b.weight-a.weight)) {
    const group = groups.find(g => sameTone(g.hex,color.hex));
    if (group) group.records.push(...color.records);
    else groups.push({hex: color.hex, records: [...color.records]});
  }
  return groups;
}
export function weightedChildren(colors, radius, totalWeight) {
  if (!colors.length) return [];
  // ponytail: tới 64 màu dùng packing theo trọng số; hơn dùng vòng đồng tâm
  // để không khóa UI khi ảnh có hàng nghìn màu trong cùng cụm.
  if (colors.length > 64) {
    const weights = new Map(colors.map(c=>[c.hex,c.weight]));
    return nestedCircles(colors.map(c=>c.hex),radius).map(c=>({ ...c,
      r: Math.min(c.r, radius * .8 * Math.sqrt(weights.get(c.hex) / totalWeight)) }));
  }
  const circles = pack(colors.map(c=>({hex:c.hex,r:30*.8*Math.sqrt(c.weight/totalWeight)})));
  const extent = Math.max(...circles.map(c=>Math.hypot(c.x,c.y)+c.r));
  const scale = radius / Math.max(30,extent);
  return circles.map(c=>({...c,x:c.x*scale,y:c.y*scale,r:c.r*scale}));
}
export function anchoredPalette(groups, width = 520) {
  const tone = hex => {
    const [r,g,b]=rgb(hex),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    const hue=!d?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
    return {band:d<24?-1:Math.floor(hue),light:.2126*r+.7152*g+.0722*b};
  };
  const total=groups.reduce((sum,g)=>sum+g.records.reduce((s,r)=>s+r.weight,0),0)||1;
  const entries=groups.map(group=>{
    const weights=new Map();for(const r of group.records)weights.set(r.hex,(weights.get(r.hex)||0)+r.weight);
    const colors=[...weights].map(([hex,weight])=>({hex,weight}));
    const weight=colors.reduce((s,c)=>s+c.weight,0),base=Math.max(16,58*Math.sqrt(weight/total));
    const nested=colors.length>1||colors[0]?.hex!==group.hex;
    // ponytail: 12 sắc mỗi trang giữ cụm gọn; màu còn lại truy cập bằng nút trang.
    colors.sort((a,b)=>b.weight-a.weight||a.hex.localeCompare(b.hex));
    const pages=Math.ceil(colors.length/12),page=Math.max(0,Math.min(pages-1,group.page||0));
    let children=[];
    if(nested){
      const sizes=colors.slice(page*12,page*12+12).map(c=>({...c,r:Math.max(8,base*.6*Math.sqrt(c.weight/weight))}));
      children=pack(sizes,Infinity,5);
    }
    const radius=Math.max(base,...children.map(c=>Math.hypot(c.x,c.y)+c.r+9));
    return {group,r:radius,children,page,pages,...tone(group.hex)};
  }).sort((a,b)=>a.band-b.band||b.light-a.light||a.group.hex.localeCompare(b.group.hex));
  width=Math.max(width,...entries.map(e=>2*e.r+24));
  let y=12;
  const count=Math.max(2,Math.min(8,Math.floor(width/80)));
  for(let start=0;start<entries.length;){
    let size=Math.min(count,entries.length-start),batch,placed,left,right;
    do{
      batch=entries.slice(start,start+size);placed=pack(batch.map((e,i)=>({id:i,r:Math.max(e.r,e.pages>1?40:0)+(e.pages>1?17:0)})),Infinity,8);
      let best=null;
      for(let turn=0;turn<24;turn++){
        const angle=turn*Math.PI/12,rotated=placed.map(p=>({...p,x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)}));
        const l=Math.min(...rotated.map(p=>p.x-p.r)),r=Math.max(...rotated.map(p=>p.x+p.r)),h=Math.max(...rotated.map(p=>p.y+p.r))-Math.min(...rotated.map(p=>p.y-p.r));
        if(r-l<=width-24&&(!best||h<best.height))best={placed:rotated,left:l,right:r,height:h};
      }
      if(best){placed=best.placed;left=best.left;right=best.right;break;}
      left=Math.min(...placed.map(p=>p.x-p.r));right=Math.max(...placed.map(p=>p.x+p.r));
      if(size===1)break;size--;
    }while(size);
    const top=Math.min(...placed.map(p=>p.y-p.r)),bottom=Math.max(...placed.map(p=>p.y+p.r));
    for(const p of placed){const e=batch[p.id];e.x=width/2+p.x-(left+right)/2;e.y=y+p.y-top;}
    y+=bottom-top+18;start+=size;
  }
  return {entries,width,height:Math.max(240,y)};
}
// Các vòng đồng tâm giữ mọi màu con trong bóng cha, không giới hạn số màu hiển thị.
export function nestedCircles(colors, radius) {
  const rings = Math.ceil((Math.sqrt(12 * colors.length - 3) - 3) / 6);
  const r = Math.min(radius / 2, radius / (2 * rings + 1));
  let index = 0;
  const circles = [];
  for (let ring = 0; index < colors.length; ring++) {
    const count = ring ? 6 * ring : 1;
    for (let i = 0; i < count && index < colors.length; i++) {
      const angle = i * Math.PI * 2 / count;
      circles.push({ hex: colors[index++], r, x: 2 * ring * r * Math.cos(angle), y: 2 * ring * r * Math.sin(angle) });
    }
  }
  return circles;
}
// Đặt vòng tròn không chồng nhau; trả tọa độ dùng chung cho biểu đồ và kiểm thử.
export function pack(circles, containerRadius = Infinity, gap = 1) {
  const placed = [];
  for (const circle of [...circles].sort((a, b) => b.r - a.r)) {
    let found;
    for (let step = 0; step < 60000; step++) {
      const distance = Math.sqrt(step) * 0.7, angle = step * 2.399963;
      const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance;
      if (distance + circle.r > containerRadius) continue;
      if (placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + circle.r + gap)) {
        found = { ...circle, x, y }; break;
      }
    }
    if (!found) throw new RangeError('Không đủ chỗ cho bong bóng.');
    placed.push(found);
  }
  return placed;
}

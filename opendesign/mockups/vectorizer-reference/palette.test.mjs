// Run: node opendesign/mockups/vectorizer-reference/palette.test.mjs
import assert from 'node:assert/strict';
import { sources, totalWeight, initialGroups, weight, merge, split, recolor, removeColor, preset, pack, nestedCircles, toneGroups, weightedChildren, anchoredPalette } from './palette-model.js';
function valid(groups) {
  assert.deepEqual(groups.flatMap(g => g.sources).sort((a,b)=>a-b), sources.map(s=>s.id));
  assert.equal(new Set(groups.map(g=>g.id)).size, groups.length);
  assert.equal(groups.reduce((sum,g)=>sum+weight(g),0), totalWeight);
  for (const g of groups) assert.ok(g.sources.includes(g.id));
  const circles=pack(groups.map(g=>({id:g.id,r:11*Math.sqrt(weight(g))})));
  for(const p of circles){
    const g=groups.find(g=>g.id===p.id);
    const children=pack(g.sources.map(id=>({id,r:3.3*Math.sqrt(sources[id].weight)})),p.r-3);
    for(const c of children) assert.ok(Math.hypot(c.x,c.y)+c.r<=p.r-3+1e-8);
    for(const q of circles) if(p!==q) assert.ok(Math.hypot(p.x-q.x,p.y-q.y)>=p.r+q.r+1-1e-8);
  }
}
for(let n=1;n<=18;n++){const groups=preset(n);assert.equal(groups.length,n);valid(groups);}
let groups=initialGroups();valid(groups);
groups=merge(groups,0,2,0);valid(groups);assert.equal(groups.find(g=>g.id===1).sources.length,1);
groups=split(groups,2,2);valid(groups);
groups=recolor(groups,2,'#123AbC');assert.equal(groups.find(g=>g.id===2).hex,'#123abc');valid(groups);
for(const g of [...groups]){groups=split(groups,g.id);valid(groups);}assert.equal(groups.length,sources.length);
assert.throws(()=>merge(groups,999,2),RangeError);assert.throws(()=>recolor(groups,2,'red'),RangeError);
assert.throws(()=>preset(sources.length+1),RangeError);assert.throws(()=>split(groups,0,17),RangeError);
assert.deepEqual(initialGroups(),initialGroups());
const noBackground=removeColor(initialGroups(),18);
assert.ok(!noBackground.some(g=>g.sources.includes(18)));
const partial=removeColor(initialGroups(),0,0);
assert.deepEqual(partial.find(g=>g.id===1).sources,[1]);
assert.equal(new Set(partial.map(g=>g.id)).size,partial.length);
let empty=initialGroups();for(const g of [...empty])empty=removeColor(empty,g.id);
assert.deepEqual(empty,[]);assert.deepEqual(pack([]),[]);
assert.throws(()=>removeColor(initialGroups(),999),RangeError);
assert.throws(()=>removeColor(initialGroups(),0,18),RangeError);
assert.ok(initialGroups().some(g=>g.hex==='#ffffff'));
for (const count of [1, 2, 7, 8, 40, 100, 1000]) {
  const colors = Array.from({length: count}, (_, i) => String(i));
  const circles = nestedCircles(colors, 30);
  assert.deepEqual(circles.map(c => c.hex), colors);
  for (const c of circles) {
    assert.ok(Math.hypot(c.x, c.y) + c.r <= 30 + 1e-8);
    for (const d of circles) if (c !== d) assert.ok(Math.hypot(c.x-d.x,c.y-d.y) >= c.r+d.r-1e-8);
  }
}
assert.deepEqual(nestedCircles([], 30), []);
const records=[{hex:'#ff553f',weight:9},{hex:'#f9604d',weight:2},{hex:'#ffffff',weight:5},{hex:'#f8f4ef',weight:1},{hex:'#30180e',weight:1}];
const tones=toneGroups(records);
assert.equal(tones.length,3);
assert.deepEqual(new Set(tones.flatMap(g=>g.records)),new Set(records));
assert.equal(tones[0].hex,'#ff553f');
assert.equal(toneGroups([{hex:'#e9a650',weight:8},{hex:'#f3bfaf',weight:1}]).length,2,'Pink must not enter orange cluster');
const children=weightedChildren([{hex:'#ff553f',weight:9},{hex:'#f9604d',weight:2}],50,11);
assert.ok(children.find(c=>c.hex==='#ff553f').r>children.find(c=>c.hex==='#f9604d').r);
for(const c of children)assert.ok(Math.hypot(c.x,c.y)+c.r<=50+1e-8);
assert.deepEqual(weightedChildren([],50,1),[]);
for(const count of [2,24,25,1000]){
 const group={hex:'#ffffff',records:Array.from({length:count},(_,i)=>({hex:'#'+i.toString(16).padStart(6,'0'),weight:i?1e-8:1}))};
 const seen=new Set();for(let page=0;page<Math.ceil(count/12);page++){group.page=page;const e=anchoredPalette([group],320).entries[0];for(const c of e.children)seen.add(c.hex);}assert.equal(seen.size,count);group.page=0;
 const layout=anchoredPalette([group,...tones],320);
 assert.deepEqual(layout,anchoredPalette([group,...tones],320));
 for(const p of layout.entries){
  assert.ok(p.r>=16);assert.ok(p.r<150);assert.ok(p.children.length<=12);
  for(const c of p.children){assert.ok(c.r>=8);assert.ok(Math.hypot(c.x,c.y)+c.r<=p.r-8.99);}
  for(const q of layout.entries)if(p!==q)assert.ok(Math.hypot(p.x-q.x,p.y-q.y)>=p.r+q.r);
 }
}
const paged={hex:'#bb9900',page:1,records:Array.from({length:13},(_,i)=>({hex:'#'+(0xbb9900+i).toString(16),weight:1}))};
const neighbor={...paged,hex:'#ccaa00',records:paged.records.map(r=>({...r}))};
const pageLayout=anchoredPalette([paged,neighbor,{hex:'#ffffff',records:[{hex:'#ffffff',weight:10000}]}]);
const buttons=pageLayout.entries.filter(e=>e.pages>1);
assert.ok(Math.abs(buttons[0].x-buttons[1].x)>=80||Math.abs(buttons[0].y-buttons[1].y)>=28);
const greys=anchoredPalette(['#111111','#ffffff','#888888'].map(hex=>({hex,records:[{hex,weight:1}]})));
assert.deepEqual(greys.entries.map(e=>e.group.hex),['#ffffff','#888888','#111111']);
console.log('PASS: palette clusters, minimum targets, fixed non-overlapping anchors and light–dark order');

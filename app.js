import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const $=id=>document.getElementById(id);
const uid=()=>crypto.randomUUID?.()||Date.now()+"-"+Math.random();
const DB_NAME="DeepuNotesV3", STATE_STORE="state", FILE_STORE="files";
let db,state,notebookId,sectionId,pageId,tool="pen",drawing=false,activePointer=null,currentStroke=null,finger=null;
let undoStack=[],redoStack=[],pdfCache=new Map();

function fresh(){
  const p={id:uid(),title:"Welcome",background:"ruled",strokes:[],texts:[],images:[]};
  const s={id:uid(),name:"General",pages:[p]};
  const n={id:uid(),name:"Zoology",sections:[s]};
  return {notebooks:[n],currentNotebookId:n.id,currentSectionId:s.id,currentPageId:p.id};
}
function nb(){return state?.notebooks.find(x=>x.id===notebookId)}
function sec(){return nb()?.sections.find(x=>x.id===sectionId)}
function page(){return sec()?.pages.find(x=>x.id===pageId)}
function sync(){state.currentNotebookId=notebookId;state.currentSectionId=sectionId;state.currentPageId=pageId}

function openDB(){return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB_NAME,1);
  r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STATE_STORE))d.createObjectStore(STATE_STORE);if(!d.objectStoreNames.contains(FILE_STORE))d.createObjectStore(FILE_STORE)};
  r.onsuccess=()=>{db=r.result;resolve()};r.onerror=()=>reject(r.error)
})}
function getState(){return new Promise((resolve,reject)=>{const r=db.transaction(STATE_STORE).objectStore(STATE_STORE).get("state");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function putState(v){return new Promise((resolve,reject)=>{const r=db.transaction(STATE_STORE,"readwrite").objectStore(STATE_STORE).put(v,"state");r.onsuccess=resolve;r.onerror=()=>reject(r.error)})}
function putFile(id,v){return new Promise((resolve,reject)=>{const r=db.transaction(FILE_STORE,"readwrite").objectStore(FILE_STORE).put(v,id);r.onsuccess=resolve;r.onerror=()=>reject(r.error)})}
function getFile(id){return new Promise((resolve,reject)=>{const r=db.transaction(FILE_STORE).objectStore(FILE_STORE).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function save(){sync();$("saveStatus").textContent="Saving…";await putState(state);$("saveStatus").textContent="Saved locally"}

function normalise(){
  if(!state?.notebooks?.length)state=fresh();
  for(const n of state.notebooks){
    n.sections??=[];if(!n.sections.length)n.sections.push({id:uid(),name:"General",pages:[]});
    for(const s of n.sections){
      s.pages??=[];if(!s.pages.length)s.pages.push({id:uid(),title:"Untitled Page",background:"blank",strokes:[],texts:[],images:[]});
      for(const p of s.pages){p.strokes??=[];p.texts??=[];p.images??=[];p.background??="blank"}
    }
  }
  notebookId=state.currentNotebookId;if(!state.notebooks.some(n=>n.id===notebookId))notebookId=state.notebooks[0].id;
  sectionId=state.currentSectionId;if(!nb().sections.some(s=>s.id===sectionId))sectionId=nb().sections[0].id;
  pageId=state.currentPageId;if(!sec().pages.some(p=>p.id===pageId))pageId=sec().pages[0].id;sync()
}
function snapshot(){return JSON.stringify(state)}
function pushUndo(){undoStack.push(snapshot());if(undoStack.length>40)undoStack.shift();redoStack=[]}
async function undo(){if(!undoStack.length)return;redoStack.push(snapshot());state=JSON.parse(undoStack.pop());normalise();render();await save()}
async function redo(){if(!redoStack.length)return;undoStack.push(snapshot());state=JSON.parse(redoStack.pop());normalise();render();await save()}

function renderOverlays(){
  const layer=$("textLayer");
  layer.innerHTML="";
  const p=page();
  if(!p)return;
  for(const t of (p.texts||[])){
    const el=document.createElement("div");
    el.className="textBox";el.contentEditable="true";el.textContent=t.text||"";
    el.style.left=(t.x||0)+"px";el.style.top=(t.y||0)+"px";el.style.width=(t.w||240)+"px";
    el.oninput=()=>{t.text=el.textContent;save()};
    layer.appendChild(el);
  }
  for(const im of (p.images||[])){
    const el=document.createElement("div");el.className="imageBox";
    el.style.left=(im.x||0)+"px";el.style.top=(im.y||0)+"px";el.style.width=(im.w||260)+"px";
    const img=document.createElement("img");img.src=im.src;img.style.width="100%";el.appendChild(img);layer.appendChild(el);
  }
}

function renderSurface(){
  const wrap=$("canvasWrap"),p=page();
  if(!wrap||!p)return;
  const nav=$("pdfNav");
  if(p.pdfFileId){
    nav.hidden=false;
    $("pdfPageLabel").textContent=`PDF page ${p.pdfPageNumber||1} / ${p.pdfPageCount||1}`;
    $("pdfPrev").disabled=(p.pdfPageNumber||1)<=1;
    $("pdfNext").disabled=(p.pdfPageNumber||1)>=(p.pdfPageCount||1);
    renderPdfPage(p,p.pdfPageNumber||1).then(()=>{renderInk();renderOverlays()}).catch(e=>console.error(e));
  }else{
    nav.hidden=true;
    const available=Math.max(320,wrap.clientWidth-24);
    const w=Math.min(1100,available),h=Math.max(1100,Math.floor(w*1.414));
    resizeSurface(w,h);renderInk();renderOverlays();
  }
}

async function renderPdf(){
  const p=page();
  if(!p?.pdfFileId)return;
  return renderPdfPage(p,p.pdfPageNumber||1);
}

function render(){
  const n=nb(),s=sec(),p=page();
  $("notebookList").innerHTML="";
  for(const x of state.notebooks){
    const row=document.createElement("div");row.className="itemRow";
    const b=document.createElement("button");b.className="notebook "+(x.id===notebookId?"active":"");b.textContent="📓 "+x.name;
    b.onclick=()=>{notebookId=x.id;sectionId=x.sections[0].id;pageId=x.sections[0].pages[0].id;render();save()};
    const d=document.createElement("button");d.className="deleteBtn";d.textContent="×";d.title="Delete notebook";d.onclick=e=>{e.stopPropagation();deleteNotebook(x.id)};
    row.append(b,d);$("notebookList").append(row)
  }
  $("breadcrumbs").textContent=n?`${n.name} / ${s.name}`:"DeepuNotes";$("sectionName").textContent=s?.name||"General";
  $("pageList").innerHTML="";
  if(s)for(const x of s.pages){
    const row=document.createElement("div");row.className="itemRow";
    const b=document.createElement("button");b.className="pageItem "+(x.id===pageId?"active":"");b.textContent=(x.pdfFileId?"📕 ":"📄 ")+x.title;
    b.onclick=()=>{pageId=x.id;render();save()};
    const d=document.createElement("button");d.className="deleteBtn";d.textContent="×";d.title="Delete page";d.onclick=e=>{e.stopPropagation();deletePage(x.id)};
    row.append(b,d);$("pageList").append(row)
  }
  $("emptyState").hidden=!!p;$("pageView").hidden=!p;
  if(p){$("pageTitle").value=p.title;document.querySelectorAll(".bgBtn").forEach(b=>b.classList.toggle("active",b.dataset.bg===(p.background||"blank")));$("canvasWrap").className="canvasWrap "+(p.pdfFileId?"pdfMode":(p.background||"blank"));renderSurface()}
}
function deletePage(id){
  if(sec().pages.length<=1)return alert("A section must keep at least one page. Create another page first.");
  if(!confirm("Delete this page?"))return;pushUndo();
  const i=sec().pages.findIndex(p=>p.id===id);sec().pages.splice(i,1);pageId=sec().pages[Math.max(0,i-1)].id;render();save()
}
function deleteNotebook(id){
  if(state.notebooks.length<=1)return alert("DeepuNotes must keep at least one notebook. Create another notebook first.");
  const n=state.notebooks.find(x=>x.id===id);if(!confirm(`Delete “${n.name}” and all its pages?`))return;pushUndo();
  const i=state.notebooks.findIndex(x=>x.id===id);state.notebooks.splice(i,1);notebookId=state.notebooks[Math.max(0,i-1)].id;sectionId=nb().sections[0].id;pageId=sec().pages[0].id;render();save()
}
function movePage(dir){
  const a=sec().pages,i=a.findIndex(p=>p.id===pageId),j=i+dir;if(j<0||j>=a.length)return;pushUndo();[a[i],a[j]]=[a[j],a[i]];render();save()
}

function resizeSurface(w,h){
  const wrap=$("canvasWrap"),nc=$("noteCanvas"),pc=$("pdfCanvas"),tl=$("textLayer"),d=window.devicePixelRatio||1;
  w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));
  wrap.style.setProperty("--page-height",h+"px");
  wrap.style.setProperty("--page-width",w+"px");
  for(const c of [nc,pc]){c.width=Math.round(w*d);c.height=Math.round(h*d);c.style.width=w+"px";c.style.height=h+"px"}
  tl.style.width=w+"px";tl.style.height=h+"px";
}
function point(ev){const r=$("noteCanvas").getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top,p:ev.pressure||.5}}
function ctx(c){const x=c.getContext("2d");x.lineCap="round";x.lineJoin="round";return x}
function drawStroke(st){
  const pts=st.points||[];if(!pts.length)return;const x=ctx($("noteCanvas"));x.save();x.strokeStyle=st.color;x.globalAlpha=st.tool==="highlighter"?.25:1;x.lineWidth=st.width;
  x.beginPath();x.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];x.quadraticCurveTo(a.x,a.y,(a.x+b.x)/2,(a.y+b.y)/2)}x.lineTo(pts.at(-1).x,pts.at(-1).y);x.stroke();x.restore()
}
function segment(a,b,st){
  const x=ctx($("noteCanvas"));x.save();x.strokeStyle=st.color;x.globalAlpha=st.tool==="highlighter"?.25:1;x.lineWidth=st.tool==="highlighter"?st.width:st.width*(.72+.56*(b.p||.5));x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke();x.restore()
}
function renderInk(){
  const c=$("noteCanvas"),x=c.getContext("2d"),d=window.devicePixelRatio||1;x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,c.width,c.height);x.setTransform(d,0,0,d,0,0);
  for(const st of (page()?.strokes||[]))drawStroke(st)
}
function erase(q){
  const before=page().strokes.length;page().strokes=page().strokes.filter(st=>!(st.points||[]).some(a=>Math.hypot(a.x-q.x,a.y-q.y)<Math.max(18,st.width*3)));
  if(before!==page().strokes.length)renderInk()
}

function beginInk(ev){
  if(!page())return;
  ev.preventDefault();
  drawing=true;activePointer=ev.pointerId;
  const q=point(ev);
  $("pencilHint").classList.add("hidden");
  if(tool==="text"){pushUndo();page().texts.push({id:uid(),x:q.x,y:q.y,w:240,text:"Type here"});renderOverlays();save();drawing=false;return}
  if(tool==="eraser"){pushUndo();erase(q);return}
  const base=+$(`size`).value||3;
  currentStroke={id:uid(),tool,color:tool==="highlighter"?"#facc15":$("color").value,width:tool==="highlighter"?Math.max(10,base*3):base,points:[q]};
  page().strokes.push(currentStroke);segment(q,q,currentStroke);
}
function moveInk(ev){
  if(!drawing||ev.pointerId!==activePointer)return;ev.preventDefault();
  const q=point(ev);
  if(tool==="eraser"){erase(q);return}
  if(!currentStroke)return;const a=currentStroke.points.at(-1);currentStroke.points.push(q);if(a)segment(a,q,currentStroke);
}
function endInk(ev){
  if(ev.pointerId!==activePointer)return;
  drawing=false;activePointer=null;currentStroke=null;
  try{$("noteCanvas").releasePointerCapture?.(ev.pointerId)}catch{}
  setTimeout(save,20);
}

// iPad Pencil input: Apple Pencil draws directly on the ink canvas.
// Finger input is deliberately left to native scrolling; this avoids Safari
// treating the Pencil as a page-scroll gesture or switching into Scribble.
function pointerDown(ev){
  if(!page())return;
  if(ev.pointerType==='pen' || ev.pointerType==='mouse'){
    ev.preventDefault();
    try{ev.currentTarget.setPointerCapture?.(ev.pointerId)}catch{}
    beginInk(ev);
  }
}
function pointerMove(ev){
  if((ev.pointerType==='pen'||ev.pointerType==='mouse')&&drawing&&ev.pointerId===activePointer){
    ev.preventDefault();
    moveInk(ev);
  }
}
function pointerUp(ev){
  if((ev.pointerType==='pen'||ev.pointerType==='mouse')&&ev.pointerId===activePointer){
    ev.preventDefault();
    endInk(ev);
  }
}

// Attach the drawing listeners to the actual ink canvas, with capture on the
// writing surface as a fallback for iPad Safari. Touch is never intercepted.
const canvas=$('noteCanvas'),surface=$('canvasWrap');
canvas.style.touchAction='none';
canvas.style.pointerEvents='auto';
surface.style.touchAction='pan-x pan-y';
for(const ev of ['pointerdown','pointermove','pointerup','pointercancel']){
  canvas.addEventListener(ev,ev==='pointerdown'?pointerDown:ev==='pointermove'?pointerMove:pointerUp,{passive:false});
}
// Safari can route Pencil events through a parent when layers overlap.
for(const ev of ['pointerdown','pointermove','pointerup','pointercancel']){
  surface.addEventListener(ev,e=>{
    if(e.pointerType!=='pen')return;
    if(ev==='pointerdown' && e.target!==canvas) pointerDown(e);
    else if(ev==='pointermove') pointerMove(e);
    else if(ev==='pointerup'||ev==='pointercancel') pointerUp(e);
  },{passive:false,capture:true});
}
for(const el of [surface,canvas])for(const ev of ['selectstart','dragstart','contextmenu'])el.addEventListener(ev,e=>e.preventDefault());


async function importPdf(file){
  const buf=await file.arrayBuffer(),id=uid();await putFile(id,buf);
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;pdfCache.set(id,pdf);pushUndo();
  const p={id:uid(),title:`PDF — ${file.name}`,background:"blank",strokes:[],texts:[],images:[],pdfFileId:id,pdfPageNumber:1,pdfPageCount:pdf.numPages,pdfName:file.name,pdfAnnotations:{}};
  sec().pages.push(p);pageId=p.id;render();await save();
}

function pdfAnnotationBucket(p,n=p.pdfPageNumber){
  p.pdfAnnotations??={};
  p.pdfAnnotations[n]??={strokes:[],texts:[],images:[]};
  return p.pdfAnnotations[n];
}
function activatePdfPage(n){
  const p=page();if(!p?.pdfFileId)return;
  // Move annotations for the currently displayed PDF page into the active page arrays.
  p.pdfAnnotations??={};
  p.pdfAnnotations[p.pdfPageNumber]={strokes:p.strokes||[],texts:p.texts||[],images:p.images||[]};
  p.pdfPageNumber=Math.max(1,Math.min(p.pdfPageCount||1,n));
  const a=pdfAnnotationBucket(p);p.strokes=a.strokes||[];p.texts=a.texts||[];p.images=a.images||[];
  render();save();
}

async function renderPdfPage(p,n){
  const pdf=pdfCache.get(p.pdfFileId)||await (async()=>{const data=await getFile(p.pdfFileId);const x=await pdfjsLib.getDocument({data}).promise;pdfCache.set(p.pdfFileId,x);return x})();
  const pg=await pdf.getPage(n),base=pg.getViewport({scale:1});
  const maxW=Math.min(1100,Math.max(650,$("canvasWrap").clientWidth-40)),vp=pg.getViewport({scale:maxW/base.width});
  resizeSurface(vp.width,vp.height);
  const c=$("pdfCanvas"),x=c.getContext("2d"),d=window.devicePixelRatio||1;x.setTransform(d,0,0,d,0,0);await pg.render({canvasContext:x,viewport:vp}).promise;
  return {width:vp.width,height:vp.height};
}

async function pageImage(p){
  const oldPageId=pageId,oldStrokes=page()?.strokes,oldTexts=page()?.texts,oldImages=page()?.images,oldNum=page()?.pdfPageNumber;
  pageId=p.id;
  let numbers=[p.pdfFileId?Array.from({length:p.pdfPageCount||1},(_,i)=>i+1):null].flat().filter(Boolean);
  const nlist=numbers.length?numbers:[null];
  const images=[];
  for(const n of nlist){
    if(p.pdfFileId){
      const a=p.pdfAnnotations?.[n]||{strokes:[],texts:[],images:[]};
      p.strokes=a.strokes||[];p.texts=a.texts||[];p.images=a.images||[];
      await renderPdfPage(p,n);renderInk();renderOverlays();
    }else{
      await renderPdf();renderInk();renderOverlays();
    }
    const base=$("pdfCanvas"),ink=$("noteCanvas"),w=base.width||ink.width,h=base.height||ink.height;
    const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d");
    if(p.pdfFileId)x.drawImage(base,0,0);else{x.fillStyle="#fff";x.fillRect(0,0,w,h)}
    x.drawImage(ink,0,0);
    for(const t of p.texts||[]){x.fillStyle="#111827";x.font=`${16*(window.devicePixelRatio||1)}px sans-serif`;x.fillText(t.text||"",t.x*(window.devicePixelRatio||1),(t.y+20)*(window.devicePixelRatio||1))}
    images.push(c.toDataURL("image/png"));
  }
  pageId=oldPageId;
  if(page()){page().strokes=oldStrokes;page().texts=oldTexts;page().images=oldImages;page().pdfPageNumber=oldNum}
  return images;
}
async function exportSectionPdf(){
  if(!window.jspdf?.jsPDF)return alert("PDF export library did not load. Open DeepuNotes while online and try again.");
  const {jsPDF}=window.jspdf,pages=sec().pages;if(!pages.length)return;
  const out=[];
  for(const p of pages){const imgs=await pageImage(p);out.push(...imgs)}
  const first=out[0],props=jsPDF.API.getImageProperties(first);
  const pdf=new jsPDF({orientation:props.width>=props.height?"landscape":"portrait",unit:"pt",format:[props.width,props.height]});
  pdf.addImage(first,"PNG",0,0,props.width,props.height);
  for(let i=1;i<out.length;i++){const im=out[i],pr=pdf.getImageProperties(im);pdf.addPage([pr.width,pr.height],pr.width>=pr.height?"landscape":"portrait");pdf.addImage(im,"PNG",0,0,pr.width,pr.height)}
  pdf.save(`${nb().name}-${sec().name}.pdf`)
}

function dialog(title,initial,cb){
  $("dialogTitle").textContent=title;$("nameInput").value=initial||"";
  $("nameForm").onsubmit=e=>{e.preventDefault();const v=$("nameInput").value.trim();if(v){cb(v);$("nameDialog").close()}};
  $("nameDialog").showModal();setTimeout(()=>$("nameInput").focus(),30)
}

$("newNotebook").onclick=()=>dialog("New Notebook","New Notebook",name=>{
  pushUndo();const p={id:uid(),title:"Untitled Page",background:"blank",strokes:[],texts:[],images:[]},s={id:uid(),name:"General",pages:[p]},n={id:uid(),name,sections:[s]};
  state.notebooks.push(n);notebookId=n.id;sectionId=s.id;pageId=p.id;render();save()
});
$("emptyNew").onclick=()=>$("newNotebook").click();
$("newPage").onclick=()=>{pushUndo();const p={id:uid(),title:"Untitled Page",background:"blank",strokes:[],texts:[],images:[]};sec().pages.push(p);pageId=p.id;render();save()};
$("deletePage").onclick=()=>deletePage(pageId);$("moveUp").onclick=()=>movePage(-1);$("moveDown").onclick=()=>movePage(1);
$("pageTitle").oninput=e=>{page().title=e.target.value;save()};
document.querySelectorAll(".bgBtn").forEach(b=>b.onclick=()=>{if(page()?.pdfFileId)return alert("PDF pages keep their original PDF background. Create a normal page for blank/ruled/grid/dot paper.");pushUndo();page().background=b.dataset.bg;render();save()});
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{tool=b.dataset.tool;document.querySelectorAll("[data-tool]").forEach(x=>x.classList.toggle("active",x===b))});
$("clearPage").onclick=()=>{if(confirm("Clear all ink on this page?")){pushUndo();page().strokes=[];renderInk();save()}};
$("undo").onclick=undo;$("redo").onclick=redo;$("focusMode").onclick=()=>{document.body.classList.toggle("focus");renderSurface()};$("sidebarToggle").onclick=()=>$("sidebar").classList.toggle("hidden");
$("importPdf").onclick=()=>$("pdfInput").click();
$("pdfInput").onchange=e=>{const f=e.target.files?.[0];if(f)importPdf(f).catch(err=>alert("PDF import failed: "+err.message));e.target.value=""};
$("pdfPrev").onclick=()=>{if(page()?.pdfFileId)activatePdfPage(page().pdfPageNumber-1)};
$("pdfNext").onclick=()=>{if(page()?.pdfFileId)activatePdfPage(page().pdfPageNumber+1)};
$("exportPdf").onclick=()=>exportSectionPdf().catch(err=>alert("PDF export failed: "+err.message));
$("addImage").onclick=()=>$("imageInput").click();
$("imageInput").onchange=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{pushUndo();page().images.push({id:uid(),src:r.result,x:60,y:100,w:260});renderOverlays();save()};r.readAsDataURL(f);e.target.value=""};

const canvas=$("noteCanvas"),surface=$("canvasWrap");
// Listen on the whole writing surface so Pencil input is accepted even when it is over the PDF canvas.
for(const ev of ["pointerdown","pointermove","pointerup","pointercancel"]){surface.addEventListener(ev,ev==="pointerdown"?pointerDown:ev==="pointermove"?pointerMove:pointerUp,{passive:false})}
for(const el of [surface,canvas])for(const ev of ["selectstart","dragstart","contextmenu"] )el.addEventListener(ev,e=>e.preventDefault());

$("backupBtn").onclick=async()=>{
  sync();const files={};
  for(const n of state.notebooks)for(const s of n.sections)for(const p of s.pages)if(p.pdfFileId&&!files[p.pdfFileId]){
    const b=await getFile(p.pdfFileId);files[p.pdfFileId]=Array.from(new Uint8Array(b))
  }
  const blob=new Blob([JSON.stringify({version:3,state,files})],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="DeepuNotes-backup.deepunotes";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
};
$("restoreBtn").onclick=()=>$("backupInput").click();
$("backupInput").onchange=async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{const pack=JSON.parse(await f.text());state=pack.state;for(const [id,arr] of Object.entries(pack.files||{}))await putFile(id,new Uint8Array(arr).buffer);normalise();render();await save();alert("Backup restored.")}catch(err){alert("Restore failed: "+err.message)}e.target.value=""
};
window.addEventListener("resize",()=>{if(page())renderSurface()});

(async()=>{try{await openDB();state=await getState();normalise();render()}catch(e){alert("DeepuNotes could not start: "+e.message)}})();

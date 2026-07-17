const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Solo se definen los nombres de los campos y las etiquetas que debe buscar el
// OCR. No hay coordenadas: cada caja se calcula a partir de la foto analizada.
const FIELD_SCHEMAS = {
  front: [
    { id:'surname1', label:'Primer apellido', anchors:[['PRIMER','APELLIDO']] },
    { id:'surname2', label:'Segundo apellido', anchors:[['SEGUNDO','APELLIDO']] },
    { id:'surname', label:'Apellidos', anchors:[['APELLIDOS'],['SURNAME']], maxLines:2 },
    { id:'name', label:'Nombre', anchors:[['NOMBRE'],['NAME']] },
    { id:'sex', label:'Sexo', anchors:[['SEXO'],['SEX']], narrow:true },
    { id:'nationality', label:'Nacionalidad', anchors:[['NACIONALIDAD'],['NATIONALITY']], narrow:true },
    { id:'birth', label:'Fecha de nacimiento', anchors:[['FECHA','NACIMIENTO'],['NACIMIENTO'],['DATE','BIRTH']] },
    { id:'support', label:'N.º de soporte', anchors:[['NUM','SOPORTE'],['N','SOPORTE'],['SOPORTE'],['IDESP']] },
    { id:'issue', label:'Fecha de expedición', anchors:[['EMISION'],['EXPEDICION'],['ISSUE']] },
    { id:'expiry', label:'Fecha de validez', anchors:[['VALIDO','HASTA'],['VALIDEZ'],['EXPIRY']], selected:false },
    { id:'dni', label:'Número de DNI', anchors:[['DNI','NUM'],['NUM','DNI'],['DNI']], placement:'right' },
    { id:'can', label:'Código CAN', anchors:[['CAN']], placement:'right', selected:false },
    { id:'signature', label:'Firma', anchors:[['FIRMA'],['SIGNATURE']], graphic:true }
  ],
  back: [
    { id:'birthPlace', label:'Lugar de nacimiento', anchors:[['LUGAR','NACIMIENTO'],['PLACE','BIRTH']], maxLines:2 },
    { id:'birthProvince', label:'Provincia/país de nacimiento', anchors:[['PROVINCIA','PAIS']], occurrence:0 },
    { id:'parents', label:'Progenitores', anchors:[['HIJO','DE'],['HIJA','DE'],['PROGENITORES'],['PARENTS']], maxLines:2 },
    { id:'address', label:'Domicilio', anchors:[['DOMICILIO'],['ADDRESS']], maxLines:3 },
    { id:'city', label:'Lugar de domicilio', anchors:[['LUGAR','DOMICILIO'],['PLACE','ADDRESS']] },
    { id:'province', label:'Provincia/país', anchors:[['PROVINCIA','PAIS']], occurrence:1 },
    { id:'team', label:'Equipo de expedición', anchors:[['EQUIPO'],['TEAM']] }
  ]
};

// Campos que permanecen visibles en la selección inicial. El resto de campos
// localizados se censura por defecto, independientemente de cómo los detecte el OCR.
const DEFAULT_VISIBLE_FIELDS = {
  front: new Set(['surname','surname1','surname2','name','birth','dni']),
  back: new Set(['mrz'])
};

function defaultFieldSelection(side,id){
  return !DEFAULT_VISIBLE_FIELDS[side].has(id);
}

const state = {
  step: 1, side: 'front', image: null, originalImage: null, fileName: 'dni', fields: [],
  redactionStyle: 'solid', zoom: 1, manualMode: false, adjustMode: false,
  watermark: { enabled: true, text: 'COPIA PARA TRÁMITE', layout: 'repeat', opacity: .24, size: 1, color: '#b42318' },
  format: 'jpeg', ocrText: '', ocrWords: [], ocrLayout: null, photoField: null,
  cropApplied: false, rotationApplied: false, focusedField: null, rendering: false,
  cameraStream: null, cameraFacing: 'environment', cameraFramed: false,
  documents: [], activeDocument: -1, pendingAppend: false, processingDocument: false
};

const DOCUMENT_STATE_KEYS=['side','image','originalImage','fileName','fields','ocrText','ocrWords','ocrLayout','photoField','cropApplied','rotationApplied','cameraFramed'];

function currentDocumentSnapshot(){
  return Object.fromEntries(DOCUMENT_STATE_KEYS.map(key=>[key,state[key]]));
}

function persistActiveDocument(){
  if(state.activeDocument<0||!state.image)return;
  state.documents[state.activeDocument]=currentDocumentSnapshot();
}

function restoreDocument(documentState){
  DOCUMENT_STATE_KEYS.forEach(key=>{state[key]=documentState[key];});
  state.focusedField=null;state.manualMode=false;state.adjustMode=false;
}

const uploadView = $('#upload-view');
const editorView = $('#editor-view');
const canvas = $('#preview-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const processing = $('#processing-overlay');

$('#choose-file').addEventListener('click', () => {state.pendingAppend=false;$('#file-input').click();});
$('#take-photo').addEventListener('click',()=>{state.pendingAppend=false;openCamera();});
$('#file-input').addEventListener('change', async e => {await handleFiles([...e.target.files]);e.target.value='';});
$('#camera-input').addEventListener('change', async e => {await handleFile(e.target.files[0],{append:state.pendingAppend});e.target.value='';});

const dropZone = $('#drop-zone');
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', e => handleFiles([...e.dataTransfer.files]));

async function handleFiles(files){
  const images=files.filter(file=>file.type.startsWith('image/'));
  for(let index=0;index<images.length;index++)await handleFile(images[index],{append:state.documents.length>0||index>0});
}

async function handleFile(file,{preCropped=false,append=state.pendingAppend}={}) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Elige una imagen JPG, PNG o WEBP.');
  if (file.size > 15 * 1024 * 1024) return toast('La imagen supera el límite de 15 MB.');
  if(state.processingDocument)return toast('Espera a que termine el análisis actual.');
  persistActiveDocument();
  const previousIndex=state.activeDocument,previousDocument=previousIndex>=0?state.documents[previousIndex]:null;
  if(!append){state.documents=[];state.activeDocument=0;}else state.activeDocument=state.documents.length;
  state.processingDocument=true;
  state.fileName = file.name.replace(/\.[^.]+$/, '') || 'dni';
  try {
    // Se limpia por completo el documento anterior antes de leer el nuevo archivo.
    // No existe ninguna imagen de ejemplo o sustitución dentro de la aplicación.
    state.image = null;
    state.originalImage = null;
    state.cropApplied = preCropped;
    state.cameraFramed = preCropped;
    state.rotationApplied = false;
    state.focusedField = null;
    state.fields = [];
    state.ocrText = '';
    state.ocrWords = [];
    state.ocrLayout = null;
    state.photoField = null;
    state.side = 'front';
    state.step = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const image = await loadImage(URL.createObjectURL(file));
    state.originalImage = image;
    state.image = image;
    uploadView.classList.add('hidden');
    editorView.classList.remove('hidden');
    fitCanvas(image);
    goToStep(1);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await analyseLocally(file);
    persistActiveDocument();
    renderDocumentTabs();
  } catch (error) {
    console.error(error);
    if(append){state.documents.splice(state.activeDocument,1);state.activeDocument=previousIndex;if(previousDocument){restoreDocument(previousDocument);fitCanvas(state.image);}}
    toast('No hemos podido leer esa imagen. Prueba con otra.');
  } finally {
    state.processingDocument=false;state.pendingAppend=false;renderDocumentTabs();
  }
}

const cameraDialog=$('#camera-dialog'),cameraVideo=$('#camera-video'),cameraViewport=$('#camera-viewport'),documentFrame=$('#document-frame');

async function openCamera(){
  if(!navigator.mediaDevices?.getUserMedia){$('#camera-input').click();return;}
  if(!cameraDialog.open)cameraDialog.showModal();
  await startCamera();
}

function stopCamera(){
  state.cameraStream?.getTracks().forEach(track=>track.stop());
  state.cameraStream=null;cameraVideo.srcObject=null;$('#capture-camera').disabled=true;
}

async function startCamera(){
  stopCamera();
  $('#camera-error').classList.add('hidden');$('#camera-loading').classList.remove('hidden');$('#capture-camera').disabled=true;
  try{
    const constraints={audio:false,video:{facingMode:{ideal:state.cameraFacing},width:{ideal:1920},height:{ideal:1080}}};
    try{state.cameraStream=await navigator.mediaDevices.getUserMedia(constraints);}catch(error){if(error.name==='OverconstrainedError')state.cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:true});else throw error;}
    cameraVideo.srcObject=state.cameraStream;
    await new Promise((resolve,reject)=>{if(cameraVideo.readyState>=1)return resolve();const timer=setTimeout(()=>reject(new Error('La cámara no respondió')),10000);cameraVideo.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});});
    await cameraVideo.play();
    $('#camera-loading').classList.add('hidden');$('#capture-camera').disabled=false;
    try{const devices=await navigator.mediaDevices.enumerateDevices();$('#switch-camera').classList.toggle('hidden',devices.filter(device=>device.kind==='videoinput').length<2);}catch{$('#switch-camera').classList.remove('hidden');}
  }catch(error){
    console.warn('Cámara no disponible',error);stopCamera();$('#camera-loading').classList.add('hidden');$('#camera-error').classList.remove('hidden');
  }
}

function framedVideoCrop(){
  const vw=cameraVideo.videoWidth,vh=cameraVideo.videoHeight,viewport=cameraViewport.getBoundingClientRect(),frame=documentFrame.getBoundingClientRect();
  if(!vw||!vh||!viewport.width||!viewport.height)return null;
  const coverScale=Math.max(viewport.width/vw,viewport.height/vh),renderedWidth=vw*coverScale,renderedHeight=vh*coverScale,offsetX=(viewport.width-renderedWidth)/2,offsetY=(viewport.height-renderedHeight)/2;
  let x=(frame.left-viewport.left-offsetX)/coverScale,y=(frame.top-viewport.top-offsetY)/coverScale,w=frame.width/coverScale,h=frame.height/coverScale;
  x=Math.max(0,Math.min(vw-1,x));y=Math.max(0,Math.min(vh-1,y));w=Math.max(1,Math.min(vw-x,w));h=Math.max(1,Math.min(vh-y,h));
  return {x,y,w,h};
}

async function captureFramedDocument(){
  const crop=framedVideoCrop();if(!crop)return toast('Espera a que la cámara esté preparada.');
  const append=state.pendingAppend;
  $('#capture-camera').disabled=true;
  const captured=document.createElement('canvas');captured.width=Math.round(crop.w);captured.height=Math.round(crop.h);
  captured.getContext('2d').drawImage(cameraVideo,crop.x,crop.y,crop.w,crop.h,0,0,captured.width,captured.height);
  const blob=await new Promise(resolve=>captured.toBlob(resolve,'image/jpeg',.95));
  if(!blob){$('#capture-camera').disabled=false;return toast('No se ha podido capturar la imagen.');}
  stopCamera();cameraDialog.close();
  await handleFile(new File([blob],`dni-camara-${Date.now()}.jpg`,{type:'image/jpeg'}),{preCropped:true,append});
}

$('#capture-camera').addEventListener('click',captureFramedDocument);
$('#switch-camera').addEventListener('click',async()=>{state.cameraFacing=state.cameraFacing==='environment'?'user':'environment';await startCamera();});
function closeCamera(){stopCamera();state.pendingAppend=false;if(cameraDialog.open)cameraDialog.close();}
$('#close-camera').addEventListener('click',closeCamera);$('#cancel-camera').addEventListener('click',closeCamera);
$('#camera-fallback').addEventListener('click',()=>{const append=state.pendingAppend;closeCamera();state.pendingAppend=append;$('#camera-input').click();});
cameraDialog.addEventListener('cancel',event=>{event.preventDefault();closeCamera();});
cameraDialog.addEventListener('close',stopCamera);
window.addEventListener('pagehide',stopCamera);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(src); resolve(image); };
    image.onerror = reject;
    image.src = src;
  });
}

function fitCanvas(image) {
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
}

function renderDocumentTabs(){
  const tabs=$('#document-tabs');if(!tabs)return;
  tabs.innerHTML=state.documents.map((documentState,index)=>`<button type="button" class="document-tab${index===state.activeDocument?' active':''}" data-document="${index}"><span></span>${index+1} · ${documentState.side==='back'?'Reverso':'Anverso'}</button>`).join('');
  $$('[data-document]',tabs).forEach(button=>button.addEventListener('click',()=>selectDocument(+button.dataset.document)));
}

function selectDocument(index){
  if(index===state.activeDocument||!state.documents[index]||state.processingDocument)return;
  persistActiveDocument();state.activeDocument=index;restoreDocument(state.documents[index]);
  if(state.step===4)state.step=1;
  fitCanvas(state.image);updateSideUI();updateOcrStatus();renderFieldList();renderDocumentTabs();goToStep(state.step);
}

$('#add-document-file').addEventListener('click',()=>{if(state.processingDocument)return;state.pendingAppend=true;$('#file-input').click();});
$('#add-document-camera').addEventListener('click',()=>{if(state.processingDocument)return;state.pendingAppend=true;openCamera();});
$('#result-add-file').addEventListener('click',()=>{if(state.processingDocument)return;state.pendingAppend=true;$('#file-input').click();});
$('#result-add-camera').addEventListener('click',()=>{if(state.processingDocument)return;state.pendingAppend=true;openCamera();});

async function canvasToImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source.toDataURL('image/jpeg', .96);
  });
}

async function rotateImage(image,degrees){
  const normalized=((degrees%360)+360)%360;if(!normalized)return image;
  const output=document.createElement('canvas'),swap=normalized===90||normalized===270;
  output.width=swap?image.naturalHeight:image.naturalWidth;output.height=swap?image.naturalWidth:image.naturalHeight;
  const outputCtx=output.getContext('2d');outputCtx.translate(output.width/2,output.height/2);outputCtx.rotate(normalized*Math.PI/180);outputCtx.drawImage(image,-image.naturalWidth/2,-image.naturalHeight/2);
  return canvasToImage(output);
}

function orientationScore(text=''){
  const value=normalizeText(text),keywords=['DNI','APELLIDOS','NOMBRE','SEXO','NACIONALIDAD','NACIMIENTO','EMISION','VALIDEZ','SOPORTE','DOMICILIO','EQUIPO','IDESP'];
  return keywords.reduce((score,keyword)=>score+(value.includes(keyword)?2:0),0)+(/\d{7,9}[A-Z0-9]/.test(value)?3:0)+((value.match(/\bESP\b/g)||[]).length?2:0);
}

function orientationQuality(result){
  const words=(result.data.words||[]).filter(word=>normalizeText(word.text)),average=words.length?words.reduce((sum,word)=>sum+(word.confidence||0),0)/words.length:0;
  return orientationScore(result.data.text)*18+average+Math.min(36,words.filter(word=>(word.confidence||0)>45).length*2);
}

function ocrCoverage(words,text=''){
  const layout=makeOcrLayout(words),ids=new Set();
  [...FIELD_SCHEMAS.front,...FIELD_SCHEMAS.back].forEach(schema=>{if(findAnchors(schema,layout).length)ids.add(schema.id);});
  const normalized=normalizeText(text).replace(/ /g,'');
  if(/\d{7,9}[A-Z0-9]/.test(normalized))ids.add('dni');
  if(/[A-Z]{2,4}\d{5,9}/.test(normalized))ids.add('support');
  if(/\d{6}/.test(normalized))ids.add('numeric');
  return ids.size;
}

async function correctOrientationWithOcr(worker,image,initialResult,initialPrepared){
  let best={image,result:initialResult,prepared:initialPrepared,degrees:0,semantic:orientationScore(initialResult.data.text),quality:orientationQuality(initialResult)};
  if(best.semantic>=7)return best;
  for(const degrees of [180,90,270]){
    const candidateImage=await rotateImage(image,degrees),candidatePrepared=prepareOcrImage(candidateImage,undefined,'normal',1300),candidateResult=await worker.recognize(candidatePrepared.canvas),semantic=orientationScore(candidateResult.data.text),quality=orientationQuality(candidateResult)+(candidateImage.naturalWidth>candidateImage.naturalHeight?6:0);
    if(semantic>best.semantic||quality>best.quality+9)best={image:candidateImage,result:candidateResult,prepared:candidatePrepared,degrees,semantic,quality};
    if(best.semantic>=7)break;
  }
  return best;
}

async function cropDocumentByColor(image){
  const sample=document.createElement('canvas'),scale=Math.min(1,520/Math.max(image.naturalWidth,image.naturalHeight));
  sample.width=Math.round(image.naturalWidth*scale);sample.height=Math.round(image.naturalHeight*scale);
  const sampleCtx=sample.getContext('2d',{willReadFrequently:true});sampleCtx.drawImage(image,0,0,sample.width,sample.height);
  const data=sampleCtx.getImageData(0,0,sample.width,sample.height).data,w=sample.width,h=sample.height,border=[];
  const margin=Math.max(3,Math.round(Math.min(w,h)*.055));
  for(let y=0;y<h;y+=3)for(let x=0;x<w;x+=3)if(x<margin||x>w-margin||y<margin||y>h-margin)border.push([data[(y*w+x)*4],data[(y*w+x)*4+1],data[(y*w+x)*4+2]]);
  const bg=[median(border.map(p=>p[0])),median(border.map(p=>p[1])),median(border.map(p=>p[2]))];
  const borderDistances=border.map(p=>Math.hypot(p[0]-bg[0],p[1]-bg[1],p[2]-bg[2])).sort((a,b)=>a-b),threshold=Math.max(26,borderDistances[Math.floor(borderDistances.length*.7)]+10);
  const mask=new Uint8Array(w*h);
  for(let i=0,p=0;i<data.length;i+=4,p++)if(Math.hypot(data[i]-bg[0],data[i+1]-bg[1],data[i+2]-bg[2])>threshold)mask[p]=1;
  let connected=mask;
  for(let pass=0;pass<2;pass++){const grown=new Uint8Array(w*h);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const at=y*w+x;if(connected[at])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)grown[at+dy*w+dx]=1;}connected=grown;}
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let best=null;
  for(let start=0;start<connected.length;start++){
    if(!connected[start]||seen[start])continue;
    let head=0,tail=0,count=0,minX=w,maxX=0,minY=h,maxY=0;queue[tail++]=start;seen[start]=1;
    while(head<tail){const at=queue[head++],x=at%w,y=(at/w)|0;count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const next of [at-1,at+1,at-w,at+w])if(next>=0&&next<connected.length&&!seen[next]&&connected[next]&&Math.abs(next%w-x)<=1){seen[next]=1;queue[tail++]=next;}
    }
    if(count<w*h*.025)continue;
    const bw=maxX-minX+1,bh=maxY-minY+1,ratio=bw/bh,fill=count/(bw*bh),coverage=bw*bh/(w*h);
    if(ratio<1.3||ratio>1.9||fill<.28||coverage>.88)continue;
    const ratioQuality=1-Math.min(1,Math.abs(ratio-1.586)/.3),score=ratioQuality*.45+fill*.3+Math.min(.25,coverage);
    if(!best||score>best.score)best={x:minX,y:minY,w:bw,h:bh,score};
  }
  if(!best||best.score<.34)return null;
  const pad=Math.max(2,best.w*.025),bounds={x:Math.max(0,(best.x-pad)/scale),y:Math.max(0,(best.y-pad)/scale),w:Math.min(image.naturalWidth-(best.x-pad)/scale,(best.w+pad*2)/scale),h:Math.min(image.naturalHeight-(best.y-pad)/scale,(best.h+pad*2)/scale)};
  const output=document.createElement('canvas'),outScale=Math.min(1,2200/Math.max(bounds.w,bounds.h));output.width=Math.round(bounds.w*outScale);output.height=Math.round(bounds.h*outScale);
  output.getContext('2d').drawImage(image,bounds.x,bounds.y,bounds.w,bounds.h,0,0,output.width,output.height);
  return {image:await canvasToImage(output),bounds,scale:outScale,rotated:false};
}

async function analyseLocally(file) {
  processing.classList.remove('hidden');
  $('#ocr-progress').style.width = '8%';
  $('#processing-text').textContent = 'Detectando y recortando el DNI…';
  let detectedSide = 'front';
  try {
    $('#processing-text').textContent = 'Cargando el lector de texto local…';
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    if (!window.Tesseract?.createWorker) throw new Error('El motor OCR no está disponible');
    const worker = await window.Tesseract.createWorker('spa', 1, {
      logger: message => {
        if (message.status === 'recognizing text') {
          const percent = Math.round((message.progress || 0) * 100);
          $('#ocr-progress').style.width = `${Math.max(15, percent)}%`;
          $('#processing-text').textContent = `Reconociendo campos… ${percent}%`;
        }
      }
    });
    await worker.setParameters({ tessedit_pageseg_mode:'11', preserve_interword_spaces:'1' });
    const prepared = prepareOcrImage(state.image,undefined,'normal',1400);
    let result = await worker.recognize(prepared.canvas);
    const orientation=await correctOrientationWithOcr(worker,state.image,result,prepared);
    if(orientation.degrees){state.image=orientation.image;state.rotationApplied=true;fitCanvas(state.image);render();}
    result=orientation.result;
    let mappedWords=mapOcrWords(result.data.words||[],orientation.prepared);
    let combinedText=result.data.text||'';
    $('#processing-text').textContent = 'Recortando el documento detectado…';
    const crop=state.cropApplied?null:await cropDocumentFromOcr(state.image,mappedWords);
    if(crop){
      mappedWords=mappedWords.filter(word=>word.bbox.x1>crop.bounds.x&&word.bbox.x0<crop.bounds.x+crop.bounds.w&&word.bbox.y1>crop.bounds.y&&word.bbox.y0<crop.bounds.y+crop.bounds.h).map(word=>({...word,bbox:{x0:(word.bbox.x0-crop.bounds.x)*crop.scale,y0:(word.bbox.y0-crop.bounds.y)*crop.scale,x1:(word.bbox.x1-crop.bounds.x)*crop.scale,y1:(word.bbox.y1-crop.bounds.y)*crop.scale}}));
      state.image=crop.image;state.cropApplied=true;fitCanvas(crop.image);render();
    }
    // Segunda lectura con segmentación de bloque: recupera etiquetas pequeñas
    // que la lectura dispersa suele omitir en fotos con hologramas o reflejos.
    $('#processing-text').textContent = 'Comprobando todos los campos…';
    await worker.setParameters({ tessedit_pageseg_mode:'6', preserve_interword_spaces:'1' });
    const verification=prepareOcrImage(state.image,undefined,'strong');
    const verificationResult=await worker.recognize(verification.canvas);
    mappedWords=mergeOcrWords(mappedWords,mapOcrWords(verificationResult.data.words||[],verification));
    combinedText+=`\n${verificationResult.data.text||''}`;
    let provisionalLayout=makeOcrLayout(mappedWords),provisionalText=normalizeText(combinedText);
    let backLikely=provisionalText.includes('DOMICILIO')||provisionalText.includes('HIJO DE')||findMrzLines(provisionalLayout).length>=2;
    if(ocrCoverage(mappedWords,combinedText)<8&&!backLikely){
      $('#processing-text').textContent = 'Leyendo etiquetas sobre la trama de seguridad…';
      await worker.setParameters({ tessedit_pageseg_mode:'11', preserve_interword_spaces:'1' });
      const adaptive=prepareOcrImage(state.image,undefined,'adaptive',1800);
      const adaptiveResult=await worker.recognize(adaptive.canvas);
      mappedWords=mergeOcrWords(mappedWords,mapOcrWords(adaptiveResult.data.words||[],adaptive));
      combinedText+=`\n${adaptiveResult.data.text||''}`;
      provisionalLayout=makeOcrLayout(mappedWords);provisionalText=normalizeText(combinedText);
      backLikely=provisionalText.includes('DOMICILIO')||provisionalText.includes('HIJO DE')||findMrzLines(provisionalLayout).length>=2;
    }
    if(backLikely){
      // En los DNI recientes el reverso concentra texto pequeño en la mitad
      // superior y el número de equipo está impreso en vertical.
      $('#processing-text').textContent = 'Comprobando el reverso y el código MRZ…';
      await worker.setParameters({ tessedit_pageseg_mode:'6', preserve_interword_spaces:'1' });
      const backTop=prepareOcrImage(state.image,{x:0,y:0,w:state.image.naturalWidth,h:state.image.naturalHeight*.68},'strong',1900);
      const backTopResult=await worker.recognize(backTop.canvas);
      mappedWords=mergeOcrWords(mappedWords,mapOcrWords(backTopResult.data.words||[],backTop));combinedText+=`\n${backTopResult.data.text||''}`;
      const vertical=prepareRotatedOcrImage(state.image,{x:0,y:0,w:state.image.naturalWidth*.32,h:state.image.naturalHeight*.78},1200);
      const verticalResult=await worker.recognize(vertical.canvas);
      const verticalWords=mapOcrWords(verticalResult.data.words||[],vertical).filter(word=>{const value=normalizeText(word.text).replace(/ /g,'');return value.includes('EQUIPO')||(value.length>=8&&value.length<=13&&/[A-Z]/.test(value)&&/\d/.test(value));});
      mappedWords=mergeOcrWords(mappedWords,verticalWords);combinedText+=`\n${verticalResult.data.text||''}`;
    }
    const firstLayout=makeOcrLayout(mappedWords);
    const firstMrzWords=mappedWords.filter(word=>isMrzText(normalizeText(word.text)));
    // Si una sola foto contiene las dos caras, la MRZ identifica el comienzo
    // del reverso. Se vuelve a analizar el área restante con mayor resolución.
    if(state.image.naturalWidth/state.image.naturalHeight>2.2&&firstMrzWords.length){
      const mrzStart=Math.min(...firstMrzWords.map(word=>word.bbox.x0));
      if(mrzStart>state.image.naturalWidth*.35){
        const frontCrop={x:0,y:0,w:Math.max(1,mrzStart-firstLayout.medianHeight),h:state.image.naturalHeight};
        const frontPrepared=prepareOcrImage(state.image,frontCrop);
        const frontResult=await worker.recognize(frontPrepared.canvas);
        mappedWords=mergeOcrWords(mappedWords,mapOcrWords(frontResult.data.words||[],frontPrepared));
        combinedText+=`\n${frontResult.data.text||''}`;
      }
    }
    await worker.terminate();
    state.ocrText=combinedText;
    state.ocrWords=mappedWords;
    state.ocrLayout = makeOcrLayout(state.ocrWords);
    if(location.hostname==='127.0.0.1')document.documentElement.dataset.ocrDebug=JSON.stringify(state.ocrLayout.lines.map(line=>({text:line.text,normalized:line.normalized,bbox:line.bbox})));
    state.photoField = await detectPortraitField();
    detectedSide = detectSide(state.ocrText, state.ocrLayout) || detectedSide;
    setSide(detectedSide, false);
    updateOcrStatus();
  } catch (error) {
    console.warn('OCR no disponible', error);
    state.ocrLayout=makeOcrLayout([]);
    state.ocrText='';
    state.fields=buildFieldsFromOcr(state.side);
    $('#ocr-status').textContent = 'No se han podido localizar campos';
    toast('No se han detectado campos. Puedes añadir las zonas manualmente.');
  } finally {
    processing.classList.add('hidden');
    $('#side-icon').innerHTML = '<svg viewBox="0 0 20 20"><path d="m5.5 10 3 3 6-6"/></svg>';
    updateSideUI();
    renderFieldList();
    render();
  }
}

function prepareOcrImage(image,crop={x:0,y:0,w:image.naturalWidth,h:image.naturalHeight},variant='normal',targetWidth=2200) {
  const scale=Math.max(.25,Math.min(6,targetWidth/crop.w));
  const prepared=document.createElement('canvas');
  prepared.width=Math.round(crop.w*scale);prepared.height=Math.round(crop.h*scale);
  const preparedCtx=prepared.getContext('2d');
  preparedCtx.imageSmoothingEnabled=true;preparedCtx.imageSmoothingQuality='high';
  preparedCtx.filter=variant==='strong'?'grayscale(1) contrast(1.28) brightness(1.04)':'none';
  preparedCtx.drawImage(image,crop.x,crop.y,crop.w,crop.h,0,0,prepared.width,prepared.height);
  if(variant==='adaptive'){
    const frame=preparedCtx.getImageData(0,0,prepared.width,prepared.height),pixels=frame.data,w=prepared.width,h=prepared.height,integral=new Float64Array((w+1)*(h+1));
    for(let y=1;y<=h;y++){let row=0;for(let x=1;x<=w;x++){const i=((y-1)*w+x-1)*4,rowValue=pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114;row+=rowValue;integral[y*(w+1)+x]=integral[(y-1)*(w+1)+x]+row;}}
    const radius=Math.max(10,Math.round(w/110));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const x0=Math.max(0,x-radius),x1=Math.min(w-1,x+radius),y0=Math.max(0,y-radius),y1=Math.min(h-1,y+radius),area=(x1-x0+1)*(y1-y0+1),mean=(integral[(y1+1)*(w+1)+x1+1]-integral[y0*(w+1)+x1+1]-integral[(y1+1)*(w+1)+x0]+integral[y0*(w+1)+x0])/area,i=(y*w+x)*4,luma=pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114,value=luma<mean-9?0:255;pixels[i]=pixels[i+1]=pixels[i+2]=value;}
    preparedCtx.putImageData(frame,0,0);
  }
  return {canvas:prepared,scale,crop};
}

function prepareRotatedOcrImage(image,crop,targetWidth=1200){
  const base=prepareOcrImage(image,crop,'strong',targetWidth),rotated=document.createElement('canvas');
  rotated.width=base.canvas.height;rotated.height=base.canvas.width;
  const rotatedCtx=rotated.getContext('2d');rotatedCtx.translate(rotated.width,0);rotatedCtx.rotate(Math.PI/2);rotatedCtx.drawImage(base.canvas,0,0);
  return {canvas:rotated,scale:base.scale,crop,rotation:90,sourcePreparedHeight:base.canvas.height};
}

function topPeaks(scores,min,max,count=24){
  const peaks=[];
  for(let i=Math.max(2,Math.floor(min));i<Math.min(scores.length-2,Math.ceil(max));i++){
    if(scores[i]>=scores[i-1]&&scores[i]>=scores[i+1])peaks.push({at:i,score:scores[i]});
  }
  return peaks.sort((a,b)=>b.score-a.score).slice(0,count);
}

function expandBoundsToRatio(bounds,sourceWidth,sourceHeight,targetRatio=1.586){
  let {x,y,w,h}=bounds;
  if(w/h<targetRatio){const target=Math.min(sourceWidth,h*targetRatio),extra=target-w;x-=extra/2;w=target;}
  else{const target=Math.min(sourceHeight,w/targetRatio),extra=target-h;y-=extra/2;h=target;}
  x=Math.max(0,Math.min(sourceWidth-w,x));y=Math.max(0,Math.min(sourceHeight-h,y));
  return {x,y,w,h};
}

async function cropDocumentFromOcr(image,words){
  const useful=words.filter(word=>word.bbox&&(word.confidence||0)>22&&normalizeText(word.text));
  const sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight;let validationWords=useful.filter(word=>(word.confidence||0)>60),semanticEvidence=false;
  if(useful.length>=4){const layout=makeOcrLayout(useful),anchorWords=[];[...FIELD_SCHEMAS.front,...FIELD_SCHEMAS.back].forEach(schema=>findAnchors(schema,layout).forEach(anchor=>anchorWords.push(...anchor.words)));const structured=useful.filter(word=>{const value=normalizeText(word.text).replace(/ /g,'');return /^\d{7,9}[A-Z]$/.test(value)||/^[A-Z]{2,4}\d{5,9}$/.test(value)||/^20\d{2}$/.test(value)||value==='ESP';}),evidence=[...new Set([...anchorWords,...structured])];if(evidence.length>=2){validationWords=evidence;semanticEvidence=true;}}
  const scan=document.createElement('canvas'),scale=Math.min(1,900/Math.max(sourceWidth,sourceHeight));
  scan.width=Math.round(sourceWidth*scale);scan.height=Math.round(sourceHeight*scale);
  const scanCtx=scan.getContext('2d',{willReadFrequently:true});scanCtx.drawImage(image,0,0,scan.width,scan.height);
  const pixels=scanCtx.getImageData(0,0,scan.width,scan.height).data,gray=new Uint8Array(scan.width*scan.height);
  for(let i=0,p=0;i<pixels.length;i+=4,p++)gray[p]=(pixels[i]*77+pixels[i+1]*150+pixels[i+2]*29)>>8;
  const vertical=new Float32Array(scan.width),horizontal=new Float32Array(scan.height);
  const vy0=2,vy1=scan.height-2,hx0=2,hx1=scan.width-2;
  for(let x=2;x<scan.width-2;x++){let sum=0;for(let y=vy0;y<vy1;y+=2)sum+=Math.abs(gray[y*scan.width+x+1]-gray[y*scan.width+x-1]);vertical[x]=sum/Math.max(1,(vy1-vy0)/2);}
  for(let y=2;y<scan.height-2;y++){let sum=0;for(let x=hx0;x<hx1;x+=2)sum+=Math.abs(gray[(y+1)*scan.width+x]-gray[(y-1)*scan.width+x]);horizontal[y]=sum/Math.max(1,(hx1-hx0)/2);}
  const xPeaks=topPeaks(vertical,1,scan.width-1,42),yPeaks=topPeaks(horizontal,1,scan.height-1,42);
  const xPairs=[];for(const l of xPeaks)for(const r of xPeaks)if(r.at-l.at>scan.width*.22)xPairs.push({a:l.at,b:r.at,size:r.at-l.at,score:l.score+r.score});
  const yPairs=[];for(const t of yPeaks)for(const b of yPeaks)if(b.at-t.at>scan.height*.14)yPairs.push({a:t.at,b:b.at,size:b.at-t.at,score:t.score+b.score});
  xPairs.sort((a,b)=>b.score-a.score);yPairs.sort((a,b)=>b.score-a.score);
  const maxV=Math.max(1,...vertical),maxH=Math.max(1,...horizontal),reliable=validationWords;let best=null;
  for(const xp of xPairs.slice(0,80))for(const yp of yPairs.slice(0,80)){
    const ratio=xp.size/yp.size,area=xp.size*yp.size/(scan.width*scan.height);
    if(ratio<1.34||ratio>1.86||area>.94||area<.055)continue;
    const inside=reliable.length?reliable.filter(word=>{const cx=(word.bbox.x0+word.bbox.x1)*scale/2,cy=(word.bbox.y0+word.bbox.y1)*scale/2;return cx>=xp.a&&cx<=xp.b&&cy>=yp.a&&cy<=yp.b;}).length/reliable.length:.5;
    const ratioQuality=1-Math.min(1,Math.abs(ratio-1.586)/.3),edgeQuality=xp.score/(2*maxV)+yp.score/(2*maxH),sizeQuality=Math.sqrt(area);
    const score=edgeQuality*34+ratioQuality*32+sizeQuality*22+inside*22;
    if(!best||score>best.score)best={x:xp.a,y:yp.a,w:xp.size,h:yp.size,score,inside};
  }
  if(!best)return null;
  // Solo se descarta un contorno por dejar texto fuera cuando ese texto es
  // evidencia propia del DNI. Así, letras del fondo no bloquean un recorte válido.
  if(semanticEvidence&&reliable.length>=4&&best.inside<.72)return null;
  const pad=Math.max(3,best.w*.04);let bounds={x:Math.max(0,(best.x-pad)/scale),y:Math.max(0,(best.y-pad)/scale),w:Math.min(sourceWidth-(best.x-pad)/scale,(best.w+pad*2)/scale),h:Math.min(sourceHeight-(best.y-pad)/scale,(best.h+pad*2)/scale)};
  if(semanticEvidence){const evidenceBox=unionBox(validationWords),margin=Math.max(sourceWidth,sourceHeight)*.018,x0=Math.max(0,Math.min(bounds.x,evidenceBox.x0-margin)),y0=Math.max(0,Math.min(bounds.y,evidenceBox.y0-margin)),x1=Math.min(sourceWidth,Math.max(bounds.x+bounds.w,evidenceBox.x1+margin)),y1=Math.min(sourceHeight,Math.max(bounds.y+bounds.h,evidenceBox.y1+margin));bounds={x:x0,y:y0,w:x1-x0,h:y1-y0};}
  bounds=expandBoundsToRatio(bounds,sourceWidth,sourceHeight);
  const sourceRatio=sourceWidth/sourceHeight;
  if(sourceRatio>1.47&&sourceRatio<1.71&&(bounds.w<sourceWidth*.88||bounds.h<sourceHeight*.88))return null;
  if(bounds.w>sourceWidth*.96&&bounds.h>sourceHeight*.96)return null;
  const result=document.createElement('canvas'),max=2200,outScale=Math.min(1,max/Math.max(bounds.w,bounds.h));
  result.width=Math.round(bounds.w*outScale);result.height=Math.round(bounds.h*outScale);
  result.getContext('2d').drawImage(image,bounds.x,bounds.y,bounds.w,bounds.h,0,0,result.width,result.height);
  return {image:await canvasToImage(result),bounds,scale:outScale};
}

function mapOcrWords(words,prepared) {
  return words.map(word=>{
    if(prepared.rotation===90){
      const height=prepared.sourcePreparedHeight,scale=prepared.scale;
      return {...word,bbox:{x0:prepared.crop.x+word.bbox.y0/scale,y0:prepared.crop.y+(height-word.bbox.x1)/scale,x1:prepared.crop.x+word.bbox.y1/scale,y1:prepared.crop.y+(height-word.bbox.x0)/scale}};
    }
    return {...word,bbox:{x0:prepared.crop.x+word.bbox.x0/prepared.scale,y0:prepared.crop.y+word.bbox.y0/prepared.scale,x1:prepared.crop.x+word.bbox.x1/prepared.scale,y1:prepared.crop.y+word.bbox.y1/prepared.scale}};
  });
}

function mergeOcrWords(base,extra) {
  const merged=[...base];
  extra.forEach(word=>{
    const cx=(word.bbox.x0+word.bbox.x1)/2,cy=(word.bbox.y0+word.bbox.y1)/2,h=word.bbox.y1-word.bbox.y0;
    const value=normalizeText(word.text),duplicate=merged.findIndex(item=>{const other=normalizeText(item.text),distance=Math.hypot((item.bbox.x0+item.bbox.x1)/2-cx,(item.bbox.y0+item.bbox.y1)/2-cy),near=distance<Math.max(3,h*1.15);return near&&(other===value||(other.length>=5&&value.length>=5&&editDistance(other,value)<=2));});
    if(duplicate<0)merged.push(word);else if((word.confidence||0)>(merged[duplicate].confidence||0))merged[duplicate]=word;
  });
  return merged;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const loaded = document.querySelector(`script[src="${src}"]`);
    if (loaded) return loaded.dataset.ready==='true' ? resolve() : loaded.addEventListener('load', resolve, { once: true });
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => { script.dataset.ready='true'; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
function detectSide(text, layout) {
  const value=normalizeText(text);
  const mrz=findMrzLines(layout).length>=2;
  if(mrz&&state.image.naturalWidth/state.image.naturalHeight>2.2)return 'front';
  const backScore=['DOMICILIO','LUGAR DOMICILIO','EQUIPO','HIJO DE'].filter(x=>value.includes(x)).length+(mrz?3:0);
  const frontScore=['APELLIDOS','NOMBRE','NACIONALIDAD','NACIMIENTO','VALIDEZ'].filter(x=>value.includes(x)).length;
  return backScore > frontScore ? 'back' : frontScore ? 'front' : null;
}

function setSide(side, rerender = true) {
  state.side = side;
  state.fields = buildFieldsFromOcr(side);
  if(state.ocrLayout)updateOcrStatus();
  persistActiveDocument();renderDocumentTabs();
  updateSideUI();
  renderFieldList();
  if (rerender) render();
}

function updateOcrStatus(){
  const detected=state.fields.filter(field=>field.box).length,total=state.fields.filter(field=>!field.manual).length;
  $('#ocr-status').textContent=`${detected} de ${total} campos localizados${state.cropApplied?' · DNI recortado':''}${state.rotationApplied?' · orientación corregida':''}`;
}

function normalizeText(value='') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9<]+/g,' ').trim();
}

function median(values) {
  if(!values.length)return 12;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];
}

function unionBox(items) {
  return {x0:Math.min(...items.map(item=>item.bbox.x0)),y0:Math.min(...items.map(item=>item.bbox.y0)),x1:Math.max(...items.map(item=>item.bbox.x1)),y1:Math.max(...items.map(item=>item.bbox.y1))};
}

function makeOcrLayout(words) {
  const usable=words.filter(word=>word.bbox&&normalizeText(word.text));
  const medianHeight=median(usable.map(word=>word.bbox.y1-word.bbox.y0));
  const lines=[];
  [...usable].sort((a,b)=>(a.bbox.y0+a.bbox.y1)-(b.bbox.y0+b.bbox.y1)||a.bbox.x0-b.bbox.x0).forEach(word=>{
    const cy=(word.bbox.y0+word.bbox.y1)/2;
    let line=lines.find(candidate=>Math.abs(candidate.cy-cy)<=medianHeight*.72);
    if(!line){line={words:[],cy};lines.push(line);}
    line.words.push(word);line.cy=(line.cy*(line.words.length-1)+cy)/line.words.length;
  });
  lines.forEach(line=>{
    line.words.sort((a,b)=>a.bbox.x0-b.bbox.x0);line.bbox=unionBox(line.words);
    line.text=line.words.map(word=>word.text).join(' ');line.normalized=normalizeText(line.text);
  });
  lines.sort((a,b)=>a.bbox.y0-b.bbox.y0);
  return {lines,medianHeight};
}

function editDistance(a,b) {
  if(Math.abs(a.length-b.length)>2)return 9;let previous=[...Array(b.length+1).keys()];
  for(let i=1;i<=a.length;i++){const current=[i];for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=current;}return previous[b.length];
}

function tokenMatches(value,target) {
  if(value.includes('<'))return false;
  return value===target||(value.length<=target.length+3&&value.includes(target))||(target.length>=8&&editDistance(value,target)<=2)||(target.length>=5&&editDistance(value,target)<=1);
}

function patternMatch(line, pattern) {
  const entries=line.words.flatMap(word=>normalizeText(word.text).split(' ').filter(Boolean).map(value=>({value,word})));
  const tokens=entries.map(entry=>entry.value);
  for(let start=0;start<tokens.length;start++){
    let cursor=start;const matched=[];
    for(const target of pattern){
      let found=-1;for(let i=cursor;i<Math.min(tokens.length,cursor+3);i++){if(tokenMatches(tokens[i],target)){found=i;break;}}
      if(found<0){matched.length=0;break;}matched.push(entries[found].word);cursor=found+1;
    }
    if(matched.length===pattern.length)return matched;
  }
  return null;
}

function findRepeatedSurname(layout) {
  const excluded=new Set(['APELLIDO','APELLIDOS','PRIMER','SEGUNDO','NOMBRE','NACIONALIDAD','NACIMIENTO','DOCUMENTO','IDENTIDAD','ESPANA','FECHA','VALIDO','HASTA','SEXO','IDESP']);
  const words=layout.lines.flatMap(line=>line.words).filter(word=>{const value=normalizeText(word.text).replace(/ /g,'');return /^[A-Z]{4,}$/.test(value)&&!excluded.has(value)&&!isMrzText(value)&&(word.confidence||0)>45;});
  const m=layout.medianHeight,candidates=[];
  for(let i=0;i<words.length;i++)for(let j=i+1;j<words.length;j++){
    const a=normalizeText(words[i].text).replace(/ /g,''),b=normalizeText(words[j].text).replace(/ /g,''),dy=Math.abs(words[i].bbox.y0-words[j].bbox.y0),dx=Math.abs(words[i].bbox.x0-words[j].bbox.x0);
    if((a===b||editDistance(a,b)<=1)&&dy>m*.5&&dy<m*14&&dx<m*5)candidates.push({words:[words[i],words[j]],value:`${a} ${b}`,score:(words[i].confidence||0)+(words[j].confidence||0)-dx-dy*.1});
  }
  return candidates.sort((a,b)=>b.score-a.score)[0]||null;
}

function findAnchors(schema, layout) {
  const matches=[];
  layout.lines.forEach((line,lineIndex)=>schema.anchors.forEach(pattern=>{
    const words=patternMatch(line,pattern);
    if(words)matches.push({schema,line,lineIndex,words,bbox:unionBox(words)});
  }));
  const unique=matches.filter((match,index)=>!matches.slice(0,index).some(other=>other.lineIndex===match.lineIndex&&Math.abs(other.bbox.x0-match.bbox.x0)<layout.medianHeight));
  unique.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
  return unique;
}

function boxFromWords(words, layout) {
  const box=unionBox(words),pad=Math.max(2,layout.medianHeight*.22),iw=state.image.naturalWidth,ih=state.image.naturalHeight;
  const x0=Math.max(0,box.x0-pad),y0=Math.max(0,box.y0-pad*.6),x1=Math.min(iw,box.x1+pad),y1=Math.min(ih,box.y1+pad*.6);
  return [x0/iw,y0/ih,(x1-x0)/iw,(y1-y0)/ih];
}

function locateValue(anchor, allAnchors, layout) {
  const m=layout.medianHeight,iw=state.image.naturalWidth;
  const anchorWords=new Set(allAnchors.flatMap(item=>item.words));
  if(anchor.schema.placement==='right'){
    const sameLine=layout.lines[anchor.lineIndex]?.words.filter(word=>word.bbox.x0>anchor.bbox.x1+m*.15&&!anchorWords.has(word));
    if(sameLine?.length)return sameLine;
  }
  const right=allAnchors.filter(other=>other!==anchor&&Math.abs(other.bbox.y0-anchor.bbox.y0)<m*1.5&&other.bbox.x0>anchor.bbox.x1).sort((a,b)=>a.bbox.x0-b.bbox.x0)[0];
  const nextBelow=allAnchors.filter(other=>other!==anchor&&other.bbox.y0>anchor.bbox.y1&&Math.abs(other.bbox.x0-anchor.bbox.x0)<m*8).sort((a,b)=>a.bbox.y0-b.bbox.y0)[0];
  const xMin=Math.max(0,anchor.bbox.x0-m),xMax=Math.min(iw,right?right.bbox.x0-m*.25:anchor.bbox.x0+Math.max(anchor.bbox.x1-anchor.bbox.x0,m*20));
  const yMax=Math.min(anchor.bbox.y1+m*6,nextBelow?nextBelow.bbox.y0-m*.15:Infinity);
  const candidates=[];
  layout.lines.forEach(line=>{
    if(line.bbox.y0<anchor.bbox.y1-m*.15||line.bbox.y0>yMax)return;
    const words=line.words.filter(word=>!anchorWords.has(word)&&((word.bbox.x0+word.bbox.x1)/2)>=xMin&&((word.bbox.x0+word.bbox.x1)/2)<=xMax);
    if(words.length)candidates.push({line,words});
  });
  candidates.sort((a,b)=>a.line.bbox.y0-b.line.bbox.y0);
  if(!candidates.length){
    const sameLine=layout.lines[anchor.lineIndex]?.words.filter(word=>word.bbox.x0>anchor.bbox.x1+m*.3&&!anchorWords.has(word));
    return sameLine?.length?sameLine:null;
  }
  const chosen=[...candidates[0].words];
  for(let i=1;i<Math.min(candidates.length,anchor.schema.maxLines||1);i++){
    if(candidates[i].line.bbox.y0-candidates[i-1].line.bbox.y1<=m*2.2)chosen.push(...candidates[i].words);
  }
  return chosen;
}

function cleanFieldWords(schema,words=[]){
  const stop=new Set(['DOCUMENTO','NACIONAL','IDENTIDAD','ESPANA','REINO','APELLIDOS','APELLIDO','NOMBRE','SEXO','NACIONALIDAD','NACIMIENTO','EMISION','VALIDEZ','SOPORTE','NUM','DNI','CARD','IDENTITY','NATIONAL','DOMICILIO','LUGAR','HIJO','HIJA','HIJOJA','PROGENITORES','EQUIPO','ADDRESS','PLACE','PARENTS']);
  if(['surname','surname1','surname2','name'].includes(schema.id))return words.filter(word=>{const value=normalizeText(word.text);return /^[A-Z]{2,}$/.test(value)&&!stop.has(value);}).slice(0,schema.id==='name'?2:3);
  if(schema.id==='sex')return words.filter(word=>/^[MF]$/.test(normalizeText(word.text))).slice(0,1);
  if(schema.id==='nationality')return words.filter(word=>normalizeText(word.text)==='ESP').slice(0,1);
  if(schema.id==='support')return words.filter(word=>/^[A-Z]{2,4}\d{5,9}$/.test(normalizeText(word.text).replace(/ /g,''))).slice(0,1);
  if(schema.id==='birthPlace')return words.filter(word=>{const value=normalizeText(word.text);return /[A-Z]{3}/.test(value)&&![...stop].some(label=>value===label);}).slice(0,4);
  if(schema.id==='address')return words.filter(word=>{const value=normalizeText(word.text);return value&&!stop.has(value);}).slice(0,9);
  if(schema.id==='parents')return words.filter(word=>{const value=normalizeText(word.text);return /^[A-Z]{2,}$/.test(value)&&!stop.has(value);}).slice(0,7);
  return words;
}

function groupWordsByVisualLine(words,medianHeight){
  const groups=[];[...words].sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0).forEach(word=>{const cy=(word.bbox.y0+word.bbox.y1)/2;let group=groups.find(item=>Math.abs(item.cy-cy)<medianHeight*.8);if(!group){group={cy,words:[]};groups.push(group);}group.words.push(word);group.cy=(group.cy*(group.words.length-1)+cy)/group.words.length;});return groups.sort((a,b)=>a.cy-b.cy).map(group=>group.words.sort((a,b)=>a.bbox.x0-b.bbox.x0));
}

function findDniNumber(layout) {
  const candidates=[],iw=state.image.naturalWidth,ih=state.image.naturalHeight,letterMap='TRWAGMYFPDXBNJZSQVHLCKE';
  for(const line of layout.lines){
    for(let start=0;start<line.words.length;start++)for(let end=start;end<Math.min(line.words.length,start+4);end++){
      const words=line.words.slice(start,end+1),raw=normalizeText(words.map(word=>word.text).join('')).replace(/ /g,''),box=unionBox(words),cx=(box.x0+box.x1)/2,cy=(box.y0+box.y1)/2;let value=raw,score=words.reduce((s,w)=>s+(w.confidence||0),0)/Math.max(1,words.length)/100;
      if(/^\d{8}[A-Z]$/.test(raw)){const expected=letterMap[Number(raw.slice(0,8))%23];score+=raw[8]===expected?14:1;}
      else if(/^\d{8}$/.test(raw)){value=raw+letterMap[Number(raw)%23];score+=cy<ih*.38&&cx>iw*.28?6:-4;}
      else if(/^\d{9}$/.test(raw)&&cy<ih*.38&&cx>iw*.28){value=raw.slice(0,8)+letterMap[Number(raw.slice(0,8))%23];score+=1;}
      else continue;
      score+=(cy<ih*.38?4:0)+(cx>iw*.28?2:0)+(words.length===1?2:0);candidates.push({words,value,score});
    }
  }
  return candidates.sort((a,b)=>b.score-a.score)[0]||null;
}

function findSupportNumber(layout) {
  const candidates=layout.lines.flatMap(line=>line.words).filter(word=>{const value=normalizeText(word.text).replace(/ /g,'');return /^[A-Z]{2,4}\d{5,9}$/.test(value)&&!isMrzText(value);});
  const word=candidates.sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0];
  return word?{word,value:normalizeText(word.text).replace(/ /g,'')}:null;
}

function findCanNumber(layout, found) {
  const iw=state.image.naturalWidth,ih=state.image.naturalHeight;
  const dniDigits=(found.find(field=>field.id==='dni')?.hint||'').replace(/\D/g,'');
  const overlapsFound=word=>found.some(field=>field.box&&(()=>{const [x,y,w,h]=field.box,cx=(word.bbox.x0+word.bbox.x1)/2/iw,cy=(word.bbox.y0+word.bbox.y1)/2/ih;return cx>x&&cx<x+w&&cy>y&&cy<y+h;})());
  const candidates=layout.lines.flatMap(line=>line.words).filter(word=>{const value=normalizeText(word.text).replace(/ /g,'');return /^\d{6}$/.test(value)&&!dniDigits.includes(value)&&!overlapsFound(word);});
  const word=candidates.sort((a,b)=>(b.bbox.y1-a.bbox.y1)||((b.bbox.x1-b.bbox.x0)*(b.bbox.y1-b.bbox.y0)*(b.confidence||30))-((a.bbox.x1-a.bbox.x0)*(a.bbox.y1-a.bbox.y0)*(a.confidence||30)))[0];
  return word?{word,value:normalizeText(word.text).replace(/ /g,'')}:null;
}

function findTeamNumber(layout){
  const iw=state.image.naturalWidth;
  const candidates=layout.lines.flatMap(line=>line.words).filter(word=>{
    const value=normalizeText(word.text).replace(/ /g,''),cx=(word.bbox.x0+word.bbox.x1)/2,width=word.bbox.x1-word.bbox.x0,height=word.bbox.y1-word.bbox.y0;
    return cx<iw*.36&&height>width*1.2&&value.length>=8&&value.length<=13&&/[A-Z]/.test(value)&&/\d/.test(value)&&!value.includes('IDESP')&&!isMrzText(value);
  });
  const word=candidates.sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0];
  return word?{word,value:normalizeText(word.text).replace(/ /g,'')}:null;
}

function findIdentityNames(layout){
  const surnameSchema=FIELD_SCHEMAS.front.find(schema=>schema.id==='surname'),nameSchema=FIELD_SCHEMAS.front.find(schema=>schema.id==='name'),surnameAnchor=findAnchors(surnameSchema,layout)[0],nameAnchor=findAnchors(nameSchema,layout)[0];
  if(!nameAnchor)return [];
  const m=layout.medianHeight,stop=new Set(['DOCUMENTO','NACIONAL','IDENTIDAD','ESPANA','REINO','APELLIDOS','NOMBRE','SEXO','NACIONALIDAD','NACIMIENTO','EMISION','VALIDEZ','SOPORTE']);
  const anchors=[...FIELD_SCHEMAS.front.flatMap(schema=>findAnchors(schema,layout))];
  const collect=(anchor,yMax,maxWords)=>{
    const candidates=layout.lines.flatMap(line=>line.words).filter(word=>{const value=normalizeText(word.text),cx=(word.bbox.x0+word.bbox.x1)/2,cy=(word.bbox.y0+word.bbox.y1)/2;return cy>anchor.bbox.y1&&cy<yMax&&cx>anchor.bbox.x0-m*2&&cx<anchor.bbox.x0+m*14&&/^[A-Z]{3,}$/.test(value)&&!stop.has(value)&&(word.confidence||0)>30;}).sort((a,b)=>a.bbox.y0-b.bbox.y0||(b.confidence||0)-(a.confidence||0));
    return candidates.filter((word,index)=>!candidates.slice(0,index).some(other=>normalizeText(other.text)===normalizeText(word.text)&&Math.abs(other.bbox.y0-word.bbox.y0)<m)).slice(0,maxWords);
  };
  const result=[],nextAfterName=anchors.filter(anchor=>anchor.bbox.y0>nameAnchor.bbox.y1).sort((a,b)=>a.bbox.y0-b.bbox.y0)[0],nameWords=collect(nameAnchor,nextAfterName?.bbox.y0||nameAnchor.bbox.y1+m*7,2);
  if(nameWords.length)result.push({id:'name',label:'Nombre',hint:nameWords.map(word=>normalizeText(word.text)).join(' '),box:boxFromWords(nameWords,layout),selected:true,confidence:Math.round(nameWords.reduce((s,w)=>s+(w.confidence||0),0)/nameWords.length)});
  if(surnameAnchor){const nameValues=new Set(nameWords.map(word=>normalizeText(word.text))),surnameWords=collect(surnameAnchor,nameAnchor.bbox.y0,3).filter(word=>!nameValues.has(normalizeText(word.text))).slice(0,2);if(surnameWords.length)result.push({id:'surname',label:'Apellidos',hint:surnameWords.map(word=>normalizeText(word.text)).join(' '),box:boxFromWords(surnameWords,layout),selected:true,confidence:Math.round(surnameWords.reduce((s,w)=>s+(w.confidence||0),0)/surnameWords.length)});}
  return result;
}

function findSimpleFrontFields(layout){
  const words=layout.lines.flatMap(line=>line.words),derived=[];
  const nationality=words.filter(word=>normalizeText(word.text)==='ESP').sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0];
  if(nationality)derived.push({id:'nationality',label:'Nacionalidad',hint:'ESP',box:boxFromWords([nationality],layout),selected:true,confidence:Math.round(nationality.confidence||0)});
  const sex=words.filter(word=>/^[MF]$/.test(normalizeText(word.text))&&!isMrzText(normalizeText(word.text))).sort((a,b)=>nationality?Math.hypot(a.bbox.x0-nationality.bbox.x0,a.bbox.y0-nationality.bbox.y0)-Math.hypot(b.bbox.x0-nationality.bbox.x0,b.bbox.y0-nationality.bbox.y0):(b.confidence||0)-(a.confidence||0))[0];
  if(sex)derived.push({id:'sex',label:'Sexo',hint:normalizeText(sex.text),box:boxFromWords([sex],layout),selected:true,confidence:Math.round(sex.confidence||0)});
  const dates=[];
  layout.lines.forEach(line=>{const numeric=line.words.map(word=>({word,value:normalizeText(word.text).replace(/[^0-9]/g,'')})).filter(item=>/^\d{1,4}$/.test(item.value));for(let i=0;i<numeric.length-2;i++){const group=numeric.slice(i,i+3),day=+group[0].value,month=+group[1].value,year=+group[2].value;if(day>=1&&day<=31&&month>=1&&month<=12&&year>=1900&&year<=2099)dates.push({words:group.map(item=>item.word),value:`${String(day).padStart(2,'0')} ${String(month).padStart(2,'0')} ${year}`,year});}});
  const unique=dates.filter((date,index)=>!dates.slice(0,index).some(other=>other.value===date.value));
  const birth=unique.filter(date=>date.year<new Date().getFullYear()-12).sort((a,b)=>a.year-b.year)[0],expiry=unique.filter(date=>date.year>=new Date().getFullYear()-1).sort((a,b)=>b.year-a.year)[0],issue=unique.filter(date=>date!==birth&&date!==expiry).sort((a,b)=>b.year-a.year)[0];
  for(const [id,label,date,selected] of [['birth','Fecha de nacimiento',birth,true],['issue','Fecha de expedición',issue,false],['expiry','Fecha de validez',expiry,false]])if(date)derived.push({id,label,hint:date.value,box:boxFromWords(date.words,layout),selected,confidence:Math.round(date.words.reduce((s,w)=>s+(w.confidence||0),0)/date.words.length)});
  return derived;
}

function isMrzLine(line) {
  const compact=line.normalized.replace(/ /g,'');
  return isMrzText(compact);
}

function isMrzText(compact) {
  const chevrons=(compact.match(/</g)||[]).length;
  return compact.length>=22&&(chevrons>=2||compact.includes('IDESP'));
}

function findMrzLines(layout){
  if(!layout?.lines?.length)return [];
  const strict=layout.lines.filter(isMrzLine);if(strict.length>=2)return strict.slice(-3);
  const imageHeight=state.image?.naturalHeight||Math.max(...layout.lines.map(line=>line.bbox.y1));
  const relaxed=layout.lines.filter(line=>{const compact=line.normalized.replace(/ /g,''),allowed=(compact.match(/[A-Z0-9<]/g)||[]).length;return line.bbox.y0>imageHeight*.52&&compact.length>=27&&allowed/compact.length>.9&&(/[0-9]/.test(compact)||compact.includes('ESP'));});
  return relaxed.length>=2?relaxed.slice(-3):strict;
}

function longestCommonSubstring(a,b) {
  let best=0;const row=new Array(b.length+1).fill(0);
  for(let i=1;i<=a.length;i++)for(let j=b.length;j>=1;j--){row[j]=a[i-1]===b[j-1]?row[j-1]+1:0;best=Math.max(best,row[j]);}
  return best;
}

function normalizedBox(box) {
  const iw=state.image.naturalWidth,ih=state.image.naturalHeight;
  return [Math.max(0,box.x0)/iw,Math.max(0,box.y0)/ih,Math.min(iw,box.x1)-Math.max(0,box.x0),Math.min(ih,box.y1)-Math.max(0,box.y0)].map((value,index)=>index<2?value:value/(index===2?iw:ih));
}

function mrzDerivedFrontFields(layout) {
  const mrzLines=layout.lines.filter(isMrzLine),mrzWords=new Set(mrzLines.flatMap(line=>line.words).filter(word=>isMrzText(normalizeText(word.text).replace(/ /g,''))));
  if(!mrzLines.length)return [];
  const outside=layout.lines.flatMap(line=>line.words).filter(word=>!mrzWords.has(word));
  const nameLine=[...mrzLines].reverse().find(line=>line.words.some(word=>normalizeText(word.text).includes('<<')));
  const result=[];
  if(nameLine){
    const nameWord=nameLine.words.find(word=>normalizeText(word.text).includes('<<'));
    const compact=normalizeText(nameWord?.text||'').replace(/ /g,''),parts=compact.split(/<<+/),surnames=(parts[0]||'').split('<').filter(token=>token.length>1),given=(parts[1]||'').split('<').filter(token=>token.length>1);
    const matchesFor=token=>outside.filter(word=>{const value=normalizeText(word.text).replace(/ /g,'');return value===token||(token.length>=5&&editDistance(value,token)<=1);});
    const surnameWords=surnames.flatMap(matchesFor).sort((a,b)=>a.bbox.y0-b.bbox.y0);
    if(surnameWords.length)result.push({id:'surname',label:'Apellidos',hint:surnames.join(' '),box:boxFromWords(surnameWords,layout),selected:true,confidence:Math.round(surnameWords.reduce((s,w)=>s+(w.confidence||0),0)/surnameWords.length)});
    let nameWords=given.flatMap(matchesFor);
    if(!nameWords.length&&surnameWords.length){
      const lastY=Math.max(...surnameWords.map(word=>word.bbox.y1)),baseX=median(surnameWords.map(word=>word.bbox.x0)),m=layout.medianHeight;
      const next=layout.lines.filter(line=>line.bbox.y0>lastY&&line.bbox.y0<lastY+m*5&&line.words.some(word=>Math.abs(word.bbox.x0-baseX)<m*8)&&!isMrzLine(line)).sort((a,b)=>a.bbox.y0-b.bbox.y0)[0];
      if(next)nameWords=next.words.filter(word=>word.bbox.x0>=baseX-m&&word.bbox.x0<=baseX+m*15);
    }
    if(nameWords.length)result.push({id:'name',label:'Nombre',hint:given.join(' ')||nameWords.map(w=>w.text).join(' '),box:boxFromWords(nameWords,layout),selected:true,confidence:Math.round(nameWords.reduce((s,w)=>s+(w.confidence||0),0)/nameWords.length)});
  }
  const nationality=outside.filter(word=>normalizeText(word.text)==='ESP').sort((a,b)=>b.confidence-a.confidence)[0];
  if(nationality)result.push({id:'nationality',label:'Nacionalidad',hint:'ESP',box:boxFromWords([nationality],layout),selected:true,confidence:Math.round(nationality.confidence||0)});
  const secondMrz=mrzLines.find(line=>/^\d{6}/.test(line.normalized.replace(/ /g,'')));
  if(secondMrz){
    const compact=secondMrz.normalized.replace(/ /g,''),yy=Number(compact.slice(0,2)),year=String(yy>30?1900+yy:2000+yy);
    const yearWord=outside.find(word=>normalizeText(word.text).includes(year));
    if(yearWord){const h=yearWord.bbox.y1-yearWord.bbox.y0,expanded={x0:yearWord.bbox.x0-h*3,y0:yearWord.bbox.y0,x1:yearWord.bbox.x1+h*.3,y1:yearWord.bbox.y1};result.push({id:'birth',label:'Fecha de nacimiento',hint:`Fecha terminada en ${year}`,box:normalizedBox(expanded),selected:true,confidence:Math.round(yearWord.confidence||0)});}
  }
  const firstMrz=mrzLines.find(line=>line.normalized.replace(/ /g,'').includes('IDESP'));
  let supportWord=null;
  if(firstMrz){
    const compact=firstMrz.normalized.replace(/ /g,''),match=compact.match(/IDESP([A-Z0-9]+)</),support=(match?.[1]||'').slice(0,-1);
    if(support.length>=5){supportWord=outside.map(word=>({word,score:longestCommonSubstring(normalizeText(word.text).replace(/ /g,''),support)})).filter(item=>item.score>=5).sort((a,b)=>b.score-a.score)[0]?.word||null;
      if(supportWord)result.push({id:'support',label:'N.º de soporte',hint:support,box:boxFromWords([supportWord],layout),selected:true,confidence:Math.round(supportWord.confidence||0)});
    }
  }
  const expiryWord=outside.filter(word=>/^20\d{2}$/.test(normalizeText(word.text))).sort((a,b)=>b.bbox.y0-a.bbox.y0)[0];
  if(expiryWord){
    const line=layout.lines.find(candidate=>candidate.words.includes(expiryWord)),m=layout.medianHeight;
    const dateWords=(line?.words||[expiryWord]).filter(word=>word!==supportWord&&word.bbox.x1<=expiryWord.bbox.x1+m&&word.bbox.x0>=expiryWord.bbox.x0-m*7);
    result.push({id:'expiry',label:'Fecha de validez',hint:dateWords.map(word=>word.text).join(' '),box:boxFromWords(dateWords,layout),selected:false,confidence:Math.round(dateWords.reduce((s,w)=>s+(w.confidence||0),0)/dateWords.length)});
  }
  return result;
}

function backDerivedFields(layout,found) {
  const derived=[],ih=state.image.naturalHeight,used=word=>found.some(field=>{const [x,y,w,h]=field.box,cx=(word.bbox.x0+word.bbox.x1)/2/state.image.naturalWidth,cy=(word.bbox.y0+word.bbox.y1)/2/ih;return cx>=x&&cx<=x+w&&cy>=y&&cy<=y+h;});
  const birthProvince=found.find(field=>field.id==='birthProvince'),address=found.find(field=>field.id==='address'),province=found.find(field=>field.id==='province');
  const stop=new Set(['HIJO','HIJA','DE','DOMICILIO','LUGAR','PROVINCIA','PAIS','ADDRESS','PLACE']);
  if(!found.some(field=>field.id==='parents')&&birthProvince&&address){
    const yMin=(birthProvince.box[1]+birthProvince.box[3])*ih,yMax=address.box[1]*ih;
    const candidates=layout.lines.filter(line=>line.bbox.y0>yMin&&line.bbox.y1<yMax).map(line=>({line,words:line.words.filter(word=>{const value=normalizeText(word.text);return /^[A-Z]{2,}$/.test(value)&&!stop.has(value)&&!used(word);})})).filter(item=>item.words.length>=2).sort((a,b)=>b.words.reduce((s,w)=>s+(w.confidence||0),0)-a.words.reduce((s,w)=>s+(w.confidence||0),0));
    if(candidates[0]){const words=candidates[0].words;derived.push({id:'parents',label:'Progenitores',hint:words.map(word=>word.text).join(' '),box:boxFromWords(words,layout),selected:true,confidence:Math.round(words.reduce((s,w)=>s+(w.confidence||0),0)/words.length)});}
  }
  if(!found.some(field=>field.id==='city')&&address&&province){
    const yMin=(address.box[1]+address.box[3])*ih,yMax=province.box[1]*ih,baseX=address.box[0]*state.image.naturalWidth,m=layout.medianHeight,knownPlaces=new Set(found.filter(field=>field.id==='birthPlace'||field.id==='birthProvince').map(field=>normalizeText(field.hint)));
    const candidates=layout.lines.flatMap(line=>line.words).filter(word=>{const value=normalizeText(word.text),cy=(word.bbox.y0+word.bbox.y1)/2;return cy>yMin&&cy<yMax&&Math.abs(word.bbox.x0-baseX)<m*8&&/^[A-Z]{3,}$/.test(value)&&!stop.has(value)&&!used(word);}).sort((a,b)=>(knownPlaces.has(normalizeText(b.text))?100:0)+(b.confidence||0)-(knownPlaces.has(normalizeText(a.text))?100:0)-(a.confidence||0));
    if(candidates[0]){const word=candidates[0];derived.push({id:'city',label:'Lugar de domicilio',hint:word.text,box:boxFromWords([word],layout),selected:true,confidence:Math.round(word.confidence||0)});}
  }
  return derived;
}

function frontProximityFields(layout,found) {
  if(found.some(field=>field.id==='surname'||field.id==='surname1'||field.id==='surname2'))return [];
  const name=found.find(field=>field.id==='name');if(!name)return [];
  const iw=state.image.naturalWidth,ih=state.image.naturalHeight,m=layout.medianHeight,baseX=name.box[0]*iw,nameY=name.box[1]*ih;
  const stop=new Set(['APELLIDO','APELLIDOS','PRIMER','SEGUNDO','NOMBRE','NAME','SURNAME','DOCUMENTO','IDENTIDAD']);
  const candidateLines=layout.lines.filter(line=>line.bbox.y1<nameY&&line.bbox.y1>nameY-m*20).map(line=>({line,words:line.words.filter(word=>{const value=normalizeText(word.text).replace(/ /g,'');return /^[A-Z]{3,}$/.test(value)&&!stop.has(value)&&Math.abs(word.bbox.x0-baseX)<m*8&&(word.confidence||0)>35;})})).filter(item=>item.words.length).sort((a,b)=>b.line.bbox.y0-a.line.bbox.y0);
  const selected=[];for(const candidate of candidateLines){if(!selected.some(word=>Math.abs(word.bbox.y0-candidate.words[0].bbox.y0)<m*.7))selected.push(...candidate.words);if(selected.length>=2)break;}
  if(!selected.length)return [];
  return [{id:'surname',label:'Apellidos',hint:selected.map(word=>word.text).join(' '),box:boxFromWords(selected,layout),selected:true,confidence:Math.round(selected.reduce((s,w)=>s+(w.confidence||0),0)/selected.length)}];
}

function buildFieldsFromOcr(side) {
  if(!state.ocrLayout)return [];
  const layout=state.ocrLayout,schemas=FIELD_SCHEMAS[side],found=[],allAnchors=[];
  schemas.forEach(schema=>{
    const matches=findAnchors(schema,layout);const anchor=matches[schema.occurrence||0];
    if(anchor)allAnchors.push(anchor);
  });
  allAnchors.forEach(anchor=>{
    let words=cleanFieldWords(anchor.schema,locateValue(anchor,allAnchors,layout));let box;
    if(anchor.schema.graphic&&!words?.length){
      const m=layout.medianHeight,iw=state.image.naturalWidth,ih=state.image.naturalHeight;
      box=[anchor.bbox.x0/iw,anchor.bbox.y1/ih,Math.min(iw-anchor.bbox.x0,m*18)/iw,Math.min(ih-anchor.bbox.y1,m*6)/ih];
    }else if(words?.length)box=boxFromWords(words,layout);
    if(!box)return;
    const hint=words?.map(word=>word.text).join(' ').replace(/\s+/g,' ').trim()||'Elemento gráfico detectado';
    const confidence=words?.length?Math.round(words.reduce((sum,word)=>sum+(word.confidence||0),0)/words.length):null;
    found.push({id:anchor.schema.id,label:anchor.schema.label,hint:hint.slice(0,48),box,selected:anchor.schema.selected!==false,confidence});
    if(side==='back'&&words?.length){
      const groups=groupWordsByVisualLine(words,layout.medianHeight);
      if(anchor.schema.id==='birthPlace'&&groups.length>=2&&!found.some(field=>field.id==='birthProvince')){const provinceWords=groups.at(-1);found.push({id:'birthProvince',label:'Provincia/país de nacimiento',hint:provinceWords.map(word=>word.text).join(' '),box:boxFromWords(provinceWords,layout),selected:true,confidence:Math.round(provinceWords.reduce((sum,word)=>sum+(word.confidence||0),0)/provinceWords.length)});}
      if(anchor.schema.id==='address'&&groups.length>=2){const cityWords=groups.length>=3?groups.at(-2):groups.at(-1),provinceWords=groups.at(-1);if(!found.some(field=>field.id==='city'))found.push({id:'city',label:'Lugar de domicilio',hint:cityWords.map(word=>word.text).join(' '),box:boxFromWords(cityWords,layout),selected:true,confidence:Math.round(cityWords.reduce((sum,word)=>sum+(word.confidence||0),0)/cityWords.length)});if(groups.length>=3&&!found.some(field=>field.id==='province'))found.push({id:'province',label:'Provincia/país',hint:provinceWords.map(word=>word.text).join(' '),box:boxFromWords(provinceWords,layout),selected:true,confidence:Math.round(provinceWords.reduce((sum,word)=>sum+(word.confidence||0),0)/provinceWords.length)});}
    }
  });
  if(side==='front'){
    mrzDerivedFrontFields(layout).forEach(field=>{if(!found.some(existing=>existing.id===field.id))found.push(field);});
    frontProximityFields(layout,found).forEach(field=>found.push(field));
    if(!found.some(field=>field.id==='surname'||field.id==='surname1'||field.id==='surname2')){const repeated=findRepeatedSurname(layout);if(repeated)found.push({id:'surname',label:'Apellidos',hint:repeated.value,box:boxFromWords(repeated.words,layout),selected:true,confidence:Math.round(repeated.words.reduce((s,w)=>s+(w.confidence||0),0)/repeated.words.length)});}
    const replace=field=>{const index=found.findIndex(existing=>existing.id===field.id);if(index>=0)found[index]=field;else found.push(field);};
    const dni=findDniNumber(layout);if(dni)replace({id:'dni',label:'Número de DNI',hint:dni.value,box:boxFromWords(dni.words,layout),selected:true,confidence:Math.round(dni.words.reduce((s,w)=>s+(w.confidence||0),0)/dni.words.length)});
    const support=findSupportNumber(layout);if(support)replace({id:'support',label:'N.º de soporte',hint:support.value,box:boxFromWords([support.word],layout),selected:true,confidence:Math.round(support.word.confidence||0)});
    findSimpleFrontFields(layout).forEach(replace);
    findIdentityNames(layout).forEach(field=>{if(!found.some(existing=>existing.id===field.id))found.push(field);});
    const can=findCanNumber(layout,found);if(can&&!found.some(field=>field.id==='can'))found.push({id:'can',label:'Código CAN',hint:can.value,box:boxFromWords([can.word],layout),selected:false,confidence:Math.round(can.word.confidence||0)});
    if(state.photoField)found.unshift(state.photoField);
  }else{
    const mrzLines=findMrzLines(layout);if(mrzLines.length){const words=mrzLines.flatMap(line=>line.words).filter(word=>normalizeText(word.text));found.push({id:'mrz',label:'Código MRZ',hint:`${mrzLines.length} líneas de lectura mecánica`,box:boxFromWords(words,layout),selected:true,confidence:Math.round(words.reduce((s,w)=>s+(w.confidence||0),0)/words.length)});}
    const team=findTeamNumber(layout);if(team){const field={id:'team',label:'Equipo de expedición',hint:team.value,box:boxFromWords([team.word],layout),selected:true,confidence:Math.round(team.word.confidence||0)},index=found.findIndex(existing=>existing.id==='team');if(index>=0)found[index]=field;else found.push(field);}
    backDerivedFields(layout,found).forEach(field=>{if(!found.some(existing=>existing.id===field.id))found.push(field);});
  }
  const deduped=found.filter((field,index)=>!found.slice(0,index).some(previous=>previous.id===field.id));
  const detected=deduped.filter(field=>field.id!=='surname'||!deduped.some(other=>other.id==='surname1'||other.id==='surname2'));
  detected.forEach(field=>{field.selected=defaultFieldSelection(side,field.id);});
  const oldSurnameLayout=/PRIMER\s+APELLIDO/.test(normalizeText(state.ocrText));
  const expected=side==='front'
    ? FIELD_SCHEMAS.front.filter(schema=>oldSurnameLayout?schema.id!=='surname':!['surname1','surname2'].includes(schema.id)).concat([{id:'photo',label:'Fotografía'}])
    : FIELD_SCHEMAS.back.concat([{id:'mrz',label:'Código MRZ'}]);
  expected.forEach(schema=>{if(!detected.some(field=>field.id===schema.id))detected.push({id:schema.id,label:schema.label,hint:'No localizado; puedes añadir una zona manual',box:null,selected:false,confidence:null,missing:true});});
  return detected;
}

async function detectPortraitField() {
  if(!('FaceDetector'in window))return null;
  try{
    const faces=await new FaceDetector({fastMode:true,maxDetectedFaces:3}).detect(state.image);if(!faces.length)return null;
    const face=faces.sort((a,b)=>b.boundingBox.width*b.boundingBox.height-a.boundingBox.width*a.boundingBox.height)[0].boundingBox;
    const iw=state.image.naturalWidth,ih=state.image.naturalHeight,x=Math.max(0,face.x-face.width*.55),y=Math.max(0,face.y-face.height*.55),w=Math.min(iw-x,face.width*2.1),h=Math.min(ih-y,face.height*2.25);
    return {id:'photo',label:'Fotografía',hint:'Rostro localizado en el documento',box:[x/iw,y/ih,w/iw,h/ih],selected:false,confidence:null};
  }catch{return null;}
}

function updateSideUI() {
  $$('.side-option').forEach(btn => btn.classList.toggle('active', btn.dataset.side === state.side));
  $('#side-label').textContent = state.side === 'front' ? 'Anverso del DNI' : 'Reverso del DNI';
}

$$('.side-option').forEach(btn => btn.addEventListener('click', () => setSide(btn.dataset.side)));

function renderFieldList() {
  const list = $('#field-list');
  list.innerHTML = '';
  if(!state.fields.length){
    list.innerHTML='<div class="empty-fields"><b>No se han localizado campos en esta cara</b><span>Prueba con una foto más nítida o añade las zonas manualmente sobre el documento.</span></div>';
    return;
  }
  state.fields.forEach(field => {
    const label = document.createElement('div');
    label.className = `field-item${field.missing?' missing':''}${state.focusedField===field.id?' focused':''}`;
    const confidence = field.confidence ?? null;
    label.innerHTML = `<label class="field-toggle"><input type="checkbox" ${field.selected ? 'checked' : ''} ${field.box?'':'disabled'} data-field="${field.id}">
      <span class="field-check"><svg viewBox="0 0 20 20"><path d="m5.5 10 3 3 6-6"/></svg></span>
      <span class="field-copy"><b>${escapeHtml(field.label)}</b><small>${escapeHtml(field.hint)}</small></span></label>
      ${field.manual ? '' : `<span class="confidence ${field.missing?'missing':confidence !== null && confidence < 70 ? 'low' : ''}">${field.missing?'No localizado':confidence === null ? 'Localizado' : `${confidence}%`}</span>`}
      ${field.box?`<button type="button" class="move-field" data-move-field="${field.id}" aria-label="Mover ${escapeHtml(field.label)}"><svg viewBox="0 0 20 20"><path d="M10 2.5v15M2.5 10h15M10 2.5 7.5 5M10 2.5 12.5 5M17.5 10 15 7.5M17.5 10 15 12.5M10 17.5 7.5 15M10 17.5 12.5 15M2.5 10 5 7.5M2.5 10 5 12.5"/></svg></button>`:''}`;
    list.appendChild(label);
  });
  $$('input[data-field]', list).forEach(input => input.addEventListener('change', () => {
    state.fields.find(f => f.id === input.dataset.field).selected = input.checked;
    render();
  }));
  $$('[data-move-field]',list).forEach(button=>button.addEventListener('click',()=>{
    const field=state.fields.find(item=>item.id===button.dataset.moveField);if(!field)return;
    field.selected=true;setAdjustMode(true,field.id);renderFieldList();render();
    $('#canvas-stage').scrollIntoView({behavior:'smooth',block:'center'});toast('Arrastra la zona sobre el documento. Usa la esquina para cambiar su tamaño.');
  }));
}

$('#select-all').addEventListener('click', () => { state.fields.forEach(f => f.selected = Boolean(f.box)); renderFieldList(); render(); });
$('#clear-all').addEventListener('click', () => { state.fields.forEach(f => f.selected = false); renderFieldList(); render(); });

function setAdjustMode(enabled,focusedField=null){
  state.adjustMode=enabled;
  state.focusedField=enabled?focusedField:null;
  state.manualMode = false;
  $('#adjust-fields').classList.toggle('active', state.adjustMode);
  $('#add-area').classList.remove('active');
  $('#add-area').innerHTML = '<svg viewBox="0 0 20 20"><path d="M4 15.5 7.2 15l7.9-7.9-2.3-2.3-7.9 7.9L4 15.5Z"/><path d="m11.6 6 2.3 2.3M4 15.5h3.2"/></svg><span><b>Activar modo manual</b><small>Pinta con el dedo o arrastra con el ratón sobre cada zona que quieras censurar.</small></span>';
  canvas.style.cursor = state.adjustMode ? 'move' : 'default';
  canvas.classList.toggle('editing-zones',state.adjustMode);
  $('#canvas-hint-text').textContent = state.adjustMode
    ? 'Arrastra una zona para moverla o su esquina inferior derecha para cambiar su tamaño.'
    : 'Activa o desactiva los campos y comprueba el resultado en tiempo real.';
}

$('#adjust-fields').addEventListener('click', () => {
  setAdjustMode(!state.adjustMode);
  render();
});

$('#add-area').addEventListener('click', () => {
  state.manualMode = !state.manualMode;
  state.adjustMode = false;
  state.focusedField = null;
  $('#adjust-fields').classList.remove('active');
  $('#add-area').classList.toggle('active', state.manualMode);
  $('#add-area').innerHTML = state.manualMode
    ? '<svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15"/></svg><span><b>Salir del modo manual</b><small>Ahora arrastra sobre el documento para crear tantas censuras como necesites.</small></span>'
    : '<svg viewBox="0 0 20 20"><path d="M4 15.5 7.2 15l7.9-7.9-2.3-2.3-7.9 7.9L4 15.5Z"/><path d="m11.6 6 2.3 2.3M4 15.5h3.2"/></svg><span><b>Activar modo manual</b><small>Pinta con el dedo o arrastra con el ratón sobre cada zona que quieras censurar.</small></span>';
  canvas.style.cursor = state.manualMode ? 'crosshair' : 'default';
  canvas.classList.toggle('editing-zones',state.manualMode);
  $('#canvas-hint-text').textContent = state.manualMode ? 'Arrastra sobre la imagen para crear una zona de censura.' : 'Activa o desactiva los campos y comprueba el resultado en tiempo real.';
});

let dragStart = null;
let fieldDrag = null;
canvas.addEventListener('pointerdown', e => {
  if (state.adjustMode) {
    const p = canvasPoint(e);
    const candidates=state.fields.filter(field=>field.selected&&field.box).sort((a,b)=>(a.id===state.focusedField?1:0)-(b.id===state.focusedField?1:0));
    const hit = [...candidates].reverse().find(field => {
      const x=field.box[0]*canvas.width,y=field.box[1]*canvas.height,w=field.box[2]*canvas.width,h=field.box[3]*canvas.height;
      const handle=Math.max(14,canvas.width*.012);
      return (p.x>=x&&p.x<=x+w&&p.y>=y&&p.y<=y+h)||Math.hypot(p.x-(x+w),p.y-(y+h))<=handle;
    });
    if (!hit) return;
    state.focusedField=hit.id;
    const x=hit.box[0]*canvas.width,y=hit.box[1]*canvas.height,w=hit.box[2]*canvas.width,h=hit.box[3]*canvas.height;
    const handle=Math.max(14,canvas.width*.012);
    fieldDrag={field:hit,mode:Math.hypot(p.x-(x+w),p.y-(y+h))<=handle?'resize':'move',start:p,original:[...hit.box]};
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (!state.manualMode) return;
  const p = canvasPoint(e); dragStart = p; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!fieldDrag) return;
  const p=canvasPoint(e),dx=(p.x-fieldDrag.start.x)/canvas.width,dy=(p.y-fieldDrag.start.y)/canvas.height;
  const [x,y,w,h]=fieldDrag.original;
  if(fieldDrag.mode==='move'){
    fieldDrag.field.box[0]=Math.max(0,Math.min(1-w,x+dx));
    fieldDrag.field.box[1]=Math.max(0,Math.min(1-h,y+dy));
  }else{
    fieldDrag.field.box[2]=Math.max(.025,Math.min(1-x,w+dx));
    fieldDrag.field.box[3]=Math.max(.02,Math.min(1-y,h+dy));
  }
  render();
});
canvas.addEventListener('pointerup', e => {
  if(fieldDrag){fieldDrag=null;renderFieldList();render();toast('Posición actualizada.');return;}
  if (!state.manualMode || !dragStart) return;
  const end = canvasPoint(e);
  const x = Math.min(dragStart.x, end.x), y = Math.min(dragStart.y, end.y);
  const w = Math.abs(end.x-dragStart.x), h = Math.abs(end.y-dragStart.y);
  dragStart = null;
  if (w > 8 && h > 8) {
    const count = state.fields.filter(f => f.manual).length + 1;
    state.fields.push({ id: `manual-${Date.now()}`, label: `Zona manual ${count}`, hint: 'Área añadida por ti', box: [x/canvas.width,y/canvas.height,w/canvas.width,h/canvas.height], selected: true, manual: true });
    renderFieldList(); render(); toast('Zona manual añadida.');
  }
});
canvas.addEventListener('pointercancel',()=>{fieldDrag=null;dragStart=null;});
function canvasPoint(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX-r.left)*canvas.width/r.width, y:(e.clientY-r.top)*canvas.height/r.height }; }

$$('#redaction-style button').forEach(btn => btn.addEventListener('click', () => {
  state.redactionStyle = btn.dataset.style;
  $$('#redaction-style button').forEach(b => b.classList.toggle('active', b === btn)); render();
}));

$('#watermark-enabled').addEventListener('change', e => { state.watermark.enabled = e.target.checked; $('#watermark-controls').style.opacity = e.target.checked ? '1' : '.42'; render(); });
$('#watermark-text').addEventListener('input', e => { state.watermark.text = e.target.value; $('#char-count').textContent = `${e.target.value.length}/60`; render(); });
$$('.watermark-layouts button').forEach(btn => btn.addEventListener('click', () => { state.watermark.layout = btn.dataset.watermark; $$('.watermark-layouts button').forEach(b => b.classList.toggle('active', b === btn)); render(); }));
$('#watermark-size').addEventListener('input', e => { state.watermark.size = +e.target.value/100; $('#size-label').textContent = `${e.target.value}%`; render(); });
$('#watermark-opacity').addEventListener('input', e => { state.watermark.opacity = +e.target.value/100; $('#opacity-label').textContent = `${e.target.value}%`; render(); });
$$('.color-options button').forEach(btn => btn.addEventListener('click', () => { state.watermark.color = btn.dataset.color; $$('.color-options button').forEach(b => b.classList.toggle('active', b === btn)); render(); }));

function render() {
  if (!state.image || state.rendering) return;
  state.rendering = true;
  if(state.step===4){persistActiveDocument();composeDocuments(canvas);state.rendering=false;return;}
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(state.image,0,0,canvas.width,canvas.height);
  // Paso 1: documento original. Paso 2: censuras. Paso 3 y 4: resultado completo.
  if (state.step >= 2) {
    if (state.adjustMode && state.step === 2) state.fields.filter(f => f.selected&&f.box).forEach(drawAdjustmentGuide);
    else state.fields.filter(f => f.selected&&f.box).forEach(field=>drawRedaction(field));
  }
  if (state.step >= 3 && state.watermark.enabled && state.watermark.text.trim()) drawWatermark();
  state.rendering = false;
}

function createDocumentCanvas(documentState,targetWidth){
  const surface=document.createElement('canvas'),scale=targetWidth/documentState.image.naturalWidth;
  surface.width=Math.round(targetWidth);surface.height=Math.round(documentState.image.naturalHeight*scale);
  const surfaceCtx=surface.getContext('2d');surfaceCtx.drawImage(documentState.image,0,0,surface.width,surface.height);
  documentState.fields.filter(field=>field.selected&&field.box).forEach(field=>drawRedaction(field,surface,surfaceCtx));
  if(state.watermark.enabled&&state.watermark.text.trim())drawWatermark(surface,surfaceCtx);
  return surface;
}

function composeDocuments(target){
  const documents=[...state.documents];if(state.activeDocument>=0&&state.image)documents[state.activeDocument]=currentDocumentSnapshot();
  const usable=documents.filter(documentState=>documentState?.image);if(!usable.length)return target;
  const totalRatio=usable.reduce((sum,documentState)=>sum+documentState.image.naturalHeight/documentState.image.naturalWidth,0),maxPixels=14000000;
  const widest=Math.max(...usable.map(documentState=>documentState.image.naturalWidth)),width=Math.max(600,Math.round(Math.min(1800,widest,Math.sqrt(maxPixels/Math.max(.1,totalRatio))))),gap=Math.max(12,Math.round(width*.018));
  const heights=usable.map(documentState=>Math.round(width*documentState.image.naturalHeight/documentState.image.naturalWidth));
  target.width=width;target.height=heights.reduce((sum,height)=>sum+height,0)+gap*(usable.length-1);
  const targetCtx=target.getContext('2d');targetCtx.fillStyle='#ffffff';targetCtx.fillRect(0,0,target.width,target.height);
  let y=0;usable.forEach((documentState,index)=>{const surface=createDocumentCanvas(documentState,width);targetCtx.drawImage(surface,0,y);y+=surface.height+(index<usable.length-1?gap:0);});
  return target;
}

function drawRedaction(field,targetCanvas=canvas,targetCtx=ctx) {
  const [rx,ry,rw,rh] = field.box;
  const x=rx*targetCanvas.width,y=ry*targetCanvas.height,w=rw*targetCanvas.width,h=rh*targetCanvas.height;
  targetCtx.save();
  if (state.redactionStyle === 'solid') {
    targetCtx.fillStyle = '#111716'; targetCtx.fillRect(x,y,w,h);
  } else {
    const sx=Math.max(0,Math.floor(x)),sy=Math.max(0,Math.floor(y)),sw=Math.min(targetCanvas.width-sx,Math.ceil(w)),sh=Math.min(targetCanvas.height-sy,Math.ceil(h));
    if (sw > 0 && sh > 0) {
      const buffer=document.createElement('canvas'), bctx=buffer.getContext('2d');
      const factor=state.redactionStyle==='pixel' ? .055 : .025;
      buffer.width=Math.max(2,Math.round(sw*factor));buffer.height=Math.max(2,Math.round(sh*factor));
      bctx.drawImage(targetCanvas,sx,sy,sw,sh,0,0,buffer.width,buffer.height);
      targetCtx.imageSmoothingEnabled = state.redactionStyle === 'blur';
      targetCtx.drawImage(buffer,0,0,buffer.width,buffer.height,sx,sy,sw,sh);
      if (state.redactionStyle==='blur') { targetCtx.globalAlpha=.22; targetCtx.fillStyle='#68716f'; targetCtx.fillRect(x,y,w,h); }
    }
  }
  targetCtx.strokeStyle='rgba(255,255,255,.7)';targetCtx.lineWidth=Math.max(1,targetCanvas.width/900);targetCtx.strokeRect(x+.5,y+.5,w-1,h-1);targetCtx.restore();
}

function drawAdjustmentGuide(field) {
  const [rx,ry,rw,rh]=field.box;
  const x=rx*canvas.width,y=ry*canvas.height,w=rw*canvas.width,h=rh*canvas.height;
  ctx.save();
  ctx.fillStyle='rgba(14,93,80,.16)';ctx.fillRect(x,y,w,h);
  ctx.strokeStyle='#0e5d50';ctx.lineWidth=Math.max(2,canvas.width/700);ctx.setLineDash([10,7]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
  const handle=Math.max(12,canvas.width*.009);ctx.fillStyle='#0e5d50';ctx.fillRect(x+w-handle/2,y+h-handle/2,handle,handle);
  const fontSize=Math.max(12,canvas.width*.012);ctx.font=`700 ${fontSize}px DM Sans, sans-serif`;const labelWidth=ctx.measureText(field.label).width+16;
  const labelY=Math.max(0,y-fontSize-8);ctx.fillStyle='#0e5d50';ctx.fillRect(x,labelY,labelWidth,fontSize+8);
  ctx.fillStyle='white';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(field.label,x+8,labelY+(fontSize+8)/2);
  ctx.restore();
}

function drawWatermark(targetCanvas=canvas,targetCtx=ctx) {
  const text=state.watermark.text.toUpperCase();
  const base=Math.max(12,targetCanvas.width*.042*state.watermark.size);
  targetCtx.save(); targetCtx.fillStyle=hexToRgba(state.watermark.color,state.watermark.opacity); targetCtx.textAlign='center';targetCtx.textBaseline='middle';targetCtx.font=`800 ${base}px Manrope, sans-serif`;
  if (state.watermark.layout==='repeat') {
    targetCtx.translate(targetCanvas.width/2,targetCanvas.height/2);targetCtx.rotate(-Math.PI/7);const gapX=Math.max(targetCanvas.width*.26,targetCtx.measureText(text).width*1.35),gapY=base*3.3;
    for(let y=-targetCanvas.height;y<targetCanvas.height;y+=gapY) for(let x=-targetCanvas.width;x<targetCanvas.width;x+=gapX) targetCtx.fillText(text,x,y);
  } else if (state.watermark.layout==='center') {
    targetCtx.font=`800 ${Math.max(18,targetCanvas.width*.072*state.watermark.size)}px Manrope, sans-serif`;targetCtx.fillText(text,targetCanvas.width/2,targetCanvas.height/2);
  } else if (state.watermark.layout==='diagonal') {
    targetCtx.translate(targetCanvas.width/2,targetCanvas.height/2);targetCtx.rotate(-Math.PI/7);targetCtx.font=`800 ${Math.max(18,targetCanvas.width*.068*state.watermark.size)}px Manrope, sans-serif`;targetCtx.fillText(text,0,0);
  } else {
    targetCtx.font=`800 ${Math.max(12,targetCanvas.width*.032*state.watermark.size)}px Manrope, sans-serif`;targetCtx.fillText(text,targetCanvas.width/2,targetCanvas.height-base*1.05);
  }
  targetCtx.restore();
}

function hexToRgba(hex, alpha) { const n=parseInt(hex.slice(1),16); return `rgba(${n>>16},${(n>>8)&255},${n&255},${alpha})`; }

$('#zoom-in').addEventListener('click', () => setZoom(state.zoom+.1));
$('#zoom-out').addEventListener('click', () => setZoom(state.zoom-.1));
function setZoom(value) { state.zoom=Math.min(1.5,Math.max(.6,value));canvas.style.transform=`scale(${state.zoom})`;$('#zoom-value').textContent=`${Math.round(state.zoom*100)}%`; }

$('#next-step').addEventListener('click', () => { if (state.step < 4) goToStep(state.step+1); });
$('#prev-step').addEventListener('click', () => { if (state.step > 1) goToStep(state.step-1); });
$$('.step').forEach(btn => btn.addEventListener('click', () => { const step=+btn.dataset.step;if(step<=state.step || step===state.step+1)goToStep(step); }));

function goToStep(step) {
  const previousStep=state.step;
  state.step=step;
  if(previousStep===4&&step!==4&&state.image)fitCanvas(state.image);
  if(step!==2&&state.adjustMode){
    setAdjustMode(false);
  }
  $$('.panel-step').forEach(p=>p.classList.toggle('active',+p.dataset.panel===step));
  $$('.step').forEach(s=>{const n=+s.dataset.step;s.classList.toggle('active',n===step);s.classList.toggle('done',n<step);});
  $$('.stepper > i').forEach((line,i)=>line.classList.toggle('done',i<step-1));
  $('#prev-step').disabled=step===1;
  $('#panel-nav').classList.toggle('hidden',step===4);
  $('#next-step').innerHTML=step===3?'Ver resultado <svg viewBox="0 0 20 20"><path d="m7.5 4.5 5 5-5 5"/></svg>':'Continuar <svg viewBox="0 0 20 20"><path d="m7.5 4.5 5 5-5 5"/></svg>';
  const names=['Documento','Datos a ocultar','Marca de agua','Resultado'];
  $('#mobile-step-title').textContent=`${step} de 4 · ${names[step-1]}`;
  $('#canvas-hint-text').textContent=step===1?'Puedes añadir más documentos y cambiar entre ellos desde la barra superior.':step===2?'Activa o desactiva campos y comprueba el resultado en tiempo real.':step===3?'Ajusta la marca de agua: se aplicará a todos los documentos.':'Comprueba bien todos los documentos antes de compartirlos.';
  if(step===4) updateSummary();
  render();
  if(window.innerWidth<901) $('.control-panel').scrollIntoView({behavior:'smooth',block:'start'});
}

function updateSummary() {
  persistActiveDocument();const documents=state.documents.filter(documentState=>documentState?.image),count=documents.reduce((sum,documentState)=>sum+documentState.fields.filter(field=>field.selected&&field.box).length,0);
  $('#result-summary').innerHTML=`<div><span>Documentos</span><b>${documents.length} ${documents.length===1?'imagen':'imágenes'} · composición vertical</b></div><div><span>Datos censurados</span><b>${count} ${count===1?'campo':'campos'}</b></div><div><span>Marca de agua</span><b>${state.watermark.enabled?'Aplicada':'Sin marca'}</b></div><div><span>Procesamiento</span><b>Local y privado</b></div>`;
}

$$('.format-selector button').forEach(btn=>btn.addEventListener('click',()=>{state.format=btn.dataset.format;$$('.format-selector button').forEach(b=>b.classList.toggle('active',b===btn));}));
function makeResultCanvas(){persistActiveDocument();return composeDocuments(document.createElement('canvas'));}
function canvasBlob(surface,mime){return new Promise((resolve,reject)=>surface.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo generar la imagen')),mime,.94));}
async function makeResultFile(){const mime=state.format==='png'?'image/png':'image/jpeg',extension=state.format==='png'?'png':'jpg',blob=await canvasBlob(makeResultCanvas(),mime),base=state.documents.length>1?'dni-protegidos':`${state.fileName}-protegido`;return {blob,file:new File([blob],`${base}.${extension}`,{type:mime})};}
function downloadBlob(blob,name){const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1500);}

$('#download-result').addEventListener('click',async()=>{try{const {blob,file}=await makeResultFile();downloadBlob(blob,file.name);toast('Archivo preparado en tu dispositivo.');}catch{toast('No se ha podido generar la imagen.');}});

async function shareResult(saveToPhotos=false){
  try{
    const {blob,file}=await makeResultFile();
    if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
      await navigator.share(saveToPhotos?{files:[file]}:{files:[file],title:'DNI protegido',text:'Copia de DNI protegida'});
      toast(saveToPhotos?'Elige “Guardar imagen” para añadirla a Fotos.':'Imagen compartida.');
    }else{
      downloadBlob(blob,file.name);toast('Tu navegador no permite compartir imágenes; se ha descargado el archivo.');
    }
  }catch(error){if(error?.name!=='AbortError')toast('No se ha podido abrir el menú para compartir.');}
}

$('#share-result').addEventListener('click',()=>shareResult(false));
$('#save-photos').addEventListener('click',()=>shareResult(true));
$('#start-over').addEventListener('click',()=>location.reload());

const guide=$('#guide-dialog');
$$('[data-open-guide]').forEach(btn=>btn.addEventListener('click',()=>guide.showModal()));
$('#close-guide').addEventListener('click',()=>guide.close());
guide.addEventListener('click',e=>{if(e.target===guide)guide.close();});

function toast(message) { const el=$('#toast');$('span',el).textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200); }
function escapeHtml(value='') { return value.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

// Presentamos la guía la primera vez. Solo se guarda esta preferencia, nunca imágenes.
if (!localStorage.getItem('dni-seguro-guide-seen')) {
  setTimeout(() => { guide.showModal(); localStorage.setItem('dni-seguro-guide-seen','1'); }, 650);
}

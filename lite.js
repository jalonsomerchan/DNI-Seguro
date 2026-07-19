const $ = selector => document.querySelector(selector);

const lite = {
  step: 1,
  documents: [],
  active: -1,
  brush: .07,
  drawing: null,
  watermark: { enabled: false, text: 'COPIA PARA TRÁMITE', opacity: .24, size: 1, layout: 'repeat', color: '#b42318' },
  format: 'jpeg'
};

const view = $('#lite-view');
const home = $('#upload-view');
const canvas = $('#lite-canvas');
const ctx = canvas.getContext('2d');
const fileInput = $('#lite-file-input');
const cameraInput = $('#lite-camera-input');

$('#open-lite').addEventListener('click', () => {
  home.classList.add('hidden');
  view.classList.remove('hidden');
  goLiteStep(lite.documents.length ? 2 : 1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#lite-back').addEventListener('click', () => {
  view.classList.add('hidden');
  home.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function openFilePicker() { fileInput.click(); }
function openCameraPicker() { document.dispatchEvent(new CustomEvent('lite:open-camera')); }

$('#lite-add-file').addEventListener('click', openFilePicker);
$('#lite-empty-file').addEventListener('click', openFilePicker);
$('#lite-panel-file').addEventListener('click', openFilePicker);
$('#lite-add-camera').addEventListener('click', openCameraPicker);
$('#lite-empty-camera').addEventListener('click', openCameraPicker);
$('#lite-panel-camera').addEventListener('click', openCameraPicker);

fileInput.addEventListener('change', async event => {
  await addFiles([...event.target.files]);
  event.target.value = '';
});

cameraInput.addEventListener('change', async event => {
  await addFiles([...event.target.files]);
  event.target.value = '';
});

document.addEventListener('lite:camera-captured', async event => {
  if (event.detail?.file) await addFiles([event.detail.file]);
});

document.addEventListener('lite:camera-fallback', () => cameraInput.click());

async function addFiles(files) {
  const images = files.filter(file => file.type.startsWith('image/'));
  if (!images.length) return notify('Elige una imagen JPG, PNG o WEBP.');
  for (const file of images) {
    if (file.size > 15 * 1024 * 1024) {
      notify(`${file.name} supera el límite de 15 MB.`);
      continue;
    }
    try {
      const image = await loadImage(file);
      lite.documents.push({ image, name: file.name.replace(/\.[^.]+$/, '') || 'documento', strokes: [] });
      lite.active = lite.documents.length - 1;
    } catch {
      notify(`No se ha podido leer ${file.name}.`);
    }
  }
  if (lite.documents.length) goLiteStep(2);
  else updateInterface();
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen no válida')); };
    image.src = url;
  });
}

function updateInterface() {
  renderTabs();
  const hasDocument = lite.active >= 0;
  view.querySelector('.lite-add-actions').classList.toggle('hidden', !hasDocument);
  $('#lite-empty').classList.toggle('hidden', hasDocument || lite.step !== 1);
  canvas.classList.toggle('hidden', !hasDocument);
  $('#lite-touch-hint').classList.toggle('hidden', !hasDocument || lite.step !== 2);
  $('#lite-result-label').classList.toggle('hidden', lite.step !== 4);
  canvas.style.cursor = lite.step === 2 ? 'crosshair' : 'default';
  updateEditButtons();
  render();
}

function renderTabs() {
  const tabs = $('#lite-tabs');
  tabs.innerHTML = lite.documents.map((document, index) =>
    `<button type="button" class="${index === lite.active ? 'active' : ''}" data-lite-document="${index}" aria-label="Abrir documento ${index + 1}"><span>DOC</span> ${index + 1}</button>`
  ).join('');
  tabs.querySelectorAll('[data-lite-document]').forEach(button => button.addEventListener('click', () => {
    lite.active = Number(button.dataset.liteDocument);
    if (lite.step === 4) goLiteStep(2);
    else updateInterface();
  }));
}

const LITE_STEP_LABELS = {
  1: 'Paso 1 de 4 · Documento',
  2: 'Paso 2 de 4 · Censura',
  3: 'Paso 3 de 4 · Marca de agua',
  4: 'Paso 4 de 4 · Resultado'
};

function goLiteStep(step) {
  if (step > 1 && !lite.documents.length) return notify('Añade primero un documento.');
  lite.drawing = null;
  lite.step = Math.max(1, Math.min(4, step));
  document.querySelectorAll('[data-lite-panel]').forEach(panel => panel.classList.toggle('active', Number(panel.dataset.litePanel) === lite.step));
  document.querySelectorAll('[data-lite-step]').forEach(button => {
    const number = Number(button.dataset.liteStep);
    button.classList.toggle('active', number === lite.step);
    button.classList.toggle('done', number < lite.step);
  });
  $('#lite-current-step').textContent = LITE_STEP_LABELS[lite.step];
  if (lite.step === 4) updateResultSummary();
  updateInterface();
  if (window.innerWidth < 901) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.querySelectorAll('[data-lite-next]').forEach(button => button.addEventListener('click', () => goLiteStep(Number(button.dataset.liteNext))));
document.querySelectorAll('[data-lite-prev]').forEach(button => button.addEventListener('click', () => goLiteStep(Number(button.dataset.litePrev))));
document.querySelectorAll('[data-lite-step]').forEach(button => button.addEventListener('click', () => {
  const step = Number(button.dataset.liteStep);
  if (step === 1 || lite.documents.length) goLiteStep(step);
}));
function activeDocument() { return lite.documents[lite.active]; }

function fitPreview(image) {
  const maximum = 1800;
  const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
}

function render() {
  if (lite.step === 4 && lite.documents.length) {
    const result = makeResultCanvas();
    canvas.width = result.width;
    canvas.height = result.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(result, 0, 0);
    return;
  }
  const document = activeDocument();
  if (!document) return;
  fitPreview(document.image);
  renderDocument(document, canvas, ctx, canvas.width, lite.step === 2, lite.step >= 3);
}

function renderDocument(document, target, targetCtx, width, includeDraft = false, includeWatermark = true) {
  const height = Math.round(width * document.image.naturalHeight / document.image.naturalWidth);
  target.width = width;
  target.height = height;
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.drawImage(document.image, 0, 0, width, height);
  const strokes = includeDraft && lite.drawing ? [...document.strokes, lite.drawing] : document.strokes;
  drawBlurredStrokes(document.image, strokes, targetCtx, width, height);
  if (includeWatermark && lite.watermark.enabled && lite.watermark.text.trim()) drawLiteWatermark(targetCtx, width, height);
}

function drawBlurredStrokes(image, strokes, targetCtx, width, height) {
  if (!strokes.length) return;
  // Evita depender de CanvasRenderingContext2D.filter, que falla en algunos
  // navegadores móviles. El mosaico se genera y exporta de forma consistente.
  const pixelSize = Math.max(20, Math.round(Math.min(width, height) * .04));
  const mosaic = document.createElement('canvas');
  mosaic.width = Math.max(1, Math.ceil(width / pixelSize));
  mosaic.height = Math.max(1, Math.ceil(height / pixelSize));
  const mosaicCtx = mosaic.getContext('2d');
  mosaicCtx.imageSmoothingEnabled = true;
  mosaicCtx.drawImage(image, 0, 0, mosaic.width, mosaic.height);
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const layerCtx = layer.getContext('2d');
  layerCtx.imageSmoothingEnabled = false;
  layerCtx.drawImage(mosaic, 0, 0, width, height);
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.strokeStyle = '#fff';
  layerCtx.fillStyle = '#fff';
  layerCtx.lineCap = 'round';
  layerCtx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    const lineWidth = Math.max(8, stroke.size * Math.min(width, height));
    layerCtx.lineWidth = lineWidth;
    layerCtx.beginPath();
    layerCtx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (let index = 1; index < stroke.points.length; index++) {
      layerCtx.lineTo(stroke.points[index].x * width, stroke.points[index].y * height);
    }
    if (stroke.points.length === 1) {
      layerCtx.arc(stroke.points[0].x * width, stroke.points[0].y * height, lineWidth / 2, 0, Math.PI * 2);
      layerCtx.fill();
    } else layerCtx.stroke();
  }
  layerCtx.globalCompositeOperation = 'source-over';
  targetCtx.drawImage(layer, 0, 0);
}

function drawLiteWatermark(targetCtx, width, height) {
  const text = lite.watermark.text.trim().toUpperCase();
  const fontSize = Math.max(18, width * .038 * lite.watermark.size);
  targetCtx.save();
  targetCtx.font = `800 ${fontSize}px Manrope, sans-serif`;
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillStyle = hexToRgba(lite.watermark.color, lite.watermark.opacity);
  if (lite.watermark.layout === 'repeat') {
    targetCtx.translate(width / 2, height / 2);
    targetCtx.rotate(-Math.PI / 7);
    const stepX = Math.max(width * .48, targetCtx.measureText(text).width + fontSize * 2);
    const stepY = fontSize * 3.8;
    for (let y = -height; y <= height; y += stepY) {
      for (let x = -width; x <= width; x += stepX) targetCtx.fillText(text, x, y);
    }
  } else if (lite.watermark.layout === 'center') {
    targetCtx.font = `800 ${fontSize * 1.6}px Manrope, sans-serif`;
    targetCtx.fillText(text, width / 2, height / 2);
  } else if (lite.watermark.layout === 'diagonal') {
    targetCtx.translate(width / 2, height / 2);
    targetCtx.rotate(-Math.PI / 7);
    targetCtx.font = `800 ${fontSize * 1.45}px Manrope, sans-serif`;
    targetCtx.fillText(text, 0, 0);
  } else {
    targetCtx.font = `800 ${fontSize * .82}px Manrope, sans-serif`;
    targetCtx.fillText(text, width / 2, height - fontSize * 1.1);
  }
  targetCtx.restore();
}

function hexToRgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  };
}

canvas.addEventListener('pointerdown', event => {
  if (!activeDocument() || lite.step !== 2) return;
  event.preventDefault();
  lite.drawing = { size: lite.brush, points: [canvasPoint(event)] };
  canvas.setPointerCapture(event.pointerId);
  render();
});

canvas.addEventListener('pointermove', event => {
  if (!lite.drawing) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const previous = lite.drawing.points.at(-1);
  if (Math.hypot(point.x - previous.x, point.y - previous.y) > .003) lite.drawing.points.push(point);
  render();
});

function finishStroke(event) {
  if (!lite.drawing || !activeDocument()) return;
  if (event) event.preventDefault();
  activeDocument().strokes.push(lite.drawing);
  lite.drawing = null;
  updateEditButtons();
  render();
}

canvas.addEventListener('pointerup', finishStroke);
canvas.addEventListener('pointercancel', finishStroke);

$('#lite-brush-size').addEventListener('input', event => {
  const value = Number(event.target.value);
  lite.brush = .025 + value * .0065;
  $('#lite-brush-label').textContent = value <= 5 ? 'Fino' : value <= 9 ? 'Medio' : 'Grueso';
});

function updateEditButtons() {
  const hasStrokes = Boolean(activeDocument()?.strokes.length);
  $('#lite-undo').disabled = !hasStrokes;
  $('#lite-clear').disabled = !hasStrokes;
}

$('#lite-undo').addEventListener('click', () => {
  activeDocument()?.strokes.pop();
  updateEditButtons();
  render();
});

$('#lite-clear').addEventListener('click', () => {
  if (!activeDocument()) return;
  activeDocument().strokes = [];
  updateEditButtons();
  render();
});

$('#lite-watermark-enabled').addEventListener('change', event => {
  lite.watermark.enabled = event.target.checked;
  $('#lite-watermark-controls').classList.toggle('hidden', !event.target.checked);
  render();
});

$('#lite-watermark-text').addEventListener('input', event => {
  lite.watermark.text = event.target.value;
  render();
});

$('#lite-watermark-opacity').addEventListener('input', event => {
  lite.watermark.opacity = Number(event.target.value) / 100;
  $('#lite-opacity-label').textContent = `${event.target.value}%`;
  render();
});

$('#lite-watermark-size').addEventListener('input', event => {
  lite.watermark.size = Number(event.target.value) / 100;
  $('#lite-size-label').textContent = `${event.target.value}%`;
  render();
});

document.querySelectorAll('[data-lite-watermark]').forEach(button => button.addEventListener('click', () => {
  lite.watermark.layout = button.dataset.liteWatermark;
  document.querySelectorAll('[data-lite-watermark]').forEach(item => item.classList.toggle('active', item === button));
  render();
}));

document.querySelectorAll('[data-lite-color]').forEach(button => button.addEventListener('click', () => {
  lite.watermark.color = button.dataset.liteColor;
  document.querySelectorAll('[data-lite-color]').forEach(item => item.classList.toggle('active', item === button));
  render();
}));

document.querySelectorAll('[data-lite-format]').forEach(button => button.addEventListener('click', () => {
  lite.format = button.dataset.liteFormat;
  document.querySelectorAll('[data-lite-format]').forEach(item => item.classList.toggle('active', item === button));
}));

function updateResultSummary() {
  const strokes = lite.documents.reduce((total, item) => total + item.strokes.length, 0);
  $('#lite-result-summary').innerHTML = `<div><span>Documentos</span><b>${lite.documents.length}</b></div><div><span>Zonas censuradas</span><b>${strokes}</b></div><div><span>Marca de agua</span><b>${lite.watermark.enabled ? 'Aplicada' : 'Sin marca'}</b></div>`;
}

function makeResultCanvas() {
  const maximumWidth = Math.min(1800, Math.max(...lite.documents.map(item => item.image.naturalWidth)));
  const heights = lite.documents.map(item => Math.round(maximumWidth * item.image.naturalHeight / item.image.naturalWidth));
  const result = document.createElement('canvas');
  result.width = maximumWidth;
  result.height = heights.reduce((total, height) => total + height, 0);
  const resultCtx = result.getContext('2d');
  resultCtx.fillStyle = '#fff';
  resultCtx.fillRect(0, 0, result.width, result.height);
  let offsetY = 0;
  lite.documents.forEach((item, index) => {
    const page = document.createElement('canvas');
    renderDocument(item, page, page.getContext('2d'), maximumWidth, false, true);
    resultCtx.drawImage(page, 0, offsetY);
    offsetY += heights[index];
  });
  return result;
}

$('#lite-download').addEventListener('click', () => {
  if (!lite.documents.length) return;
  const button = $('#lite-download');
  button.disabled = true;
  button.textContent = 'Preparando…';
  try {
    const mime = lite.format === 'png' ? 'image/png' : 'image/jpeg';
    const extension = lite.format === 'png' ? 'png' : 'jpg';
    makeResultCanvas().toBlob(blob => {
      if (!blob) {
        notify('No se ha podido generar el resultado.');
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = lite.documents.length === 1 ? `${lite.documents[0].name}-lite.${extension}` : `documentos-protegidos-lite.${extension}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1500);
        notify('Resultado descargado en tu dispositivo.');
      }
      button.innerHTML = '<svg viewBox="0 0 20 20"><path d="M10 3v10m0 0 3.5-3.5M10 13 6.5 9.5M4 16.5h12"/></svg>Descargar resultado';
      button.disabled = false;
    }, mime, .94);
  } catch {
    button.innerHTML = '<svg viewBox="0 0 20 20"><path d="M10 3v10m0 0 3.5-3.5M10 13 6.5 9.5M4 16.5h12"/></svg>Descargar resultado';
    button.disabled = false;
    notify('No se ha podido generar el resultado.');
  }
});

function notify(message) {
  const toast = $('#toast');
  toast.querySelector('span').textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

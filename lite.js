const $ = selector => document.querySelector(selector);

const lite = {
  documents: [],
  active: -1,
  brush: .07,
  drawing: null,
  watermark: { enabled: false, text: 'COPIA PARA TRÁMITE', opacity: .24 }
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#lite-back').addEventListener('click', () => {
  view.classList.add('hidden');
  home.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function openFilePicker() { fileInput.click(); }
function openCameraPicker() { cameraInput.click(); }

$('#lite-add-file').addEventListener('click', openFilePicker);
$('#lite-empty-file').addEventListener('click', openFilePicker);
$('#lite-add-camera').addEventListener('click', openCameraPicker);
$('#lite-empty-camera').addEventListener('click', openCameraPicker);

fileInput.addEventListener('change', async event => {
  await addFiles([...event.target.files]);
  event.target.value = '';
});

cameraInput.addEventListener('change', async event => {
  await addFiles([...event.target.files]);
  event.target.value = '';
});

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
  updateInterface();
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
  $('#lite-empty').classList.toggle('hidden', hasDocument);
  canvas.classList.toggle('hidden', !hasDocument);
  $('#lite-touch-hint').classList.toggle('hidden', !hasDocument);
  $('#lite-download').disabled = !lite.documents.length;
  $('#lite-count').textContent = lite.documents.length
    ? `${lite.documents.length} ${lite.documents.length === 1 ? 'documento añadido' : 'documentos añadidos'} · se descargarán juntos`
    : 'Aún no has añadido documentos';
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
    updateInterface();
  }));
}

function activeDocument() { return lite.documents[lite.active]; }

function fitPreview(image) {
  const maximum = 1800;
  const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
}

function render() {
  const document = activeDocument();
  if (!document) return;
  fitPreview(document.image);
  renderDocument(document, canvas, ctx, canvas.width, true);
}

function renderDocument(document, target, targetCtx, width, includeDraft = false) {
  const height = Math.round(width * document.image.naturalHeight / document.image.naturalWidth);
  target.width = width;
  target.height = height;
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.drawImage(document.image, 0, 0, width, height);
  const strokes = includeDraft && lite.drawing ? [...document.strokes, lite.drawing] : document.strokes;
  drawBlurredStrokes(document.image, strokes, targetCtx, width, height);
  if (lite.watermark.enabled && lite.watermark.text.trim()) drawLiteWatermark(targetCtx, width, height);
}

function drawBlurredStrokes(image, strokes, targetCtx, width, height) {
  if (!strokes.length) return;
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const layerCtx = layer.getContext('2d');
  layerCtx.filter = `blur(${Math.max(12, Math.round(Math.min(width, height) * .025))}px)`;
  layerCtx.drawImage(image, 0, 0, width, height);
  layerCtx.filter = 'none';
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
  const fontSize = Math.max(18, width * .038);
  targetCtx.save();
  targetCtx.translate(width / 2, height / 2);
  targetCtx.rotate(-Math.PI / 7);
  targetCtx.font = `800 ${fontSize}px Manrope, sans-serif`;
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillStyle = `rgba(180,35,24,${lite.watermark.opacity})`;
  const stepX = Math.max(width * .48, targetCtx.measureText(text).width + fontSize * 2);
  const stepY = fontSize * 3.8;
  for (let y = -height; y <= height; y += stepY) {
    for (let x = -width; x <= width; x += stepX) targetCtx.fillText(text, x, y);
  }
  targetCtx.restore();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  };
}

canvas.addEventListener('pointerdown', event => {
  if (!activeDocument()) return;
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
    renderDocument(item, page, page.getContext('2d'), maximumWidth);
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
    makeResultCanvas().toBlob(blob => {
      if (!blob) {
        notify('No se ha podido generar el resultado.');
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = lite.documents.length === 1 ? `${lite.documents[0].name}-lite.jpg` : 'documentos-protegidos-lite.jpg';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1500);
        notify('Resultado descargado en tu dispositivo.');
      }
      button.innerHTML = '<svg viewBox="0 0 20 20"><path d="M10 3v10m0 0 3.5-3.5M10 13 6.5 9.5M4 16.5h12"/></svg>Descargar resultado';
      button.disabled = false;
    }, 'image/jpeg', .94);
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


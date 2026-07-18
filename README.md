# DNI Seguro

Aplicación web para censurar uno o varios DNI españoles (3.0 o posteriores), añadir una marca de agua y generar una copia protegida.

Incluye dos modos:

- **Completo:** analiza el documento localmente con OCR, propone campos y permite ajustar las zonas.
- **Lite:** abre la cámara o una imagen sin análisis, permite difuminar datos pintando con el dedo o el ratón, añadir una marca de agua opcional, combinar varios documentos y descargar una única imagen.

## Privacidad

- No existe backend ni se suben imágenes a servidores.
- La imagen se mantiene en memoria y se pierde al cerrar o recargar la pestaña.
- La captura integrada usa `navigator.mediaDevices.getUserMedia`; el flujo de vídeo no sale del navegador y se detiene al capturar o cerrar el visor.
- El marco de cámara mantiene la proporción física del DNI (1,586:1) y sus coordenadas se transforman a píxeles del vídeo para recortar exactamente la zona visible.
- El OCR se ejecuta en el navegador mediante Tesseract.js.
- El recorte automático combina las cajas del OCR con los bordes visibles de la fotografía para eliminar el fondo sin usar una plantilla de coordenadas.
- La orientación se corrige automáticamente para documentos girados 90°, 180° o 270°; las rotaciones adicionales solo se prueban cuando la primera lectura no es coherente.
- Se realizan lecturas OCR complementarias y, en el reverso moderno, una lectura específica de la franja vertical de “Equipo”. La binarización adaptativa solo se usa cuando faltan campos.
- Las posiciones no proceden de una plantilla: se calculan con las cajas de texto devueltas por el OCR.
- Las etiquetas se relacionan con sus valores por proximidad, líneas de texto y contenido MRZ.
- En imágenes que contienen las dos caras se realiza una segunda pasada sobre cada región detectada.
- La primera carga descarga el motor y el modelo OCR desde un CDN; la imagen nunca se envía a ese CDN.
- La previsualización y la exportación se generan con Canvas en el propio dispositivo.

## Ejecutar

Al usar módulos ES, debe abrirse desde un servidor estático local:

```bash
python3 -m http.server 8080
```

Después abre `http://localhost:8080`.

No hay proceso de compilación ni dependencias que instalar.

## Uso

1. Sube una imagen o abre la cámara integrada. Encaja el DNI completo en el marco y pulsa el disparador; puedes cambiar entre cámaras cuando el dispositivo ofrece más de una.
   En las imágenes subidas, el recorte busca los cuatro bordes, comprueba que contienen las etiquetas detectadas por OCR y añade un margen de seguridad para no cortar el documento.
2. Confirma si es anverso o reverso.
3. Revisa todos los campos esperables: los localizados incluyen su valor y confianza; los no localizados se indican expresamente.
   En el anverso se censura inicialmente todo salvo nombre, apellidos, fecha de nacimiento y número de DNI. En el reverso se censura todo salvo el código MRZ.
4. Selecciona los que quieras ocultar y usa “Mover y redimensionar zonas” si alguna caja necesita una corrección.
   También puedes pulsar el icono “Mover” de un campo y arrastrar directamente su censura; la esquina inferior derecha permite redimensionarla.
5. Activa “Censurar manualmente” y elige Rectángulo o Pincel. Puedes pintar con el dedo o el ratón, ajustar el grosor, deshacer y eliminar zonas individuales o todas las manuales.
6. Añade más caras o documentos desde la barra superior o desde la pantalla final. La exportación los coloca en una sola imagen vertical.
7. Configura una marca de agua repetida, central, diagonal o al pie, incluyendo su tamaño e intensidad.
8. Descarga el resultado como JPG/PNG, compártelo mediante el menú del sistema o usa “Guardar en Fotos” en iPhone.

> Antes de compartir, revisa visualmente que todos los datos sensibles estén ocultos. Cuando una zona no pueda situarse con suficiente seguridad, utiliza el modo manual antes de exportar.

### Versión Lite

1. Pulsa “Usar versión Lite” en la portada.
2. Haz una foto o elige una imagen.
3. Pinta con el dedo o el ratón sobre cualquier dato que quieras difuminar; puedes cambiar el grosor, deshacer o limpiar los trazos.
4. Activa, si quieres, una marca de agua y personaliza el texto y la intensidad.
5. Añade más documentos y descarga el resultado. Todas las imágenes se unen verticalmente en un único JPG.

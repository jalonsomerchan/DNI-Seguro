# DNI Seguro

Aplicación web para censurar uno o varios DNI españoles (3.0 o posteriores), añadir una marca de agua y generar una copia protegida.

Incluye dos modos:

- **Versión con OCR:** analiza el documento localmente, propone campos y permite ajustar las zonas.
- **Versión Simple (Lite):** abre la cámara con un marco para encuadrar y recortar el documento, o permite elegir una imagen sin análisis; después permite censurar datos pintando con el dedo o el ratón, añadir una marca de agua opcional, combinar varios documentos y descargar una única imagen.

## Privacidad

- No existe backend ni se suben imágenes a servidores.
- La imagen se mantiene en memoria y se pierde al cerrar o recargar la pestaña.
- La captura integrada usa `navigator.mediaDevices.getUserMedia`; el flujo de vídeo no sale del navegador y se detiene al capturar o cerrar el visor.
- El marco de cámara mantiene la proporción física del DNI (1,586:1) y sus coordenadas se transforman a píxeles del vídeo para recortar exactamente la zona visible.
- El OCR se ejecuta en el navegador mediante Tesseract.js.
- El lector y el modelo se mantienen preparados mientras la pestaña está abierta, por lo que analizar una segunda cara o documento evita repetir la inicialización.
- El recorte automático combina las cajas del OCR con los bordes visibles de la fotografía para eliminar el fondo sin usar una plantilla de coordenadas.
- La orientación se corrige automáticamente para documentos girados 90°, 180° o 270°; las rotaciones adicionales solo se prueban cuando la primera lectura no es coherente.
- La primera lectura usa escala y contraste equilibrados. Las lecturas de mayor coste, la binarización adaptativa y las regiones específicas del reverso solo se ejecutan cuando faltan campos o la confianza es baja.
- Las posiciones no proceden de una plantilla: se calculan con las cajas de texto devueltas por el OCR.
- Las etiquetas se relacionan con sus valores por proximidad, líneas de texto y contenido MRZ; la búsqueda tolera palabras unidas y confusiones visuales habituales del OCR.
- El número de DNI se valida con su letra de control y los formatos de número de soporte y fecha se normalizan antes de seleccionar la mejor caja.
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

La aplicación incluye un manifiesto PWA y un service worker. Al visitarla desde HTTPS se puede instalar y la Versión Simple queda disponible sin conexión. El modo OCR descarga su motor y datos de idioma la primera vez y los reutiliza desde la caché en los usos posteriores.

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

### Versión Simple (Lite)

1. Pulsa “Usar Versión Simple” en la portada.
2. Haz una foto encajando el documento dentro del marco de cámara, o elige una imagen.
3. Pinta con el dedo o el ratón sobre cualquier dato que quieras emborronar; puedes cambiar el grosor, deshacer o limpiar los trazos.
4. Activa, si quieres, una marca de agua y personaliza texto, distribución, color, tamaño e intensidad.
5. Añade otro documento —que volverá al paso de censura— o pulsa “Finalizar”.
6. Revisa la composición final y descárgala como JPG o PNG. Todas las imágenes se unen verticalmente.

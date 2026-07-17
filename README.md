# DNI Seguro

Aplicación web para censurar datos de un DNI español (3.0 o posterior), añadir una marca de agua y descargar una copia protegida.

## Privacidad

- No existe backend ni se suben imágenes a servidores.
- La imagen se mantiene en memoria y se pierde al cerrar o recargar la pestaña.
- El OCR se ejecuta en el navegador mediante Tesseract.js.
- El recorte automático combina las cajas del OCR con los bordes visibles de la fotografía para eliminar el fondo sin usar una plantilla de coordenadas.
- Se realizan tres lecturas OCR complementarias, incluida una binarización adaptativa, para recuperar etiquetas pequeñas o afectadas por hologramas y reflejos.
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

1. Sube una imagen o usa la cámara trasera del móvil.
2. Confirma si es anverso o reverso.
3. Revisa todos los campos esperables: los localizados incluyen su valor y confianza; los no localizados se indican expresamente.
4. Selecciona los que quieras ocultar y usa “Ajustar posiciones” si alguna caja necesita una corrección.
5. También puedes añadir cualquier zona manual que no se haya localizado correctamente.
6. Configura una marca de agua repetida, central, diagonal o al pie.
7. Comprueba el resultado y descárgalo como JPG o PNG.

> Antes de compartir, revisa visualmente que todos los datos sensibles estén ocultos. Si un texto no existe en la salida OCR por desenfoque, reflejos o resolución insuficiente, la aplicación no inventa su posición: utiliza “Añadir zona manual”.

// The page's texts in English (the source, written in index.html and app.js) and Spanish. The output files
// stay in English, byte for byte as the notebook writes them; only what the page shows is translated.
const norm = (s) => s.replace(/\s+/g, ' ').trim();
let lang = (() => {
  try { const saved = localStorage.getItem('apus.lang'); if (saved) return saved; } catch { /* storage blocked */ }
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
})();
export const getLang = () => lang;

export function setLang(next) {
  lang = next === 'es' ? 'es' : 'en';
  try { localStorage.setItem('apus.lang', lang); } catch { /* storage blocked */ }
  applyLang();
}

export function t(key, vars) {
  let s = (lang === 'es' && ES[key]) || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
export const tn = (n, one, other, vars) => t(n === 1 ? one : other, { n: num(n), ...vars });

export function num(x, digits) {
  const opts = digits == null ? { maximumFractionDigits: 3 } : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return Number(x).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', opts);
}

// Static texts: the English is kept on the element the first time, so the page can switch back and forth
export function applyLang(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.dataset.en ??= norm(el.textContent);
    el.textContent = t(el.dataset.en);
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.dataset.enHtml ??= norm(el.innerHTML);
    el.innerHTML = t(el.dataset.enHtml);                     // trusted: our own strings
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const name of el.dataset.i18nAttr.split(' ')) {
      const key = `en_${name.replace(/-/g, '_')}`;
      el.dataset[key] ??= el.getAttribute(name);
      el.setAttribute(name, t(el.dataset[key]));
    }
  }
}

// Messages written by Python and the worker (the notebook's own words), matched by pattern
const PY = [
  [/^Perch 2\.0 — (\d+) recording\(s\) in (\d+) dataset\(s\): (\d+) windows of ([\d.]+) s every ([\d.]+) s\.$/,
   (m) => `Perch 2.0: ${m[1]} grabación(es) en ${m[2]} conjunto(s) de datos, ${m[3]} ventanas de ${dec(m[4])} s cada ${dec(m[5])} s.`],
  [/^Threshold ([\d.]+): (\d+) detection\(s\) of (\d+) species in (\d+) recording\(s\)\.$/,
   (m) => `Umbral ${dec(m[1])}: ${m[2]} detección(es) de ${m[3]} especie(s) en ${m[4]} grabación(es).`],
  [/^Species list: removed (\d+) detection\(s\) of (\d+) species; (\d+) recording\(s\) had no list\.$/,
   (m) => `Lista de especies: se quitaron ${m[1]} detección(es) de ${m[2]} especie(s). ${m[3]} grabación(es) no tenían lista.`],
  [/^(\d+) recording\(s\) in (\d+) dataset\(s\)$/, (m) => `${m[1]} grabación(es) en ${m[2]} conjunto(s) de datos`],
  [/^(\d+) recording\(s\) already analysed, (\d+) to go\.$/, (m) => `${m[1]} grabación(es) ya analizadas, faltan ${m[2]}.`],
  [/^No species list: all of Perch's classes are kept\.$/, () => 'Sin lista de especies: se conservan todas las clases de Perch.'],
  [/^Species lists: (\d+) file\(s\); (\d+) of (\d+) recording\(s\) will be filtered\.$/,
   (m) => `Listas de especies: ${m[1]} archivo(s). Se filtrarán ${m[2]} de ${m[3]} grabación(es).`],
  [/^\s*(\d+) recording\(s\) have no list and will NOT be filtered\.$/, (m) => `${m[1]} grabación(es) no tienen lista y NO se filtrarán.`],
  [/^\s*⚠ (\d+) list file\(s\) match no recording or dataset, e\.g\. (.+)$/, (m) => `⚠ ${m[1]} lista(s) no coinciden con ninguna grabación ni conjunto de datos, p. ej. ${m[2]}`],
  [/^\s*(\d+) listed name\(s\) match no Perch class \(add them to the synonyms file if they are birds\): (.+)$/,
   (m) => `${m[1]} nombre(s) de las listas no coinciden con ninguna clase de Perch (añádelos al archivo de sinónimos si son aves): ${m[2]}`],
  [/^⚠ (\d+) empty file\(s\) skipped, e\.g\. (.+)$/, (m) => `⚠ Se omiten ${m[1]} archivo(s) vacíos, p. ej. ${m[2]}`],
  [/^⚠ (\d+) file\(s\) point to audio that is not there and are skipped, e\.g\. (.+)$/, (m) => `⚠ Se omiten ${m[1]} archivo(s) que apuntan a audio inexistente, p. ej. ${m[2]}`],
  [/^Synonyms file: (\d+) name\(s\) from (.+)$/, (m) => `Archivo de sinónimos: ${m[1]} nombre(s) de ${m[2]}`],
  [/^⚠ Synonyms file: '(.+)' is not a Perch class — row ignored$/, (m) => `⚠ Archivo de sinónimos: «${m[1]}» no es una clase de Perch; se ignora la fila`],
  [/^(\d+) clip\(s\) of (\d+) species$/, (m) => `${m[1]} fragmento(s) de ${m[2]} especie(s)`],
  [/^⚠ Clip species: '(.+)' is not a Perch class$/, (m) => `⚠ Especies de los fragmentos: «${m[1]}» no es una clase de Perch`],
  [/^⚠ Not analysed: (.+) \((.*)\)$/, (m) => `⚠ No analizada: ${m[1]} (${m[2]})`],
  [/^Timing: (\d+) windows in ([\d.]+) s: preparing audio ([\d.]+) s, model ([\d.]+) s\.$/,
   (m) => `Tiempos: ${m[1]} ventanas en ${dec(m[2])} s. Preparar el audio: ${dec(m[3])} s; modelo: ${dec(m[4])} s.`],
  [/^Cutting audio clips: (\d+)$/, (m) => `Cortando fragmentos de audio: ${m[1]}`],
  [/^CPU \((\d+) threads?\)$/, (m) => `CPU (${m[1]} ${m[1] === '1' ? 'hilo' : 'hilos'})`],
  [/^The threshold must be between 0 and 1\.$/, () => 'El umbral debe estar entre 0 y 1.'],
  [/^The hop must be above 0 s\.$/, () => 'El salto debe ser mayor que 0 s.'],
  [/^A threshold of ([\d.]+) needs at least (\d+) species kept per window\.$/, (m) => `Un umbral de ${dec(m[1])} necesita conservar al menos ${m[2]} especies por ventana.`],
  [/^The CSV separator must be "," or ";"\.$/, () => 'El separador CSV debe ser «,» o «;».'],
  [/^Folder not found: (.+)$/, (m) => `No se encuentra la carpeta: ${m[1]}`],
  [/^No audio files in (.+)$/, (m) => `No hay archivos de audio en ${m[1]}`],
  [/^This output folder holds results made with other settings\..*$/,
   () => 'Esta carpeta de salida contiene resultados hechos con otros ajustes. Desactiva «Continuar un análisis detenido» para empezar de nuevo, o elige otra carpeta de salida.'],
  [/^Species list not found: (.+)$/, (m) => `No se encuentra la lista de especies: ${m[1]}`],
  [/^No recording could be analysed\.$/, () => 'No se pudo analizar ninguna grabación.'],
  [/^No recording has both a reference file and Perch results\..*$/,
   () => 'Ninguna grabación tiene a la vez un archivo de referencia y resultados de Perch. Revisa la carpeta de referencia y los nombres: cada nombre debe empezar por el de su grabación.'],
  [/^(.+): not found: (.+)$/, (m) => `${m[1]}: no se encuentra ${m[2]}`],
  [/^Could not download (.+) \(HTTP (\d+)\)\.$/, (m) => `No se pudo descargar ${m[1]} (HTTP ${m[2]}).`],
  [/^(.+) is not the expected file\. Reload the page to download it again\.$/, (m) => `${m[1]} no es el archivo esperado. Recarga la página para descargarlo de nuevo.`],
  [/^The model gives unexpected results in this browser \(by up to (.+)\)\.$/, (m) => `El modelo da resultados inesperados en este navegador (diferencias de hasta ${m[1]}).`],
  [/^The graphics card's results differ from the expected ones \(by up to (.+)\), so the CPU is used\.$/, (m) => `Los resultados de la tarjeta gráfica difieren de los esperados (hasta ${m[1]}), así que se usa la CPU.`],
  [/^The graphics card could not run the model \((.*)\), so the CPU is used\.$/, (m) => `La tarjeta gráfica no pudo ejecutar el modelo (${m[1]}), así que se usa la CPU.`],
  [/^This page is not cross-origin isolated, so the CPU uses one thread \(slower\)\.$/, () => 'Esta página no está aislada (cross-origin isolated), así que la CPU usa un solo hilo (más lento).'],
  [/^There are no results to work on yet\. Analyse some recordings first\.$/, () => 'Todavía no hay resultados con los que trabajar. Analiza primero algunas grabaciones.'],
  [/^To listen, choose the same recordings again\.$/, () => 'Para escuchar, vuelve a elegir las mismas grabaciones.'],
  [/^Comparing needs the recordings: .*$/, () => 'Para comparar hacen falta las grabaciones: elígelas y pulsa Analizar. Las grabaciones ya analizadas se saltan.'],
  [/^predictions\.csv is not in the output, so the recording effort is unknown\.$/, () => 'predictions.csv no está en la salida, así que no se conoce el esfuerzo de grabación.'],
  [/^Reference: (\d+) event\(s\) in (\d+) recording\(s\) from (.+)$/, (m) => `Referencia: ${m[1]} evento(s) en ${m[2]} grabación(es) de ${m[3]}`],
  [/^(.+): (\d+) event\(s\) in (\d+) recording\(s\) from (.+)$/, (m) => `${m[1]}: ${m[2]} evento(s) en ${m[3]} grabación(es) de ${m[4]}`],
  [/^\s*skipped (\d+) file\(s\) without start\/end\/species columns, e\.g\. (.+)$/, (m) => `se omiten ${m[1]} archivo(s) sin columnas de inicio, fin y especie, p. ej. ${m[2]}`],
  [/^\s*⚠ (\d+) file\(s\) match no recording, e\.g\. (.+)$/, (m) => `⚠ ${m[1]} archivo(s) no coinciden con ninguna grabación, p. ej. ${m[2]}`],
  [/^\s*(\d+) reference recording\(s\) were not analysed by Perch and are left out\.$/, (m) => `${m[1]} grabación(es) de referencia no se analizaron con Perch y quedan fuera.`],
  [/^\s*(\d+) scored recording\(s\) have no (.+) file \(counted as no detections\)\.$/, (m) => `${m[1]} grabación(es) evaluadas no tienen archivo de ${m[2]} (cuentan como sin detecciones).`],
  [/^\s*(.+) confidences start at ([\d.]+) \(its own export threshold\)\.$/, (m) => `Las confianzas de ${m[1]} empiezan en ${dec(m[2])} (su propio umbral de exportación).`],
  [/^Scored: (\d+) recording\(s\) in (\d+) dataset\(s\), (\d+) reference event\(s\) of (\d+) species\.$/,
   (m) => `Evaluadas: ${m[1]} grabación(es) en ${m[2]} conjunto(s) de datos, ${m[3]} evento(s) de referencia de ${m[4]} especie(s).`],
  [/^(\d+) reference event\(s\) have a label that matches no Perch class \(see unmatched_labels\.csv\): (counted as missed|left out).*$/,
   (m) => `${m[1]} evento(s) de referencia tienen una etiqueta que no coincide con ninguna clase de Perch (ver unmatched_labels.csv): ${m[2] === 'left out' ? 'se dejan fuera.' : 'cuentan como no detectados.'}`],
  [/^At threshold ([\d.]+) \(best threshold and PR AUC over ([\d.]+)–0\.99\)\.$/, (m) => `Con umbral ${dec(m[1])} (mejor umbral y AUC PR entre ${dec(m[2])} y 0,99).`],
  [/^only (\d+) clip\(s\) \(MIN_CLIPS = (\d+)\)$/, (m) => `solo ${m[1]} revisada(s) (mínimo ${m[2]})`],
  [/^all clips are correct: no fit$/, () => 'todas son correctas: no se puede ajustar'],
  [/^all clips are incorrect: no fit$/, () => 'todas son incorrectas: no se puede ajustar'],
  [/^higher confidence is not more often correct \(slope ≤ 0\)$/, () => 'una confianza mayor no es más a menudo correcta (pendiente ≤ 0)'],
  [/^correct and incorrect clips do not overlap: .*$/, () => 'las correctas y las incorrectas no se solapan: el umbral solo marca el hueco entre ellas'],
  [/^threshold outside the confidences you checked \(extrapolated\)$/, () => 'umbral fuera de las confianzas revisadas (extrapolado)'],
  [/^the file is empty$/, () => 'el archivo está vacío'],
  [/^the file holds no audio$/, () => 'el archivo no contiene audio'],
  [/^⚠ (.+?): (.+)$/, (m) => `⚠ ${m[1]}: ${translatePy(m[2])}`],
];
// The notebook's setting names, which a few messages and output files contain, in plain words in English too
const EN = [
  [/^only (\d+) clip\(s\) \(MIN_CLIPS = (\d+)\)$/, (m) => `only ${m[1]} checked (fewest: ${m[2]})`],
  [/^(.+: counted as missed) \(COUNT_UNMATCHED_AS_MISSED = True\)\.$/, (m) => `${m[1]}.`],
];
const dec = (s) => (lang === 'es' ? String(s).replace('.', ',') : s);
export function translatePy(text) {
  if (!text) return text;
  if (lang !== 'es') return EN.reduce((out, [re, f]) => out.replace(re, (...m) => f(m)), text);
  if (text.includes('; ') && !/^Species list: /.test(text)) return text.split('; ').map(translatePy).join('; ');
  if (ES[text]) return ES[text];
  for (const [re, f] of PY) { const m = text.match(re); if (m) return f(m); }
  return text;
}

const ES = {
  'Apus · Perch 2.0 in your browser': 'Apus · Perch 2.0 en tu navegador',
  'Identify the species heard in your recordings': 'Identifica las especies que se oyen en tus grabaciones',
  'Recordings': 'Grabaciones',
  'Choose a folder': 'Elegir una carpeta',
  'Choose files': 'Elegir archivos',
  'WAV, FLAC and OGG files work.': 'Funcionan los archivos WAV, FLAC y OGG.',
  'Analyse': 'Analizar',
  'Change': 'Cambiar',
  'Analysing': 'Analizando',
  'Stop': 'Detener',
  'Results appear here': 'Aquí aparecerán los resultados',
  'After a run: the counts, the most detected species, and tables you can sort. The files (detections, summaries, Raven tables, clips) go to your folder or into a ZIP file.':
    'Tras un análisis: los recuentos, las especies más detectadas y tablas que puedes ordenar. Los archivos (detecciones, resúmenes, tablas de Raven, fragmentos) van a tu carpeta o a un archivo ZIP.',
  'Results': 'Resultados',
  'Summary': 'Resumen',
  'Check detections': 'Revisar detecciones',
  'Thresholds': 'Umbrales',
  'Compare': 'Comparar',
  'Activity': 'Actividad',
  'Methods': 'Métodos',
  'Most detected species': 'Especies más detectadas',
  'Species': 'Especies',
  'Datasets': 'Conjuntos de datos',
  'Messages': 'Mensajes',
  'Listen to detections and mark each one. For every species, Apus offers a random sample in each confidence band, so your checks cover weak and strong scores alike. They tell you how often a detection is right at each confidence, and the Thresholds tab uses them.':
    'Escucha las detecciones y marca cada una. Para cada especie, Apus ofrece una muestra al azar en cada franja de confianza, para que tus revisiones cubran por igual puntuaciones bajas y altas. Te dicen con qué frecuencia acierta una detección a cada confianza, y la pestaña Umbrales las usa.',
  'Find a species': 'Buscar una especie',
  'Pick a species to check its detections.': 'Elige una especie para revisar sus detecciones.',
  'Sets a confidence threshold for each species from the detections you checked, so that its detections are right as often as you ask.':
    'Fija un umbral de confianza para cada especie a partir de las detecciones que revisaste, para que sus detecciones acierten tan a menudo como pidas.',
  'Target chance of being correct': 'Probabilidad objetivo de acierto',
  'Fewest checked detections': 'Mínimo de detecciones revisadas',
  'Fit thresholds': 'Ajustar umbrales',
  "Detections marked unsure are left out. If you listened to the audio clips outside Apus, clips you moved into folders named correct and incorrect, inside each species' clip folder, count too. A threshold holds for recordings like the ones you checked: the same sites, season and recorders.":
    'Las detecciones marcadas como dudosas quedan fuera. Si escuchaste los fragmentos de audio fuera de Apus, también cuentan los que moviste a carpetas llamadas correct e incorrect dentro de la carpeta de fragmentos de cada especie. Un umbral vale para grabaciones como las que revisaste: los mismos sitios, estación y grabadoras.',
  'Measures how well the detections of Perch 2.0, the model Apus runs, match your own annotations: the share of detections that are right (precision), and the share of annotated sounds that were found (recall). It does this for single calls and for the species of each dataset (Funosas et al. 2026).':
    'Mide lo bien que las detecciones de Perch 2.0, el modelo que usa Apus, coinciden con tus propias anotaciones: la proporción de detecciones correctas (precisión) y la proporción de sonidos anotados que se encontraron (exhaustividad). Lo hace para vocalizaciones sueltas y para las especies de cada conjunto de datos (Funosas et al. 2026).',
  'Annotations': 'Anotaciones',
  'No folder chosen': 'Ninguna carpeta elegida',
  'A folder with one text or CSV file per recording, giving the start, end and species of each sound you annotated.':
    'Una carpeta con un archivo de texto o CSV por grabación, con el inicio, el fin y la especie de cada sonido que anotaste.',
  "Another model's detections (optional)": 'Detecciones de otro modelo (opcional)',
  'None': 'Ninguno',
  'Remove': 'Quitar',
  'Its name in the results': 'Su nombre en los resultados',
  'Count annotations with a name the model does not know as missed':
    'Contar como no detectadas las anotaciones con un nombre que el modelo no conoce',
  'Reads the date and time from each recording\'s file name, such as 20211027_072000, and shows when each species was detected. Activity is given per hour of recording, so hours with more recording do not look busier.':
    'Lee la fecha y la hora del nombre de cada grabación, como 20211027_072000, y muestra cuándo se detectó cada especie. La actividad se da por hora de grabación, así que las horas con más grabación no parecen más activas.',
  'Times in the file names are': 'Las horas de los nombres están en',
  "UTC (AudioMoth's default)": 'UTC (lo habitual en AudioMoth)',
  'Local time': 'Hora local',
  'Local time is UTC plus': 'La hora local es UTC más',
  'Read times': 'Leer las horas',
  'Use the offset your recorders were set to, or your local time at the date of the recordings. Apus uses one fixed offset for the whole run, so summer and winter time are not switched.':
    'Usa la diferencia horaria con la que configuraste las grabadoras, o tu hora local en las fechas de las grabaciones. Apus usa una diferencia fija para todo el análisis, así que no cambia entre horario de verano e invierno.',
  "A paragraph for the methods section of a report or paper, written from this run's settings. Check it, and add what Apus cannot know: the recorders, their settings and the sampling design.":
    'Un párrafo para la sección de métodos de un informe o artículo, escrito a partir de los ajustes de este análisis. Revísalo y añade lo que Apus no puede saber: las grabadoras, su configuración y el diseño de muestreo.',
  'Copy': 'Copiar',
  'Copied': 'Copiado',
  'To cite': 'Para citar',
  'Settings': 'Ajustes',
  'Saved in this browser': 'Guardados en este navegador',
  'Detection': 'Detección',
  'Threshold': 'Umbral',
  'About the threshold': 'Sobre el umbral',
  'The model gives every species a confidence score from 0 to 1 in each 5 s window. A detection is a score at or above this threshold. A lower threshold finds more calls, but also more false detections. A score is not a probability, and the same score means different things for different species. To set a threshold per species, check some detections and use the Thresholds tab.':
    'El modelo da a cada especie una puntuación de confianza de 0 a 1 en cada ventana de 5 s. Una detección es una puntuación igual o superior a este umbral. Un umbral más bajo encuentra más cantos, pero también más detecciones falsas. Una puntuación no es una probabilidad, y la misma puntuación significa cosas distintas para especies distintas. Para fijar un umbral por especie, revisa algunas detecciones y usa la pestaña Umbrales.',
  'The lowest confidence score (0 to 1) that counts as a detection': 'La puntuación de confianza mínima (de 0 a 1) que cuenta como detección',
  'Window hop': 'Salto entre ventanas',
  'About the window hop': 'Sobre el salto entre ventanas',
  "The model listens to 5 s windows. With a 5 s hop the windows follow each other. With 2.5 s they overlap by half: a call cut by a window's edge is heard whole in the next one, but the run takes twice as long, and a call in two windows is detected twice.":
    'El modelo escucha ventanas de 5 s. Con un salto de 5 s las ventanas van seguidas. Con 2,5 s se solapan a la mitad: un canto cortado por el borde de una ventana se oye entero en la siguiente, pero el análisis tarda el doble y un canto que cae en dos ventanas se detecta dos veces.',
  '5 s: windows back to back': '5 s: ventanas seguidas',
  '2.5 s: windows overlap by half': '2,5 s: ventanas solapadas a la mitad',
  'The model listens to 5 s windows': 'El modelo escucha ventanas de 5 s',
  'Species kept per window': 'Especies por ventana',
  'About species kept per window': 'Sobre las especies por ventana',
  'How many of the best-scoring species are kept for each window, before the threshold. It must be at least 1 divided by the threshold (10 for 0.10), or a species above the threshold could be cut. Apus raises it when needed.':
    'Cuántas de las especies con mejor puntuación se conservan en cada ventana, antes de aplicar el umbral. Debe ser al menos 1 dividido entre el umbral (10 para 0,10), o podría quedar fuera una especie por encima del umbral. Apus lo sube cuando hace falta.',
  'Species names': 'Nombres de especies',
  'Optional': 'Opcional',
  'Species list': 'Lista de especies',
  'About species lists': 'Sobre las listas de especies',
  'File': 'Archivo',
  'Folder of lists': 'Carpeta de listas',
  'Build': 'Crear',
  'Keeps only the species you expect, for example those known in the area. Detections of other species go to removed_by_species_list.csv. Build a list here, or choose your own files.':
    'Conserva solo las especies que esperas, por ejemplo las conocidas en la zona. Las detecciones de otras especies van a removed_by_species_list.csv. Crea aquí una lista o elige tus propios archivos.',
  "One species per line. A file named like a dataset, such as <code>SiteA.txt</code>, applies to that dataset. A file whose name starts with a recording's name applies to that recording.":
    'Una especie por línea. Un archivo con el nombre de un conjunto de datos, como <code>SiteA.txt</code>, se aplica a ese conjunto. Un archivo cuyo nombre empiece por el de una grabación se aplica a esa grabación.',
  'Synonyms': 'Sinónimos',
  'About synonyms': 'Sobre los sinónimos',
  "If your lists or annotations use names that the model spells differently, such as an older taxonomy, this table maps each of your names to the model's. Apus already knows the eBird 2021 names that changed.":
    'Si tus listas o anotaciones usan nombres que el modelo escribe de otra forma, como una taxonomía más antigua, esta tabla asigna cada uno de tus nombres al del modelo. Apus ya conoce los nombres de eBird 2021 que cambiaron.',
  "Two columns, your name then the model's, for example <code>Corvus monedula,Coloeus monedula</code>":
    'Dos columnas, tu nombre y luego el del modelo, por ejemplo <code>Corvus monedula,Coloeus monedula</code>',
  'Output': 'Salida',
  'Save to': 'Guardar en',
  'About the output folder': 'Sobre la carpeta de salida',
  'Chrome and Edge can write the results straight into a folder on your computer as the run goes, and Apus reopens them next time. Without a folder, the results stay in this browser until you download them as a ZIP file.':
    'Chrome y Edge pueden escribir los resultados directamente en una carpeta de tu ordenador mientras avanza el análisis, y Apus los vuelve a abrir la próxima vez. Sin carpeta, los resultados se quedan en este navegador hasta que los descargues como archivo ZIP.',
  'CSV separator': 'Separador CSV',
  'About the CSV separator': 'Sobre el separador CSV',
  'Excel in Spanish, French, German and many other languages expects semicolons and decimal commas. Choose the semicolon if Excel shows each file in a single column.':
    'Excel en español, francés, alemán y muchos otros idiomas espera punto y coma y coma decimal. Elige el punto y coma si Excel muestra cada archivo en una sola columna.',
  'Comma (,)': 'Coma (,)',
  'Semicolon (;), for Excel in many languages': 'Punto y coma (;), para Excel en muchos idiomas',
  'Semicolon files use a decimal comma': 'Los archivos con punto y coma usan coma decimal',
  'Raven selection tables, one per recording': 'Tablas de selección de Raven, una por grabación',
  'About Raven tables': 'Sobre las tablas de Raven',
  'One selection table per recording, to see the detections over the spectrogram in Raven Pro or Raven Lite.':
    'Una tabla de selección por grabación, para ver las detecciones sobre el espectrograma en Raven Pro o Raven Lite.',
  'Audio clips of the detections, to listen to': 'Fragmentos de audio de las detecciones, para escucharlas',
  'About audio clips': 'Sobre los fragmentos de audio',
  'Cuts the audio of a sample of detections, per species and confidence band, to listen to outside Apus. The Check detections tab offers the same sample.':
    'Corta el audio de una muestra de detecciones, por especie y franja de confianza, para escucharlas fuera de Apus. La pestaña Revisar detecciones ofrece la misma muestra.',
  'Clips per confidence band': 'Fragmentos por franja de confianza',
  'Per species, in each band 0.1–0.2, 0.2–0.3…': 'Por especie, en cada franja 0,1–0,2, 0,2–0,3…',
  'Seconds added on each side': 'Segundos añadidos a cada lado',
  'Only these species': 'Solo estas especies',
  'Leave empty for all, or list them: <code>Turdus merula, Parus major</code>': 'Déjalo vacío para todas, o escríbelas: <code>Turdus merula, Parus major</code>',
  'Tell me when a run ends': 'Avisarme cuando termine un análisis',
  'Advanced': 'Avanzado',
  'Continue a stopped run: skip recordings already analysed in the output': 'Continuar un análisis detenido: saltar las grabaciones ya analizadas en la salida',
  'Compute on': 'Calcular con',
  'About the compute device': 'Sobre el dispositivo de cálculo',
  'The graphics card is several times faster. Apus uses it only if its results pass a check at start-up.':
    'La tarjeta gráfica es varias veces más rápida. Apus solo la usa si sus resultados pasan una comprobación al arrancar.',
  'The graphics card if it passes a check, otherwise the CPU': 'La tarjeta gráfica si pasa una comprobación; si no, la CPU',
  'The CPU only': 'Solo la CPU',
  'Changing this reloads the page': 'Cambiarlo recarga la página',
  'Delete the results stored in this browser': 'Borrar los resultados guardados en este navegador',
  "Species are identified by Perch 2.0, Google's model for animal sounds (© Google, Apache 2.0 licence):":
    'Las especies las identifica Perch 2.0, el modelo de Google para sonidos animales (© Google, licencia Apache 2.0):',
  'ONNX conversion by Justin Chu.': 'Conversión a ONNX de Justin Chu.',
  'Runs on': 'Funciona con',
  'and': 'y',
  'Apus is not affiliated with Google.': 'Apus no está afiliado a Google.',
  "The model (409 MB) downloads once and stays in your browser. Its results match those of Google's original version.":
    'El modelo (409 MB) se descarga una vez y se queda en tu navegador. Sus resultados coinciden con los de la versión original de Google.',
  'Cancel': 'Cancelar',
  'Build a species list': 'Crear una lista de especies',
  'Search the species the model knows (14,795 classes) by scientific name, and add the ones you expect. The list applies to every dataset.':
    'Busca por nombre científico entre las especies que conoce el modelo (14.795 clases) y añade las que esperas. La lista se aplica a todos los conjuntos de datos.',
  "Search the model's species": 'Buscar entre las especies del modelo',
  'Search, e.g. Turdus': 'Buscar, p. ej. Turdus',
  'Matches': 'Coincidencias',
  'Your list': 'Tu lista',
  'Download as text': 'Descargar como texto',
  'Use this list': 'Usar esta lista',
  'Raised to {n}: up to {n} species can reach this threshold in one window': 'Subido a {n}: hasta {n} especies pueden alcanzar este umbral en una ventana',
  'The best-scoring species of each window': 'Las especies con mejor puntuación de cada ventana',
  'Threshold {t} · {h} s hop · {k} species per window': 'Umbral {t} · salto de {h} s · {k} especies por ventana',
  'Day mode': 'Modo día',
  'Night mode': 'Modo noche',
  'Model ready · {backend}': 'Modelo listo · {backend}',
  'Recording {i} of {n}: {file} · {rate} windows/s · {left} left': 'Grabación {i} de {n}: {file} · {rate} ventanas/s · quedan {left}',
  'The output already holds results. Replace them with this run?': 'La salida ya contiene resultados. ¿Sustituirlos por este análisis?',
  'Replace': 'Sustituir',
  'Done: {d} detections of {s} species.': 'Terminado: {d} detecciones de {s} especies.',
  'Stopped. Run again with "Continue a stopped run" on (in Advanced) to carry on where it stopped.':
    'Detenido. Vuelve a analizar con «Continuar un análisis detenido» activado (en Avanzado) para seguir donde se quedó.',
  'The run was stopped.': 'El análisis se detuvo.',
  'There are no audio files there. Choose WAV, FLAC or OGG files, or a folder of them.': 'Ahí no hay archivos de audio. Elige archivos WAV, FLAC u OGG, o una carpeta que los contenga.',
  'Drop a folder or audio files here, or choose them. Each sub-folder is one dataset, such as a site or a recorder.':
    'Suelta aquí una carpeta o archivos de audio, o elígelos. Cada subcarpeta es un conjunto de datos, como un sitio o una grabadora.',
  'from {name}': 'de {name}',
  'Drop one folder, or one or more audio files.': 'Suelta una carpeta, o uno o varios archivos de audio.',
  'That folder could not be read. Choose it with "Choose a folder" instead.': 'No se pudo leer esa carpeta. Elígela con «Elegir una carpeta».',
  '{n} s': '{n} s',
  '{n} min': '{n} min',
  '{h} h {m} min': '{h} h {m} min',
  '{n} days': '{n} días',
  'about {x}': 'unos {x}',
  'Checking the recordings…': 'Comprobando las grabaciones…',
  'The recordings could not be checked: {e}': 'No se pudieron comprobar las grabaciones: {e}',
  '{d} of audio': '{d} de audio',
  'Sample rates: {r}': 'Frecuencias de muestreo: {r}',
  'None: every species the model knows is kept': 'Ninguna: se conservan todas las especies que conoce el modelo',
  'Type at least two letters.': 'Escribe al menos dos letras.',
  'No class matches.': 'Ninguna clase coincide.',
  'Added': 'Añadida',
  'Add': 'Añadir',
  'Remove {name}': 'Quitar {name}',
  'No species yet.': 'Todavía no hay especies.',
  'Wait for the model to load: the list of its species comes with it.':
    'Espera a que cargue el modelo: la lista de sus especies llega con él.',
  'The results stay in this browser, and you download them as a ZIP file at the end.': 'Los resultados se quedan en este navegador, y al final los descargas como archivo ZIP.',
  'Recommended: the results are written there as the run goes. Without a folder, they stay in this browser and you download them as a ZIP file at the end.':
    'Recomendado: los resultados se escriben ahí mientras avanza el análisis. Sin carpeta, se quedan en este navegador y al final los descargas como archivo ZIP.',
  'Delete the results stored in this browser? Results saved in folders are kept.': '¿Borrar los resultados guardados en este navegador? Los guardados en carpetas se conservan.',
  'Delete': 'Borrar',
  'The stored results could not be deleted: {e}': 'No se pudieron borrar los resultados guardados: {e}',
  'Reopen the results in {name}': 'Volver a abrir los resultados de {name}',
  'Apus may not open the folder {name}. Choose it again.': 'Apus no tiene permiso para abrir la carpeta {name}. Vuelve a elegirla.',
  'Choose your recordings first.': 'Elige primero tus grabaciones.',
  'Waiting for the model to load…': 'Esperando a que cargue el modelo…',
  'Apus may not write into the folder {name}. Choose it again.': 'Apus no tiene permiso para escribir en la carpeta {name}. Vuelve a elegirla.',
  'Starting…': 'Empezando…',
  'Stopping…': 'Deteniendo…',
  'This browser cannot show notifications.': 'Este navegador no puede mostrar notificaciones.',
  "Notifications are blocked for this page. Allow them in the browser's site settings.": 'Las notificaciones están bloqueadas para esta página. Permítelas en la configuración del sitio del navegador.',
  'No detections at this threshold: try a lower one.': 'No hay detecciones con este umbral: prueba uno más bajo.',
  'Detections of the {n} most detected species': 'Detecciones de las {n} especies más detectadas',
  'Results of {date}, reopened. To listen to detections or compare, choose the same recordings and press Analyse: analysed recordings are skipped.':
    'Resultados del {date}, abiertos de nuevo. Para escuchar detecciones o comparar, elige las mismas grabaciones y pulsa Analizar: las grabaciones ya analizadas se saltan.',
  'Run on {backend}: {w} windows in {s}.': 'Analizado con {backend}: {w} ventanas en {s}.',
  'Saved in the folder': 'Guardado en la carpeta',
  'Download the results (ZIP)': 'Descargar los resultados (ZIP)',
  'Loading…': 'Cargando…',
  '{n} checked': '{n} revisadas',
  'No species matches.': 'Ninguna especie coincide.',
  'Detections by confidence score, in steps of 0.05': 'Detecciones por puntuación de confianza, en pasos de 0,05',
  'threshold': 'umbral',
  'Detections by confidence score. The line marks the threshold ({t}).': 'Detecciones según la puntuación de confianza. La línea marca el umbral ({t}).',
  'Confidence': 'Confianza',
  'Detections': 'Detecciones',
  'Correct': 'Correcta',
  'Incorrect': 'Incorrecta',
  'Unsure': 'Dudosa',
  'Share correct': 'Proporción correcta',
  '{d} of {s} in the sample checked': '{d} de {s} de la muestra revisadas',
  'Which detections': 'Qué detecciones',
  'Sample to check ({n})': 'Muestra para revisar ({n})',
  'All detections ({n})': 'Todas las detecciones ({n})',
  'Keys: Space plays, C correct, I incorrect, U unsure, arrows move between detections.': 'Teclas: Espacio reproduce, C correcta, I incorrecta, U dudosa; las flechas pasan de una detección a otra.',
  'Show {n} more': 'Mostrar {n} más',
  'Play': 'Reproducir',
  'not in the sample': 'fuera de la muestra',
  'Verdict': 'Veredicto',
  'Fitting…': 'Ajustando…',
  'no threshold': 'sin umbral',
  'Checked detections of {s} by confidence, with the fitted chance of being correct': 'Detecciones revisadas de {s} según la confianza, con la probabilidad ajustada de acierto',
  'No checked detections yet. Mark some as correct or incorrect in the Check detections tab first.': 'Todavía no hay detecciones revisadas. Marca primero algunas como correctas o incorrectas en la pestaña Revisar detecciones.',
  "{g} of {n} species got a threshold. {p} of {d} detections pass their species' threshold.": '{g} de {n} especies tienen umbral. {p} de {d} detecciones superan el umbral de su especie.',
  'Dots: your checks, correct at the top and incorrect at the bottom. Line: the fitted chance of being correct. Vertical line: the threshold. Grey line: your target.':
    'Puntos: tus revisiones, correctas arriba e incorrectas abajo. Curva: la probabilidad ajustada de acierto. Línea vertical: el umbral. Línea gris: tu objetivo.',
  'Written to the output: thresholds/thresholds.csv, thresholds/precision_by_band.csv and detections_species_thresholds.csv.':
    'Escrito en la salida: thresholds/thresholds.csv, thresholds/precision_by_band.csv y detections_species_thresholds.csv.',
  'Comparing…': 'Comparando…',
  'Precision against recall: {l}': 'Precisión frente a exhaustividad: {l}',
  'Recall': 'Exhaustividad',
  'Precision': 'Precisión',
  'Perch by threshold: {l}': 'Perch según el umbral: {l}',
  'Confidence threshold': 'Umbral de confianza',
  'Score': 'Valor',
  'A confidence of 0.5 does not mean the same for two models: compare them on the curves, not at one threshold. A best threshold marked ≤ is only an upper bound.':
    'Una confianza de 0,5 no significa lo mismo en dos modelos: compáralos con las curvas, no con un solo umbral. Un mejor umbral marcado con ≤ es solo una cota superior.',
  'By species': 'Por especie',
  'By dataset': 'Por conjunto de datos',
  'Written to the output: the comparison folder, with the false positives and missed calls of each model.': 'Escrito en la salida: la carpeta comparison, con los falsos positivos y los cantos no detectados de cada modelo.',
  'Reading times…': 'Leyendo las horas…',
  'no recording': 'sin grabación',
  '{d} detections in {h} h of recording': '{d} detecciones en {h} h de grabación',
  'Detections per hour of recording': 'Detecciones por hora de grabación',
  'Highest: {v} detections per hour of recording.': 'Máximo: {v} detecciones por hora de grabación.',
  'Times read from {k} of {n} recordings, from {a} to {b} (local time, UTC{o}).': 'Horas leídas de {k} de {n} grabaciones, de {a} a {b} (hora local, UTC{o}).',
  'All species': 'Todas las especies',
  'By hour of the day': 'Por hora del día',
  'By date': 'Por fecha',
  'Detections per hour of recording: the detections at that hour or date, divided by the hours of audio analysed then. This is calling activity, not the number of animals.':
    'Detecciones por hora de grabación: las detecciones de esa hora o fecha, divididas entre las horas de audio analizadas entonces. Es actividad vocal, no el número de animales.',
  "Written to the output: detection_times.csv, with each detection's time in UTC and in local time.": 'Escrito en la salida: detection_times.csv, con la hora de cada detección en UTC y en hora local.',
  'Recordings were analysed with Perch 2.0 (van Merriënboer et al. 2025), a classifier of 14,795 classes of animal sounds, run in Apus 0.2.0 (López-de Sancha 2026) with ONNX Runtime Web.':
    'Las grabaciones se analizaron con Perch 2.0 (van Merriënboer et al. 2025), un clasificador de 14.795 clases de sonidos animales, ejecutado en Apus 0.2.0 (López-de Sancha 2026) con ONNX Runtime Web.',
  'Each recording was converted to mono and resampled to 32 kHz with a polyphase filter. It was cut into 5 s windows every {hop} s, and in each window the mean was removed and the peak scaled to 0.25, as in perch-hoplite.':
    'Cada grabación se convirtió a mono y se remuestreó a 32 kHz con un filtro polifásico. Se cortó en ventanas de 5 s cada {hop} s, y en cada ventana se restó la media y se escaló el pico a 0,25, como en perch-hoplite.',
  'In each window the {k} highest-scoring classes were kept, and a class scoring at least {t} counted as a detection.':
    'En cada ventana se conservaron las {k} clases con mayor puntuación, y una clase con puntuación de al menos {t} contó como detección.',
  'Detections of species not on the species list for each recording were removed.': 'Se eliminaron las detecciones de especies que no estaban en la lista de especies de cada grabación.',
  'The {n} recordings in {d} datasets gave {det} detections of {sp} species.': 'Las {n} grabaciones de {d} conjuntos de datos dieron {det} detecciones de {sp} especies.',
  '({w} windows analysed.)': '({w} ventanas analizadas.)',
  'A threshold per species was then fitted from {c} checked detections, with a logistic regression of the verdict on the logit of the confidence, at a target probability of {p} (Wood & Kahl 2024).':
    'Después se ajustó un umbral por especie a partir de {c} detecciones revisadas, con una regresión logística del veredicto sobre el logit de la confianza, para una probabilidad objetivo de {p} (Wood y Kahl 2024).',
  'Detections were compared with manual annotations at the vocalization and dataset levels (Funosas et al. 2026).': 'Las detecciones se compararon con anotaciones manuales a nivel de vocalización y de conjunto de datos (Funosas et al. 2026).',
  '{n} recording': '{n} grabación',
  '{n} recordings': '{n} grabaciones',
  'in {n} dataset': 'en {n} conjunto de datos',
  'in {n} datasets': 'en {n} conjuntos de datos',
  '{n} window of 5 s': '{n} ventana de 5 s',
  '{n} windows of 5 s': '{n} ventanas de 5 s',
  '{n} file cannot be read and will be skipped': '{n} archivo no se puede leer y se saltará',
  '{n} files cannot be read and will be skipped': '{n} archivos no se pueden leer y se saltarán',
  '{n} file is below 32 kHz: it holds no sound above half its sample rate':
    '{n} archivo está por debajo de 32 kHz: no contiene sonido por encima de la mitad de su frecuencia de muestreo',
  '{n} files are below 32 kHz: they hold no sound above half their sample rate':
    '{n} archivos están por debajo de 32 kHz: no contienen sonido por encima de la mitad de su frecuencia de muestreo',
  '{n} file is compressed with loss (MP3, Vorbis or Opus), which can blur high frequencies': '{n} archivo está comprimido con pérdida (MP3, Vorbis u Opus), lo que puede borrar frecuencias altas',
  '{n} files are compressed with loss (MP3, Vorbis or Opus), which can blur high frequencies': '{n} archivos están comprimidos con pérdida (MP3, Vorbis u Opus), lo que puede borrar frecuencias altas',
  '{n} file is shorter than 5 s and is padded with silence': '{n} archivo dura menos de 5 s y se completa con silencio',
  '{n} files are shorter than 5 s and are padded with silence': '{n} archivos duran menos de 5 s y se completan con silencio',
  'Your list ({n} species)': 'Tu lista ({n} especies)',
  '{n} file': '{n} archivo',
  '{n} files': '{n} archivos',
  '{n} recording was not analysed': '{n} grabación no se analizó',
  '{n} recordings were not analysed': '{n} grabaciones no se analizaron',
  '{n} detection': '{n} detección',
  '{n} detections': '{n} detecciones',
  '{n} sorted clip has no known confidence and was left out.': '{n} fragmento ordenado no tiene confianza conocida y quedó fuera.',
  '{n} sorted clips have no known confidence and were left out.': '{n} fragmentos ordenados no tienen confianza conocida y quedaron fuera.',
  '{n} file name holds no date and time': '{n} nombre de archivo no contiene fecha y hora',
  '{n} file names hold no date and time': '{n} nombres de archivo no contienen fecha y hora',
  'about {x} to analyse (a rough first estimate)': 'unos {x} de análisis (primera estimación aproximada)',
  'about {x} to analyse': 'unos {x} de análisis',
  'Mean confidence': 'Confianza media',
  'Highest confidence': 'Confianza máxima',
  'Dataset': 'Conjunto de datos',
  'Recordings analysed': 'Grabaciones analizadas',
  'With detections': 'Con detecciones',
  'Checked': 'Revisadas',
  'Correct kept': 'Correctas conservadas',
  'Note': 'Nota',
  'F1': 'F1',
  'Model': 'Modelo',
  'Level': 'Nivel',
  'Best threshold': 'Mejor umbral',
  'Best F1': 'Mejor F1',
  'PR AUC': 'AUC PR',
  'Annotated': 'Anotadas',
  'Calls: precision': 'Cantos: precisión',
  'Calls: recall': 'Cantos: exhaustividad',
  'Datasets: found': 'Conjuntos: halladas',
  'Datasets: missed': 'Conjuntos: no halladas',
  'Datasets: false': 'Conjuntos: falsas',
  'Single calls': 'Vocalizaciones sueltas',
  'Species per dataset': 'Especies por conjunto de datos',
  'Run time': 'Duración',
  'Loading': 'Cargando',
  'Starting Python': 'Iniciando Python',
  'Downloading the model (409 MB, only the first time)': 'Descargando el modelo (409 MB, solo la primera vez)',
  'Downloading the species names': 'Descargando los nombres de las especies',
  'Checking the graphics card': 'Comprobando la tarjeta gráfica',
  'Preparing the CPU': 'Preparando la CPU',
  'The model could not start': 'El modelo no pudo arrancar',
  'Writing the results': 'Escribiendo los resultados',
  'Loading scikit-learn (4.6 MB, only the first time)': 'Cargando scikit-learn (4,6 MB, solo la primera vez)',
  // Help for species thresholds and for Compare
  'About species thresholds':
    'Sobre los umbrales por especie',
  '<strong>What it is.</strong> The lowest confidence score that a detection of one species needs to be kept.':
    '<strong>Qué es.</strong> La puntuación de confianza mínima que necesita una detección de una especie para conservarse.',
  '<strong>Why.</strong> The threshold in Settings is the same for every species, but a score does not mean the same for each. A score of 0.5 can be almost always right for one species and wrong half the time for another.':
    '<strong>Para qué.</strong> El umbral de los Ajustes es el mismo para todas las especies, pero una puntuación no significa lo mismo en cada una. Una puntuación de 0,5 puede acertar casi siempre en una especie y fallar la mitad de las veces en otra.',
  '<strong>How.</strong> From your checks, Apus works out how the share of correct detections grows with the score, and finds the score at which it reaches your target. With a target of 0.95, about 95 in 100 detections at the threshold are right, and more of those above it (Wood and Kahl 2024).':
    '<strong>Cómo.</strong> Con tus revisiones, Apus calcula cómo crece la proporción de detecciones correctas con la puntuación, y busca la puntuación a la que alcanza tu objetivo. Con un objetivo de 0,95, unas 95 de cada 100 detecciones en el umbral son correctas, y más aún por encima de él (Wood y Kahl 2024).',
  '<strong>What it costs.</strong> A higher threshold also drops correct detections: <em>Correct kept</em> shows how many of yours stay. Your checks tell how often detections are right, not how many calls were missed.':
    '<strong>Qué cuesta.</strong> Un umbral más alto también descarta detecciones correctas: <em>Correctas conservadas</em> muestra cuántas de las tuyas se mantienen. Tus revisiones dicen con qué frecuencia aciertan las detecciones, no cuántos cantos se perdieron.',
  'About annotation files':
    'Sobre los archivos de anotaciones',
  '<strong>Formats.</strong> Apus reads three kinds of file:':
    '<strong>Formatos.</strong> Apus lee tres tipos de archivo:',
  'Audacity labels: start, end and species, separated by tabs.':
    'Etiquetas de Audacity: inicio, fin y especie, separados por tabuladores.',
  'Raven selection tables with a <code>Species</code> column.':
    'Tablas de selección de Raven con una columna <code>Species</code>.',
  'Any table with a start and an end in seconds and a species, in columns with English names such as <code>start</code>, <code>end</code> and <code>species</code>.':
    'Cualquier tabla con inicio y fin en segundos y especie, en columnas con nombres en inglés como <code>start</code>, <code>end</code> y <code>species</code>.',
  "<strong>File names.</strong> Each file's name starts with its recording's name: <code>rec01.txt</code> or <code>rec01.Table.1.selections.txt</code> for <code>rec01.wav</code>. Recordings without a file are left out. An empty file means you listened and found nothing.":
    '<strong>Nombres de archivo.</strong> El nombre de cada archivo empieza por el de su grabación: <code>rec01.txt</code> o <code>rec01.Table.1.selections.txt</code> para <code>rec01.wav</code>. Las grabaciones sin archivo quedan fuera. Un archivo vacío significa que escuchaste y no encontraste nada.',
  '<strong>Species names.</strong> Scientific names or eBird codes. For other names, such as common names, add a synonyms file in Settings.':
    '<strong>Nombres de especie.</strong> Nombres científicos o códigos de eBird. Para otros nombres, como los comunes, añade un archivo de sinónimos en Ajustes.',
  '<strong>Annotate everything.</strong> A detection counts as right when its 5 s window overlaps an annotation of the same species in the same recording. Annotate every species you hear, or the detections of the ones you skipped count as false.':
    '<strong>Anótalo todo.</strong> Una detección cuenta como correcta cuando su ventana de 5 s se solapa con una anotación de la misma especie en la misma grabación. Anota todas las especies que oigas, o las detecciones de las que te saltes contarán como falsas.',
  "About another model's detections":
    'Sobre las detecciones de otro modelo',
  'The result files that another model, such as BirdNET, made for the same recordings. Apus does not run that model: it scores its detections against the same annotations.':
    'Los archivos de resultados que otro modelo, como BirdNET, hizo para las mismas grabaciones. Apus no ejecuta ese modelo: evalúa sus detecciones frente a las mismas anotaciones.',
  "The same formats as the annotations, plus a column with each detection's confidence, named <code>confidence</code> or <code>score</code>. BirdNET's CSV results work as they are:":
    'Los mismos formatos que las anotaciones, más una columna con la confianza de cada detección, llamada <code>confidence</code> o <code>score</code>. Los resultados CSV de BirdNET sirven tal cual:',
  "One table for all the recordings also works, if a column names each detection's file, as BirdNET's <code>File</code> column does. Without a confidence column, every detection counts as certain.":
    'También sirve una sola tabla para todas las grabaciones, si una columna indica el archivo de cada detección, como la columna <code>File</code> de BirdNET. Sin columna de confianza, cada detección cuenta como segura.',
  'Off, they are left out. Either way they are listed in comparison/unmatched_labels.csv. Check it: a typo there needs a synonyms file, and a label that is not a species, such as Noise, counts as missed while this is on.':
    'Desactivado, quedan fuera. En ambos casos aparecen en comparison/unmatched_labels.csv. Revísalo: una errata ahí necesita un archivo de sinónimos, y una etiqueta que no es una especie, como Noise, cuenta como no detectada mientras esto esté activado.',
};

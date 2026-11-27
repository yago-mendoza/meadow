// Meadow line icons. Drawn for Meadow in the manner of Material Symbols Outlined (light weight):
// 24×24 grid, ~2px padding, strokes only (tiny dots are filled circles). Each `svg` is the inner markup for
// <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">.

const dot = (x, y, r = 1.1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const CLOUD = 'M7.5 19h9.5a3.5 3.5 0 0 0 1-6.85A5.5 5.5 0 0 0 7.1 11 4 4 0 0 0 7.5 19z';

export const ICON_SETS = [
  { name: 'Trabajo', icons: ['briefcase', 'folder', 'document', 'clipboard', 'inbox', 'archive', 'list', 'checklist', 'kanban', 'chart-bar', 'chart-line', 'chart-pie', 'presentation', 'building'] },
  { name: 'Estudio', icons: ['book', 'book-open', 'notebook', 'graduation-cap', 'pencil', 'flask', 'microscope', 'atom', 'calculator', 'newspaper'] },
  { name: 'Ideas y creación', icons: ['lightbulb', 'sparkles', 'brain', 'puzzle', 'rocket', 'target', 'brush', 'palette', 'pen', 'scissors', 'shapes', 'camera'] },
  { name: 'Casa y vida', icons: ['home', 'bed', 'sofa', 'coffee', 'utensils', 'cart', 'bag', 'plant-pot', 'key', 'shirt', 'gift', 'box'] },
  { name: 'Salud y deporte', icons: ['pulse', 'dumbbell', 'run', 'ball', 'lotus', 'apple', 'pill', 'droplet', 'first-aid'] },
  { name: 'Dinero', icons: ['wallet', 'coin', 'banknote', 'credit-card', 'bank', 'piggy-bank', 'receipt', 'trending-up', 'tag', 'percent'] },
  { name: 'Viajes y lugares', icons: ['plane', 'car', 'train', 'bike', 'map', 'map-pin', 'globe', 'compass', 'anchor', 'luggage', 'tent'] },
  { name: 'Personas', icons: ['person', 'group', 'baby', 'smile', 'chat', 'mail', 'phone', 'hand', 'id-card', 'paw', 'cake'] },
  { name: 'Tiempo', icons: ['calendar', 'calendar-check', 'clock', 'alarm', 'hourglass', 'stopwatch', 'history', 'repeat'] },
  { name: 'Tecnología', icons: ['laptop', 'smartphone', 'monitor', 'server', 'database', 'cloud-upload', 'code', 'terminal', 'cpu', 'wifi', 'robot', 'gear', 'wrench', 'link'] },
  { name: 'Naturaleza', icons: ['leaf', 'tree', 'sprout', 'flower', 'sun', 'moon', 'cloud', 'umbrella', 'snowflake', 'waves', 'mountain'] },
  { name: 'Ocio', icons: ['music', 'headphones', 'guitar', 'microphone', 'film', 'gamepad', 'dice', 'ticket', 'tv', 'cocktail'] },
  { name: 'Señales', icons: ['star', 'heart', 'flag', 'bookmark', 'pushpin', 'check', 'check-circle', 'alert', 'info', 'bell', 'eye', 'lock', 'shield', 'fire', 'bolt', 'diamond', 'crown', 'trophy', 'medal'] },
];

export const ICONS = {
  // Trabajo
  briefcase: { label: 'Maletín', k: 'trabajo oficina empleo negocio cartera', svg: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3 12.5h18"/>' },
  folder: { label: 'Carpeta', k: 'carpeta archivos directorio proyecto', svg: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' },
  document: { label: 'Documento', k: 'documento archivo hoja página nota texto', svg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>' },
  clipboard: { label: 'Portapapeles', k: 'portapapeles informe formulario revisión', svg: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><rect x="9" y="3" width="6" height="3" rx="1"/><path d="M9 11h6M9 15h4"/>' },
  inbox: { label: 'Bandeja', k: 'bandeja entrada recibidos pendiente', svg: '<path d="M3 13l2.5-8h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>' },
  archive: { label: 'Archivo', k: 'archivo archivar caja guardado histórico', svg: '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4"/>' },
  list: { label: 'Lista', k: 'lista elementos índice', svg: '<path d="M9 6h11M9 12h11M9 18h11"/>' + dot(4.5, 6) + dot(4.5, 12) + dot(4.5, 18) },
  checklist: { label: 'Lista de tareas', k: 'tareas pendientes hecho checklist to-do', svg: '<path d="M3.5 6.5L5 8l3-3M3.5 15.5L5 17l3-3M11 7h9M11 16h9"/>' },
  kanban: { label: 'Tablero', k: 'kanban tablero columnas flujo proceso', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7.5 7v8M12 7v5M16.5 7v10"/>' },
  'chart-bar': { label: 'Gráfico de barras', k: 'gráfico barras estadística datos métricas', svg: '<path d="M3.5 20.5h17M6.5 17v-5M12 17V5M17.5 17V9"/>' },
  'chart-line': { label: 'Gráfico', k: 'gráfico línea evolución datos análisis', svg: '<path d="M3.5 3.5v17h17"/><path d="M7.5 14.5l3.5-4 3 3 5.5-6"/>' },
  'chart-pie': { label: 'Gráfico circular', k: 'tarta quesito reparto porcentaje datos', svg: '<path d="M19 13a8 8 0 1 1-8-8v8z"/><path d="M14 3a7 7 0 0 1 7 7h-7z"/>' },
  presentation: { label: 'Presentación', k: 'presentación pizarra reunión diapositivas charla', svg: '<path d="M3 4h18M4.5 4v10a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V4M12 15v3M8.5 21l3.5-3 3.5 3"/>' },
  building: { label: 'Edificio', k: 'edificio empresa oficina organización', svg: '<path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M16 9h1.5a2 2 0 0 1 2 2v10M3.5 21h17M8.5 7.5h4M8.5 11.5h4M8.5 15.5h4"/>' },

  // Estudio
  book: { label: 'Libro', k: 'libro lectura biblioteca estudio', svg: '<path d="M5 18.5v-13A2.5 2.5 0 0 1 7.5 3H19v18H7.5a2.5 2.5 0 0 1 0-5H19"/>' },
  'book-open': { label: 'Libro abierto', k: 'leer lectura libro abierto apuntes', svg: '<path d="M12 7c-1.5-1.5-4-2-8-2v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2V5c-4 0-6.5.5-8 2zM12 7v13"/>' },
  notebook: { label: 'Cuaderno', k: 'cuaderno libreta diario apuntes notas', svg: '<rect x="6" y="3" width="14" height="18" rx="2"/><path d="M9.5 3v18M4 7.5h3.5M4 12h3.5M4 16.5h3.5"/>' },
  'graduation-cap': { label: 'Graduación', k: 'universidad estudios curso título birrete', svg: '<path d="M3 9.5L12 5l9 4.5-9 4.5z"/><path d="M6.5 11.3V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.7M21 9.5V15"/>' },
  pencil: { label: 'Lápiz', k: 'lápiz escribir editar borrador', svg: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="M14.5 5.5l3 3"/>' },
  flask: { label: 'Matraz', k: 'química ciencia laboratorio experimento', svg: '<path d="M9.5 3h5M10 3v6L4.8 18.2A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.8L14 9V3M7 15h10"/>' },
  microscope: { label: 'Microscopio', k: 'ciencia biología investigación laboratorio', svg: '<rect x="8.5" y="3" width="4" height="9" rx="1"/><path d="M10.5 12v3M7 17.5h7M12.5 7h1.5a7 7 0 0 1 0 14M5 21h10"/>' },
  atom: { label: 'Átomo', k: 'física ciencia átomo química', svg: '<ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)"/>' + dot(12, 12) },
  calculator: { label: 'Calculadora', k: 'calculadora matemáticas cuentas números', svg: '<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="3.5" rx=".5"/>' + dot(8.6, 13.5) + dot(12, 13.5) + dot(15.4, 13.5) + dot(8.6, 17) + dot(12, 17) + dot(15.4, 17) },
  newspaper: { label: 'Periódico', k: 'periódico noticias prensa artículo revista', svg: '<path d="M4 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M16 8h3a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2M7.5 7.5h5v3.5h-5zM7.5 14.5h5M7.5 17.5h3"/>' },

  // Ideas y creación
  lightbulb: { label: 'Bombilla', k: 'idea bombilla inspiración ocurrencia', svg: '<path d="M12 3A6 6 0 0 0 8.5 13.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3zM9.5 18.5h5M10.5 21h3"/>' },
  sparkles: { label: 'Destellos', k: 'magia brillo novedad ia especial', svg: '<path d="M10 3.5Q10.8 9.2 16.5 10 10.8 10.8 10 16.5 9.2 10.8 3.5 10 9.2 9.2 10 3.5z"/><path d="M17.5 14.5Q17.9 17.1 20.5 17.5 17.9 17.9 17.5 20.5 17.1 17.9 14.5 17.5 17.1 17.1 17.5 14.5z"/>' },
  brain: { label: 'Cerebro', k: 'mente pensar psicología conocimiento memoria', svg: '<path d="M12 5.5A2.5 2.5 0 0 0 7.3 4.8 2.8 2.8 0 0 0 4.6 8.6 3 3 0 0 0 4.4 14 3 3 0 0 0 7.5 18.5 2.5 2.5 0 0 0 12 19.5M12 5.5a2.5 2.5 0 0 1 4.7-.7 2.8 2.8 0 0 1 2.7 3.8A3 3 0 0 1 19.6 14a3 3 0 0 1-3.1 4.5 2.5 2.5 0 0 1-4.5 1M12 5.5v14M8 10c1.2 0 2 .8 2 2M16 10c-1.2 0-2 .8-2 2"/>' },
  puzzle: { label: 'Puzle', k: 'puzle pieza problema encaje módulo', svg: '<path d="M4 8a1 1 0 0 1 1-1h3.5v-.5a2.5 2.5 0 0 1 5 0V7H17a1 1 0 0 1 1 1v3.5h.5a2.5 2.5 0 0 1 0 5H18V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>' },
  rocket: { label: 'Cohete', k: 'cohete lanzamiento proyecto startup despegar', svg: '<path d="M12 3c3 2 4.5 5.5 4.5 9.5V16h-9v-3.5C7.5 8.5 9 5 12 3zM7.5 12.5L5 15v3.5l2.5-1.5M16.5 12.5L19 15v3.5L16.5 17M10.5 19v1.5M13.5 19v1.5"/><circle cx="12" cy="9.5" r="1.8"/>' },
  target: { label: 'Diana', k: 'objetivo meta diana foco propósito', svg: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/>' + dot(12, 12, 1.6) },
  brush: { label: 'Pincel', k: 'pincel pintar arte dibujo diseño', svg: '<path d="M19.3 3.5c.5-.4 1.2.3.8.8L12.8 13.6l-2.4-2.4z"/><path d="M10 12.6c-2 0-3.6 1.4-3.6 3.6 0 1.1-.7 2.2-2.4 2.8 1.2.8 2.7 1.3 4.1 1.3 2.6 0 4.4-1.8 4.4-4.2"/>' },
  palette: { label: 'Paleta', k: 'paleta color pintura arte diseño', svg: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z"/>' + dot(7.5, 11.5) + dot(9.5, 7.5) + dot(14.5, 7.5) + dot(17, 11) },
  pen: { label: 'Pluma', k: 'pluma escribir escritura firma caligrafía', svg: '<path d="M9 3.5h6l2.5 7.5L12 21l-5.5-10z"/><path d="M12 21v-6"/><circle cx="12" cy="12.5" r="1.5"/>' },
  scissors: { label: 'Tijeras', k: 'tijeras cortar manualidades recortar', svg: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.2 7.8L20 18M8.2 16.2L20 6"/>' },
  shapes: { label: 'Formas', k: 'formas figuras diseño geometría categorías', svg: '<path d="M12 3l4.5 7.5h-9z"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><circle cx="17" cy="17" r="3.5"/>' },
  camera: { label: 'Cámara', k: 'foto fotografía cámara imagen', svg: '<path d="M3 8.5a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>' },

  // Casa y vida
  home: { label: 'Casa', k: 'casa hogar inicio vivienda', svg: '<path d="M3.5 11L12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5h4v5"/>' },
  bed: { label: 'Cama', k: 'cama dormir descanso sueño dormitorio', svg: '<path d="M3 6v14M3 16h18v4M21 16v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="12.5" r="2"/>' },
  sofa: { label: 'Sofá', k: 'sofá salón muebles descanso', svg: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM5 18v2M19 18v2"/>' },
  coffee: { label: 'Café', k: 'café taza desayuno pausa', svg: '<path d="M4.5 9.5h11V15a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z"/><path d="M15.5 11H17a2.5 2.5 0 0 1 0 5h-1.5M8 3.5c-.6.8-.6 1.7 0 2.5M11.5 3.5c-.6.8-.6 1.7 0 2.5"/>' },
  utensils: { label: 'Cubiertos', k: 'comida cocina recetas restaurante comer', svg: '<path d="M6 3v5a2.5 2.5 0 0 0 5 0V3M8.5 3v18M17 21V3c-2 1-3 4-3 8h3"/>' },
  cart: { label: 'Carrito', k: 'compra carrito supermercado tienda', svg: '<path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.4-1.1L20.5 8H6"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>' },
  bag: { label: 'Bolsa', k: 'bolsa compras tienda ropa', svg: '<path d="M5 8h14l-1 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>' },
  'plant-pot': { label: 'Planta', k: 'planta maceta jardín interior', svg: '<path d="M7 14h10l-1.2 6.2a1 1 0 0 1-1 .8H9.2a1 1 0 0 1-1-.8zM12 14V8"/><path d="M12 10c0-3 2-5 6-5 0 3-2 5-6 5zM12 12c-3 0-5-1.5-5.5-4.5 3 0 5 1.5 5.5 4.5z"/>' },
  key: { label: 'Llave', k: 'llave acceso clave contraseña', svg: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16.5 6.5L19 9M14 9l2 2"/>' },
  shirt: { label: 'Ropa', k: 'ropa camiseta armario moda', svg: '<path d="M9 4L4.5 6 3 10.5l2.8 1V20h12.4v-8.5l2.8-1L19.5 6 15 4c-.4 1.4-1.5 2.3-3 2.3S9.4 5.4 9 4z"/>' },
  gift: { label: 'Regalo', k: 'regalo cumpleaños sorpresa deseos', svg: '<rect x="4" y="8" width="16" height="4" rx="1"/><path d="M5.5 12v7.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V12M12 8v12.5M12 8c-1-2.5-2.5-4-4-4a2 2 0 0 0 0 4M12 8c1-2.5 2.5-4 4-4a2 2 0 0 1 0 4"/>' },
  box: { label: 'Caja', k: 'caja paquete envío mudanza inventario', svg: '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9"/>' },

  // Salud y deporte
  pulse: { label: 'Pulso', k: 'salud pulso corazón médico actividad', svg: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>' },
  dumbbell: { label: 'Pesas', k: 'gimnasio pesas fuerza ejercicio entrenamiento', svg: '<path d="M9 12h6M3.5 9.5v5M20.5 9.5v5"/><rect x="6" y="6.5" width="3" height="11" rx="1"/><rect x="15" y="6.5" width="3" height="11" rx="1"/>' },
  run: { label: 'Correr', k: 'correr running carrera deporte ejercicio', svg: '<circle cx="15" cy="4.5" r="1.8"/><path d="M13.3 8.5l-2.3 5.5 3 2.5-1 4.5M11 14l-2 3H5.5M7 10.5L10 8h3.3l2.2 3 3 .5"/>' },
  ball: { label: 'Balón', k: 'balón pelota deporte baloncesto equipo', svg: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M6 5a9 9 0 0 1 0 14M18 5a9 9 0 0 0 0 14"/>' },
  lotus: { label: 'Bienestar', k: 'meditación yoga calma bienestar loto', svg: '<path d="M12 20c-4 0-8-3-9-8 3 0 6 1 9 4 3-3 6-4 9-4-1 5-5 8-9 8z"/><path d="M12 16c-2-2.5-2-6 0-9 2 3 2 6.5 0 9z"/>' },
  apple: { label: 'Manzana', k: 'manzana fruta dieta nutrición comida sana', svg: '<path d="M12 7.5c-1-1-2.5-1.5-4-1.5-3 0-4.5 2.5-4.5 5.5 0 4 3 9 5.5 9 1.2 0 1.8-.6 3-.6s1.8.6 3 .6c2.5 0 5.5-5 5.5-9 0-3-1.5-5.5-4.5-5.5-1.5 0-3 .5-4 1.5zM12 7.5c0-2 1-3.5 3-4.5"/>' },
  pill: { label: 'Pastilla', k: 'medicina pastilla farmacia tratamiento', svg: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M9.5 9.5l5 5"/>' },
  droplet: { label: 'Gota', k: 'agua gota hidratación beber', svg: '<path d="M12 3.5c3 4 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.5 6-10.5z"/>' },
  'first-aid': { label: 'Botiquín', k: 'botiquín médico salud urgencias primeros auxilios', svg: '<rect x="3" y="6.5" width="18" height="14" rx="2"/><path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5M12 10.5v6M9 13.5h6"/>' },

  // Dinero
  wallet: { label: 'Cartera', k: 'cartera dinero gastos billetera', svg: '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M6 7l9-3.3a1 1 0 0 1 1.3.9V7M20.5 11.5H17a1.8 1.8 0 0 0 0 3.6h3.5"/>' },
  coin: { label: 'Moneda', k: 'moneda euro dinero ahorro', svg: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5a4.5 4.5 0 1 0 0 7M7 10.5h5.5M7 13.5h5.5"/>' },
  banknote: { label: 'Billete', k: 'billete efectivo dinero pago', svg: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>' + dot(6.5, 12) + dot(17.5, 12) },
  'credit-card': { label: 'Tarjeta', k: 'tarjeta crédito pago banco compras', svg: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>' },
  bank: { label: 'Banco', k: 'banco cuenta finanzas institución', svg: '<path d="M3 9L12 4l9 5z"/><path d="M6 12v5M10 12v5M14 12v5M18 12v5M3.5 20h17"/>' },
  'piggy-bank': { label: 'Hucha', k: 'hucha ahorro ahorrar dinero', svg: '<path d="M5 12a7 6 0 0 1 7-6h2.5L17 4v3.5c1 .7 1.8 1.6 2.2 2.5h1.3v4H19c-.5 1-1.3 1.8-2 2.3V20h-2.5v-1.5h-4V20H8v-2.3A6 6 0 0 1 5 12zM10 9h3M5.2 10.5c-1.2 0-2-.7-2-1.9"/>' + dot(16, 10.5, 1) },
  receipt: { label: 'Recibo', k: 'recibo factura ticket gasto', svg: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>' },
  'trending-up': { label: 'Crecimiento', k: 'subida inversión crecimiento bolsa tendencia', svg: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>' },
  tag: { label: 'Etiqueta', k: 'etiqueta precio categoría oferta', svg: '<path d="M3.5 4.5v6.3a1 1 0 0 0 .3.7l8.7 8.7a1 1 0 0 0 1.4 0l6.3-6.3a1 1 0 0 0 0-1.4L11.5 3.8a1 1 0 0 0-.7-.3H4.5a1 1 0 0 0-1 1z"/><circle cx="7.8" cy="7.8" r="1.3"/>' },
  percent: { label: 'Porcentaje', k: 'porcentaje descuento interés impuestos', svg: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>' },

  // Viajes y lugares
  plane: { label: 'Avión', k: 'avión vuelo viaje vacaciones aeropuerto', svg: '<path d="M12 3c.8 0 1.4.7 1.4 1.5V9.5l7 4.2v1.8l-7-2.1v4.6l2 1.5V21L12 20l-3.4 1v-1.5l2-1.5v-4.6l-7 2.1v-1.8l7-4.2V4.5c0-.8.6-1.5 1.4-1.5z"/>' },
  car: { label: 'Coche', k: 'coche auto conducir carretera transporte', svg: '<path d="M5 11l1.6-4.6A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.4L19 11"/><rect x="3.5" y="11" width="17" height="6" rx="1.5"/><path d="M6 17v2.5M18 17v2.5"/>' + dot(7.5, 14) + dot(16.5, 14) },
  train: { label: 'Tren', k: 'tren metro ferrocarril transporte', svg: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M12 3v7M8.5 21l2-4M15.5 21l-2-4"/>' + dot(8.5, 13.5) + dot(15.5, 13.5) },
  bike: { label: 'Bici', k: 'bicicleta bici ciclismo pedalear', svg: '<circle cx="6" cy="16.5" r="3.3"/><circle cx="18" cy="16.5" r="3.3"/><path d="M6 16.5L9.5 10h6L18 16.5M6 16.5h5l4.5-6.5M11 16.5L9 8M7.5 8h3M15.5 10l-1-3h2.5"/>' },
  map: { label: 'Mapa', k: 'mapa ruta plano viaje', svg: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14"/>' },
  'map-pin': { label: 'Ubicación', k: 'ubicación lugar sitio dirección marcador', svg: '<path d="M12 21s-6.5-5.5-6.5-11a6.5 6.5 0 0 1 13 0c0 5.5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>' },
  globe: { label: 'Mundo', k: 'mundo internacional idiomas web planeta', svg: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>' },
  compass: { label: 'Brújula', k: 'brújula orientación explorar rumbo dirección', svg: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>' },
  anchor: { label: 'Ancla', k: 'ancla mar barco puerto estabilidad', svg: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M8.5 10.5h7M5 13a7 7 0 0 0 14 0M3 13h4M17 13h4"/>' },
  luggage: { label: 'Maleta', k: 'maleta equipaje viaje vacaciones', svg: '<rect x="5" y="7" width="14" height="12" rx="2"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7M9 7v12M15 7v12M8 19v1.5M16 19v1.5"/>' },
  tent: { label: 'Tienda', k: 'acampada camping tienda campaña excursión', svg: '<path d="M3 20L12 4l9 16zM9 20l3-6 3 6"/>' },

  // Personas
  person: { label: 'Persona', k: 'persona usuario perfil yo cuenta', svg: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.5-4 3.5-6.5 7.5-6.5s7 2.5 7.5 6.5"/>' },
  group: { label: 'Grupo', k: 'grupo equipo personas amigos familia', svg: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 20c.4-3.5 2.8-5.8 6-5.8s5.6 2.3 6 5.8M15.5 5.5a3.3 3.3 0 0 1 0 6.3M17.5 14.5c2 .7 3.2 2.6 3.5 5.5"/>' },
  baby: { label: 'Bebé', k: 'bebé niño hijo crianza familia', svg: '<circle cx="12" cy="13" r="7.5"/><path d="M12 5.5c-1.2-.7-1-2.5.8-2.5M10 16.2c1.1.8 2.9.8 4 0"/>' + dot(9.5, 12.5) + dot(14.5, 12.5) },
  smile: { label: 'Sonrisa', k: 'feliz ánimo humor emociones cara', svg: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0"/>' + dot(9, 10) + dot(15, 10) },
  chat: { label: 'Conversación', k: 'chat mensaje conversación hablar comentario', svg: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z"/><path d="M8 8.5h8M8 12h5"/>' },
  mail: { label: 'Correo', k: 'correo email mensaje carta', svg: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>' },
  phone: { label: 'Llamada', k: 'teléfono llamada contacto llamar', svg: '<path d="M5 4h3.5l1.5 4.5-2.2 1.3a11 11 0 0 0 6.4 6.4l1.3-2.2L20 15.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z"/>' },
  hand: { label: 'Mano', k: 'mano ayuda voluntariado saludo hola', svg: '<path d="M7 13.5V7.75a1.25 1.25 0 0 1 2.5 0V11.5M9.5 11V5.75a1.25 1.25 0 0 1 2.5 0V11M12 11V6.75a1.25 1.25 0 0 1 2.5 0V11.5M14.5 11.5V8.75a1.25 1.25 0 0 1 2.5 0V15c0 3.3-2.5 6-6 6h-.5c-2 0-3.4-.8-4.6-2.4L3.8 15a1.4 1.4 0 0 1 2.2-1.7L7 14.5"/>' },
  'id-card': { label: 'Ficha', k: 'contacto tarjeta identidad ficha perfil', svg: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.5-1.5 1.6-2.2 3-2.2s2.5.7 3 2.2M14 10h4M14 13.5h3"/>' },
  paw: { label: 'Mascota', k: 'mascota perro gato animal huella', svg: '<circle cx="6.5" cy="10.5" r="1.7"/><circle cx="9.8" cy="6.5" r="1.7"/><circle cx="14.2" cy="6.5" r="1.7"/><circle cx="17.5" cy="10.5" r="1.7"/><path d="M12 12.5c-2 0-3 2-4.5 3.5-1 1-1.5 2-1 3s1.8 1.3 3 1c1-.3 1.6-.5 2.5-.5s1.5.2 2.5.5c1.2.3 2.5 0 3-1s0-2-1-3c-1.5-1.5-2.5-3.5-4.5-3.5z"/>' },
  cake: { label: 'Tarta', k: 'tarta cumpleaños celebración fiesta aniversario', svg: '<path d="M4 21h16M5 21v-7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v7M5 16.5c1.2 0 1.8-1 3.5-1s2.3 1 3.5 1 1.8-1 3.5-1 2.3 1 3.5 1M8 13v-3M12 13v-3M16 13v-3"/>' + dot(8, 6.8) + dot(12, 6.8) + dot(16, 6.8) },

  // Tiempo
  calendar: { label: 'Calendario', k: 'calendario fecha agenda mes evento', svg: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' },
  'calendar-check': { label: 'Cita', k: 'cita evento hecho reserva calendario', svg: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>' },
  clock: { label: 'Reloj', k: 'reloj hora tiempo horario', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>' },
  alarm: { label: 'Alarma', k: 'alarma despertador aviso recordatorio', svg: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M4 5.5L6.5 3M20 5.5L17.5 3"/>' },
  hourglass: { label: 'Reloj de arena', k: 'espera paciencia plazo tiempo arena', svg: '<path d="M6.5 3h11M6.5 21h11M7.5 3v2.5c0 2.5 4.5 4 4.5 6.5S7.5 16 7.5 18.5V21M16.5 3v2.5c0 2.5-4.5 4-4.5 6.5s4.5 4 4.5 6.5V21"/>' },
  stopwatch: { label: 'Cronómetro', k: 'cronómetro temporizador pomodoro tiempo', svg: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M10 3h4M12 3v3M18.5 6.5l1.2-1.2"/>' },
  history: { label: 'Historial', k: 'historial pasado registro antes', svg: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 4v4.5H8M12 7.5V12l3 2"/>' },
  repeat: { label: 'Repetir', k: 'repetir hábito rutina ciclo recurrente', svg: '<path d="M17 3l3 3-3 3M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>' },

  // Tecnología
  laptop: { label: 'Portátil', k: 'portátil ordenador laptop computadora', svg: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>' },
  smartphone: { label: 'Móvil', k: 'móvil teléfono smartphone app', svg: '<rect x="6.5" y="3" width="11" height="18" rx="2"/><path d="M11 18h2"/>' },
  monitor: { label: 'Pantalla', k: 'pantalla monitor ordenador escritorio', svg: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>' },
  server: { label: 'Servidor', k: 'servidor hosting infraestructura backend', svg: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M11.5 7.5h5M11.5 16.5h5"/>' + dot(7.5, 7.5) + dot(7.5, 16.5) },
  database: { label: 'Base de datos', k: 'base datos almacenamiento tabla', svg: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>' },
  'cloud-upload': { label: 'Subir', k: 'nube subir copia respaldo sincronizar', svg: `<path d="${CLOUD}"/><path d="M12 16.5v-5M9.8 13.5l2.2-2.2 2.2 2.2"/>` },
  code: { label: 'Código', k: 'código programación desarrollo software', svg: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>' },
  terminal: { label: 'Terminal', k: 'terminal consola comandos shell', svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>' },
  cpu: { label: 'Procesador', k: 'chip procesador hardware electrónica', svg: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>' },
  wifi: { label: 'Wifi', k: 'wifi internet red conexión', svg: '<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.5 8.5 0 0 1 12 0M9 16a4.2 4.2 0 0 1 6 0"/>' + dot(12, 19.3, 1.2) },
  robot: { label: 'Robot', k: 'robot ia inteligencia artificial bot automatización', svg: '<rect x="5" y="8" width="14" height="11" rx="2.5"/><path d="M12 8V5.5M10 15.5h4M5 12.5H3.5v3H5M19 12.5h1.5v3H19"/>' + dot(12, 4.3, 1.3) + dot(9.5, 12.3) + dot(14.5, 12.3) },
  gear: { label: 'Ajustes', k: 'ajustes configuración engranaje sistema', svg: '<path d="M10.59 5.35L10.9 3.07h2.2l.31 2.28A6.8 6.8 0 0 1 15.7 6.3l1.84-1.39 1.55 1.55L17.7 8.3a6.8 6.8 0 0 1 .95 2.29l2.28.31v2.2l-2.28.31a6.8 6.8 0 0 1-.95 2.29l1.39 1.84-1.55 1.55-1.84-1.39a6.8 6.8 0 0 1-2.29.95l-.31 2.28h-2.2l-.31-2.28A6.8 6.8 0 0 1 8.3 17.7l-1.84 1.39-1.55-1.55L6.3 15.7a6.8 6.8 0 0 1-.95-2.29l-2.28-.31v-2.2l2.28-.31A6.8 6.8 0 0 1 6.3 8.3L4.91 6.46l1.55-1.55L8.3 6.3a6.8 6.8 0 0 1 2.29-.95z"/><circle cx="12" cy="12" r="3"/>' },
  wrench: { label: 'Llave inglesa', k: 'herramienta arreglar reparar mantenimiento bricolaje', svg: '<path d="M20.07 6.47A5 5 0 0 1 13.47 13.07L6.27 20.27a1.8 1.8 0 0 1-2.54-2.54l7.2-7.2A5 5 0 0 1 17.53 3.93l-2.24 2.24 2.54 2.54z"/>' },
  link: { label: 'Enlace', k: 'enlace link url web vínculo', svg: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>' },

  // Naturaleza
  leaf: { label: 'Hoja', k: 'hoja naturaleza ecología verde sostenible', svg: '<path d="M5 19C5 10 10 5 19.5 4.5 19 14 14 19 5 19zM5 19l8-8M5 19l-1.5 1.5"/>' },
  tree: { label: 'Árbol', k: 'árbol bosque naturaleza pino', svg: '<path d="M12 3L6.5 10h3l-4 5.5h13l-4-5.5h3zM12 15.5V21"/>' },
  sprout: { label: 'Brote', k: 'brote crecer empezar semilla huerto', svg: '<path d="M12 21v-9M12 12c0-3.5-2.5-6-7-6 0 3.5 2.5 6 7 6zM12 10c0-3 2-5 6-5 0 3-2 5-6 5zM7.5 21h9"/>' },
  flower: { label: 'Flor', k: 'flor jardín primavera tulipán', svg: '<path d="M12 21v-8M7 5.5c0 4.5 2 7.5 5 7.5s5-3 5-7.5l-2.5 2-2.5-3-2.5 3zM12 18.5c-1-2-3-3-5-3 .5 2 2.5 3 5 3z"/>' },
  sun: { label: 'Sol', k: 'sol día verano clima luz', svg: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>' },
  moon: { label: 'Luna', k: 'luna noche dormir sueño', svg: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>' },
  cloud: { label: 'Nube', k: 'nube tiempo clima cielo', svg: `<path d="${CLOUD}"/>` },
  umbrella: { label: 'Paraguas', k: 'paraguas lluvia protección clima', svg: '<path d="M3 12a9 9 0 0 1 18 0c-1.5-1.3-4.5-1.3-6 0-1.5-1.3-4.5-1.3-6 0-1.5-1.3-4.5-1.3-6 0zM12 12v6.5a2 2 0 0 1-4 0"/>' },
  snowflake: { label: 'Copo de nieve', k: 'nieve invierno frío copo', svg: '<path d="M12 3v18M19.79 7.5L4.21 16.5M19.79 16.5L4.21 7.5M9.9 4.4L12 6.4l2.1-2M17.53 6.38l-.68 2.82 2.78.82M19.63 13.98l-2.78.82.68 2.82M14.1 19.6L12 17.6l-2.1 2M6.47 17.62l.68-2.82-2.78-.82M4.37 10.02l2.78-.82-.68-2.82"/>' },
  waves: { label: 'Olas', k: 'mar agua olas playa natación', svg: '<path d="M3 8c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2M3 12.5c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2M3 17c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2"/>' },
  mountain: { label: 'Montaña', k: 'montaña senderismo paisaje excursión cima', svg: '<path d="M3 19.5L9 8.5l4.2 7.3 2.3-3.3 5.5 7z"/><circle cx="17" cy="6" r="1.8"/>' },

  // Ocio
  music: { label: 'Música', k: 'música canción nota sonido playlist', svg: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>' },
  headphones: { label: 'Auriculares', k: 'auriculares escuchar podcast música audio', svg: '<path d="M3.5 14h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-2-2v-6a8.5 8.5 0 0 1 17 0v6a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3"/>' },
  guitar: { label: 'Guitarra', k: 'guitarra instrumento música tocar', svg: '<path d="M9.13 11.04A3.5 3.5 0 1 1 13.46 15.37 5 5 0 1 1 9.13 11.04zM10.4 14.1l8.4-8.4M17.3 4.2l2.5 2.5"/><circle cx="9.3" cy="15.2" r="1.5"/>' },
  microphone: { label: 'Micrófono', k: 'micrófono voz grabar podcast cantar', svg: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>' },
  film: { label: 'Película', k: 'película cine vídeo serie', svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>' },
  gamepad: { label: 'Mando', k: 'videojuegos juego mando consola jugar', svg: '<path d="M7 7h10a4.5 4.5 0 0 1 4.4 5.5l-1 4.6a2.4 2.4 0 0 1-4.2 1L14.5 16h-5l-1.7 2.1a2.4 2.4 0 0 1-4.2-1l-1-4.6A4.5 4.5 0 0 1 7 7z"/><path d="M7.5 10v3.5M5.75 11.75h3.5"/>' + dot(15.5, 10.5) + dot(17.5, 12.8) },
  dice: { label: 'Dado', k: 'dado juego mesa azar', svg: '<rect x="4" y="4" width="16" height="16" rx="3"/>' + dot(8.5, 8.5, 1.3) + dot(15.5, 8.5, 1.3) + dot(12, 12, 1.3) + dot(8.5, 15.5, 1.3) + dot(15.5, 15.5, 1.3) },
  ticket: { label: 'Entrada', k: 'entrada ticket concierto teatro evento', svg: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5z"/><path d="M15 8.5v1M15 11.5v1M15 14.5v1"/>' },
  tv: { label: 'Tele', k: 'televisión tele series ver', svg: '<rect x="3" y="6.5" width="18" height="13" rx="2"/><path d="M8 3l4 3.5L16 3"/>' },
  cocktail: { label: 'Copa', k: 'copa bebida fiesta bar salir', svg: '<path d="M4 4h16l-8 9zM12 13v7M8 20h8M7 7.5h10"/>' },

  // Señales
  star: { label: 'Estrella', k: 'estrella favorito destacado importante', svg: '<path d="M12 3.4l2.41 5.88 6.34.48-4.85 4.11 1.51 6.17L12 16.7l-5.41 3.34 1.51-6.17-4.85-4.11 6.34-.48z"/>' },
  heart: { label: 'Corazón', k: 'corazón amor favorito pareja me gusta', svg: '<path d="M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20 9.5C20 15.2 12 20 12 20z"/>' },
  flag: { label: 'Bandera', k: 'bandera hito marca objetivo meta', svg: '<path d="M5 21V4M5 4.5h12.5l-2.5 4.5 2.5 4.5H5"/>' },
  bookmark: { label: 'Marcador', k: 'marcador guardar leer después', svg: '<path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21L12 17l-5.5 4z"/>' },
  pushpin: { label: 'Chincheta', k: 'fijar anclar chincheta importante', svg: '<path d="M9 3.5h6M10 3.5v6L7 13v1.5h10V13l-3-3.5v-6M12 14.5V21"/>' },
  check: { label: 'Hecho', k: 'hecho completado visto ok', svg: '<path d="M4.5 12.5l5 5 10-10.5"/>' },
  'check-circle': { label: 'Completado', k: 'completado terminado aprobado logrado', svg: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8 5.7-5.8"/>' },
  alert: { label: 'Aviso', k: 'aviso alerta atención cuidado urgente', svg: '<path d="M10.3 4.3a2 2 0 0 1 3.4 0l7.4 12.8a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3zM12 9.5v4"/>' + dot(12, 16.8) },
  info: { label: 'Información', k: 'información ayuda nota referencia', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/>' + dot(12, 7.8) },
  bell: { label: 'Campana', k: 'notificación aviso recordatorio campana', svg: '<path d="M6 16V10.5a6 6 0 0 1 12 0V16l1.5 1.5h-15zM10 19.5c.4 1 1.1 1.5 2 1.5s1.6-.5 2-1.5M12 3v1.5"/>' },
  eye: { label: 'Ojo', k: 'ver vigilar seguimiento observar visión', svg: '<path d="M3 12c2-3.8 5.2-6 9-6s7 2.2 9 6c-2 3.8-5.2 6-9 6s-7-2.2-9-6z"/><circle cx="12" cy="12" r="3"/>' },
  lock: { label: 'Candado', k: 'privado candado seguro bloqueado secreto', svg: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/>' + dot(12, 15.5, 1.2) },
  shield: { label: 'Escudo', k: 'seguridad protección escudo seguro', svg: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/>' },
  fire: { label: 'Fuego', k: 'fuego urgente racha caliente tendencia', svg: '<path d="M12 21c-3.6 0-6.5-2.6-6.5-6.2 0-3.3 2.2-5.4 3.6-7.4.3 1.6 1.2 2.6 2.2 3 0-3.2 1.4-5.9 3.4-7.4.2 2.8 1.6 4.5 2.8 6 1.1 1.4 1.5 3 1.5 4.6 0 4-2.8 7.4-7 7.4z"/>' },
  bolt: { label: 'Rayo', k: 'rayo energía rápido electricidad potencia', svg: '<path d="M13.5 3L5.5 13H12l-1.5 8 8-10H12z"/>' },
  diamond: { label: 'Diamante', k: 'diamante joya valor premium', svg: '<path d="M6.5 4h11L21 9l-9 11L3 9zM3 9h18M9.5 4L8 9l4 11 4-11-1.5-5"/>' },
  crown: { label: 'Corona', k: 'corona rey líder mejor prioridad', svg: '<path d="M4 7.5l3.5 4L12 5l4.5 6.5 3.5-4-1.5 10h-13zM6 20.5h12"/>' },
  trophy: { label: 'Trofeo', k: 'trofeo logro premio ganar campeón', svg: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H5.5a.5.5 0 0 0-.5.5V7a3 3 0 0 0 3 3M16 6h2.5a.5.5 0 0 1 .5.5V7a3 3 0 0 1-3 3M12 14v4M8.5 20.5h7M9.5 20.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5"/>' },
  medal: { label: 'Medalla', k: 'medalla logro premio reconocimiento', svg: '<circle cx="12" cy="15" r="5.5"/><path d="M8.7 10.6L6 3.5h4.5L12 8.5M15.3 10.6L18 3.5h-4.5L12 8.5"/>' + dot(12, 15, 1.4) },
};

export const iconSVG = (name, size = 18) => {
  const icon = ICONS[name];
  if (!icon) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.svg}</svg>`;
};

# Principios de Meadow

Sacados de lo que Yago ha dicho al construirla (26.11.2026). Cuando dice algo nuevo que es un principio, se añade
aquí con su frase y la fecha; si sustituye a uno, se cambia el viejo, no se apila.

## De la aplicación

1. **Calma.** Tonos pastel, limpio, al estilo Odoo. Nada chillón ni dorado. Sin animaciones decorativas («es cutre»):
   solo las que ayudan a no perder la vista (un bloque que cambia de sitio, el zoom a algo, los cajones al plegarse),
   y entonces suaves y rápidas.
2. **Sin lenguaje interno.** Nada de números de documento (`*N`), ids ni estados del sistema en pantalla. Ni textos
   obvios. Un icono conocido antes que una palabra (¶ para el formato).
3. **Lo frecuente, lo fácil.** Arrastrar mueve la vista porque es lo que más se hace; seleccionar grupos va con Ctrl.
   Un clic acerca y centra; doble clic abre.
4. **Una cosa, un objeto.** Una idea o una tarea es la misma esté donde esté (plano, documentos). Un documento tiene un
   solo título: el de dentro.
5. **Jerarquía física.** Lo que está encima va con lo de debajo: al moverlo, al escalarlo y al guardarlo en un cajón.
   Marco > documento > post-it, idea, tarea.
6. **Lo que no se usa, se aparta.** Los cajones viven recogidos y salen cuando un documento se acerca; los botones
   aparecen al pasar por encima.
7. **Nunca perder el sitio.** Siempre hay vuelta: «Volver a donde estabas» (Enter), las migas entre documentos, el
   historial con restaurar, Ctrl+Z.
8. **El movimiento es la referencia.** Yago, 26.11: «ahora la animación es PERFECTA, me encanta, sigue así con lo ergonómico de las
   animaciones de stick, arrastre…». Todo lo nuevo se mueve con `motion.js` (encajar elástico, crecer suave, irse al revés de
   como vino); nada inventa su propia animación.
9. **Solo dos relaciones.** Interior y borde (ver `MODEL.md`). Lo pequeño nunca mueve ni cambia lo grande.
10. **El texto es texto.** Debajo de todo hay un bloc de notas; el formato es una lectura que se apaga con ¶.

## Del desarrollo

1. **Ante la duda, pregunta.** Si algo admite dos lecturas, o la decisión es de su gusto, pregúntale antes de
   construir: pocas preguntas, cortas, con opciones concretas. Y pregúntale también para entenderle mejor: qué quiere
   conseguir, cómo lo usa, qué le molesta. No adivines lo que se puede preguntar en una línea.
2. **Critica antes de obedecer.** Si su idea tiene un fallo o hay algo mejor, dilo en una frase y propón; luego
   construye lo acordado.
3. **Su frase manda sobre la letra.** Quédate con la intención; cuando corrige («olvida lo de las áreas»), lo viejo
   se quita del todo.
4. **Breve.** Respuestas cortas, sin tablas ni repasos que no pidió.
5. **Mira antes de decir hecho.** Prueba como él lo usaría (navegador sin ventana, clics y arrastres reales,
   capturas), nunca con sus datos: `MEADOW_DATA` apunta a una copia de prueba.
6. **Un commit por entrega**, con el README al día.
7. **No añadas lo que no pidió.** Si se te ocurre algo, una línea al final; él decide.

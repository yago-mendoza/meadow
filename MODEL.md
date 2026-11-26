# El modelo de Meadow

Todo es anidamiento. Hay una sola cosa, el **nodo**: tiene un título y vive dentro de otro. Lo que es lo dice dónde
está, siguiendo una escalera:

```
Proyecto (GGUF.OS)
 └ Apartado                   (columnas de la izquierda: PRINCIPIOS, UIX…; un apartado puede tener apartados dentro, hasta 4 columnas)
    └ Marco
       └ Pestaña de marco          (un marco tiene siempre al menos una)
          └ Marco … | Documento     (marcos dentro de marcos, los que haga falta; al final, documentos)
             └ Pestaña de documento (un documento tiene siempre al menos una)
                └ # Título › ## › ### › … › líneas   (dentro del texto)
```

## Convertir es arrastrar

Soltar algo en otro peldaño lo convierte, y todo lo que lleva dentro baja o sube los mismos peldaños:

- Un `#`/`##` soltado en las pestañas de un marco → **pestaña de marco**; sus subtítulos → **documentos**; su texto va
  dentro (el texto propio del título, en un documento con su nombre).
- Un documento soltado dentro de otro → **pestaña** de ese documento; soltado en un título del mapa → **subtítulo**.
- Un marco soltado en un texto → títulos; sus pestañas → subtítulos; y así hacia abajo.
- Nada escrito se pierde: el texto que no tiene página donde vivir se guarda en un documento.

Qué hijo admite cada uno: proyecto → apartados y documentos · apartado → apartados y documentos (en la columna), o marcos y documentos sueltos · marco → pestaña · pestaña de marco → marco o documento · documento →
pestaña · pestaña de documento → títulos en el texto.

## Pantalla

- **El escenario**: el nodo en el que estás (el proyecto, o un marco por dentro). Sus marcos con sus pestañas y lo que
  tiene la abierta. Entrar (⤢) hace crecer el marco desde su sitio; Esc o las migas, salir.
- **El documento** se abre al hacer clic: sus pestañas arriba, el índice a la izquierda (sus títulos se pueden
  arrastrar a otro sitio para convertirlos), la escritura de siempre.
- **El mapa** (abajo a la izquierda): todo el árbol como rectángulos anidados, con nombres; rueda para acercar, clic
  para ir, y se puede arrastrar desde y hacia él. Arriba de un rectángulo (su nombre) = como pestaña; dentro = dentro.
- **Un cajón**: lo que se aparta del árbol, para volver a soltarlo donde sea.
- **Dibujos** (🖍): bocetos colgados de un marco o un documento, hechos solo con figuras (rectángulo, círculo,
  triángulo, rombo, línea) que se cogen pasando por encima y se ponen arrastrando; se guardan como figuras y se pintan
  pixelados (96 × 64), con una miniatura donde cuelgan.
- **Contexto**: Ctrl+clic elige algo con todo lo de dentro (o lo quita) y se va sumando; el clic normal sigue navegando.
  La barra de abajo cuenta lo elegido y lo copia como un texto Markdown; ◳ la saca o la guarda.
- **Ideas y tareas**: se cuelgan de cualquier nodo (arrastrándolas encima) o se escriben en una línea del texto. Una tarea es algo que hay
  que hacer fuera de Meadow; una idea, algo que se podría hacer más adelante en el propio Meadow. Las dos tienen ficha. La
  tarea: el plan (con versiones), a tener en cuenta, estado (por empezar, plan revisado, en curso, hecha, bloqueada),
  para quién (yo o el agente) y comentarios de cada uno. «[]» en un texto crea una.

Los datos: `data/meadow.json` (`v: 2`, `nodes`, `drawer`, `ideas`, `tasks`). La copia de antes del árbol:
`data/meadow-antes-del-arbol-2026-11-26.json`.

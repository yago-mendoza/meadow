# El modelo de Meadow

Qué hay en el plano, cómo se ordena y cómo responde a cada gesto. Cuando algo nuevo entra, se le da su género aquí
primero; si un gesto hace en un género algo distinto que en otro, tiene que estar escrito el porqué.

## 1. Géneros (de mayor a menor)

| Género | Piezas | Qué es |
|---|---|---|
| **Contenedor** | Marco | Agrupa lo que tiene dentro. Puede anidarse en otro marco. Tiene lengüeta (título) y descripción. |
| **Hoja** | Documento | Texto largo que se abre. Lleva cosas encima, enganchadas debajo y clavadas en sus bordes. |
| **Pieza suelta** | Post-it, Texto | Se lee sin abrir; se escribe encima. |
| **Ficha** | Idea, Tarea | Un objeto único: el mismo en el plano y dentro de cualquier documento. Suelta, es un circulito. |
| **Adorno** | Ribete | Marca un borde de otra cosa; no existe sin ella. |

Rango (para «quién lleva a quién»): contenedor 4 · hoja 3 · pieza suelta y ficha 2. El adorno no tiene rango: vive en
su anfitrión.

## 2. Relaciones: solo dos

Yago, 26.11: «relación de interior o de borde, no hay más».

- **Interior.** Cada cosa pertenece a lo más pequeño, de género igual o mayor, cuyo rectángulo contiene su centro (si
  empatan, lo de arriba). Un marco contiene además los marcos que caben enteros en él. *Un marco nunca es más pequeño que
  lo que contiene, y nunca se solapa con un marco que no esté dentro de él: si lo pisa, lo empuja.*
- **Borde.** Ideas y tareas viven solo aquí, nunca dentro de nada: en uno de los 8 atractores de un documento, post-it o
  marco (4 esquinas y el centro de cada lado, con la línea del borde pasando por su centro), o enganchadas debajo de un
  documento (en columna, del ancho de la hoja, 3 líneas; más de 5, el tipo mayoritario se pliega en un circulito con
  número). Soltadas dentro de algo, van a su atractor más cercano. Los ribetes también son de borde. Lo de borde hereda el
  tamaño y la altura de su anfitrión: no se escala ni va al frente o al fondo por su cuenta.

Con las dos pasa lo mismo: **lo de dentro y lo del borde viajan con su anfitrión** al moverlo, escalarlo o guardarlo en
un cajón, y **lo pequeño nunca mueve ni cambia lo grande**.

## 3. Gramática de gestos

| Gesto | Contenedor | Hoja | Pieza suelta | Ficha | Adorno |
|---|---|---|---|---|---|
| **Clic** | 1.º: él y todo lo de dentro · 2.º: solo él | 1.º: acerca + ella y lo que lleva · 2.º: solo ella | acerca | lee (popup) | lee (popup) |
| **Clic en su título** | renombra | renombra | — | — | — |
| **Doble clic** | — | abre | escribe | escribe sobre su color | — |
| **Arrastrar** | mueve todo lo que contiene | mueve lo que lleva; despacio hace sitio en su marco, rápido sale | mueve lo que lleva dentro | se suelta, se clava o se engancha según dónde caiga (hueco punteado) | cambia de borde o de anfitrión |
| **Alt + arrastrar** | solo él | solo ella | solo ella | solo ella | — |
| **Esquina** | estira (Shift: escala lo de dentro) | escala con lo que lleva | escala | escala (no si está clavada o enganchada) | — |
| **Supr** | borra lo seleccionado | | | | |
| **Ctrl+Z** | deshace cualquier operación | | | | |

Acercarse a un documento lo convierte en el documento vivo: se lee y se escribe en la propia hoja, por páginas (la
rueda pasa página; Ctrl+rueda acerca); abajo, «Volver al plano» (Esc) y «Pantalla completa». Un marco puede tener
pestañas, como un archivador: cada una con su contenido.

En el vacío: arrastrar mueve la vista; Ctrl+arrastrar selecciona; la rueda acerca. Enter vuelve a donde estabas.

## 4. Movimiento

Todo cambio de sitio o de forma pasa por `public/motion.js`: unas pocas curvas (`snap` para lo que encaja, `smooth`
para crecer y aparecer, `out` para irse) y una sola forma de animar (de su sitio y tamaño viejos al nuevo). Nada se
anima por su cuenta. Lo que se abre se cierra con la misma animación, al revés.

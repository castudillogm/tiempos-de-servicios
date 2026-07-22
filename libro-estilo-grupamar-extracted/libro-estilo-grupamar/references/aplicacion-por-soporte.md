# Aplicación del libro de estilo según tipo de entregable

Guía rápida de qué priorizar del manual (SKILL.md) según el tipo de pieza que se esté creando.

## Documentos y presentaciones (Word / PPT)
- Usar el skill `docx` o `pptx` correspondiente para la construcción del archivo, combinado con este libro de estilo para la parte visual.
- Tipografía: Basier Square si está disponible como fuente instalable; si no, Arial Nova / Arial como fallback. Nunca Calibri, Times New Roman u otra fuente por defecto de Office.
- Títulos en Azul Oscuro (#091197), subtítulos en Azul Claro (#03A9EC).
- Fondo de diapositivas/documento: blanco por defecto; Azul Oscuro solo para portada o separadores de sección (con logo en negativo).
- Logo completo en la portada; logo reducido en encabezados/pies de página si el espacio es limitado.
- Tarjetas, cuadros de texto destacados y marcos de imagen con esquinas redondeadas.

## Piezas digitales / web (banners, posts, gráficos, artifacts HTML)
- Paleta de colores estricta: blanco, azul oscuro, azul claro, gris claro puntual, naranja solo como resalte muy puntual.
- CSS: usar `border-radius` generoso (~30px o proporcional) en tarjetas, botones, contenedores, imágenes. Sin esquinas rectas (`border-radius: 0`) en ningún elemento de marca.
- Iconos outline para interfaces digitales (web, dashboards, presentaciones interactivas); iconos solid solo si se está replicando señalética física.
- Si se genera el imagotipo o logo en SVG, respetar la geometría de rombos redondeados — no reinterpretar el símbolo.

## Comunicaciones internas (emails, informes, memos)
- Estas piezas priorizan el tono operativo interno de Juan Martín (ver skill `vjmev01` para su voz personal) PERO cualquier elemento de marca visible (firma, plantilla, logo) debe seguir este libro de estilo.
- Tipografía en firmas/plantillas de email: Arial Nova (Light/Regular/Bold) por ser entorno restringido.
- El nombre "GrupaMar" siempre con capitalización correcta, incluso en texto plano de email.

## Señalética, papelería, merchandising
- Logo reducido cuando el espacio es pequeño.
- Iconos solid en blanco sobre azul claro para señalización física.
- Escala de grises solo si la técnica de impresión es monocromática (grabado láser, serigrafía a una tinta).

# Сторонние компоненты и лицензии

Проект использует следующие библиотеки и ресурсы. Все они распространяются по лицензиям, совместимым с приватным использованием; при публикации сборки сохраняйте тексты лицензий.

## Runtime-зависимости

| Компонент | Лицензия | Использование |
|---|---|---|
| React, React DOM | MIT | UI |
| lucide-react | ISC | иконки |
| docx | MIT | генерация Word-документов |
| jspdf | MIT | генерация PDF |
| fflate | MIT | разбор/сборка OOXML (`.docx`-шаблоны, `.xlsx`/`.xlsm` и ZIP-пакеты) |
| html2canvas, dompurify | MIT / Apache-2.0 | транзитивные зависимости jsPDF |

## Шрифты

| Шрифт | Лицензия | Примечание |
|---|---|---|
| Manrope | SIL Open Font License 1.1 | интерфейс (`@fontsource-variable/manrope`) |
| JetBrains Mono | SIL Open Font License 1.1 | моноширинный, числа (`@fontsource-variable/jetbrains-mono`) |
| DejaVu Sans (Regular, Bold) | Bitstream Vera Fonts License / Public Domain-совместимая | встроен base64 в `src/data/cyrillicFont.ts` для кириллицы в PDF |

Текст лицензии Bitstream Vera:

```
Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved.
Bitstream Vera is a trademark of Bitstream, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of the fonts accompanying this license ("Fonts") and associated documentation
files (the "Font Software"), to reproduce and distribute the Font Software,
including without limitation the rights to use, copy, merge, publish,
distribute, and/or sell copies of the Font Software, and to permit persons to
whom the Font Software is furnished to do so, subject to the following
conditions:

The above copyright and trademark notices and this permission notice shall be
included in all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular the
designs of glyphs or characters in the Fonts may be modified and additional
glyphs or characters may be added to the Fonts, only if the fonts are renamed
to names not containing either the words "Bitstream" or the word "Vera".

This License becomes null and void to the extent applicable to Fonts or Font
Software that has been modified and is distributed under the "Bitstream Vera"
names.
```

## Разработка

| Компонент | Лицензия |
|---|---|
| TypeScript, Vite, Vitest | MIT |
| Tailwind CSS | MIT |
| vite-plugin-pwa, Workbox | MIT |

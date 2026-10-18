'use strict';

/*
 * 화면에서 쓰는 Lucide 아이콘만 골라 public/icons.js 로 만든다.
 * 서버는 인터넷 없이도 동작해야 하므로 CDN 대신 이 파일을 함께 배포한다.
 *
 *   npm install          # lucide (개발용) 설치
 *   npm run build:icons  # 아이콘 목록을 바꾼 뒤 실행
 */

const fs = require('fs');
const path = require('path');
const { icons } = require('lucide');
const { version } = require('lucide/package.json');

const NAMES = [
  'arrow-left-right',
  'ban',
  'bell',
  'bell-off',
  'chef-hat',
  'circle-check-big',
  'circle-x',
  'clipboard-list',
  'clock',
  'external-link',
  'hand-platter',
  'minus',
  'play',
  'plus',
  'rotate-ccw',
  'send',
  'settings',
  'shopping-cart',
  'sticky-note',
  'trash-2',
  'undo-2',
];

const pascal = (name) => name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
const attrs = (obj) => Object.entries(obj).map(([k, v]) => ` ${k}="${v}"`).join('');

const out = {};
for (const name of NAMES) {
  const node = icons[pascal(name)];
  if (!node) throw new Error(`Lucide 에 없는 아이콘: ${name}`);
  const children = node[2] || node; // lucide 버전에 따라 [tag, attrs, children] 또는 children 배열
  out[name] = children.map(([tag, a]) => `<${tag}${attrs(a)}/>`).join('');
}

const file = path.join(__dirname, '..', 'public', 'icons.js');
fs.writeFileSync(
  file,
  `/* Lucide v${version} 아이콘 (ISC License, https://lucide.dev) — scripts/build-icons.js 로 생성됨. 직접 수정하지 마세요. */\n` +
    `window.LUCIDE_ICONS = ${JSON.stringify(out, null, 2)};\n`,
);
console.log(`${NAMES.length}개 아이콘 → ${path.relative(process.cwd(), file)}`);

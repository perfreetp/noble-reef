// 版式库：单图 / 双图 / 三图 / 跨页通栏 四类模板
// L、R 槽位使用页内坐标（原点在各页左上角）；S 槽位使用跨页描述符：
//   { x1: 距左页左边, x2: 距右页右边, y, h }，具体矩形随中缝宽度实时计算。
import { PAGE_W, PAGE_H, PAGE_MARGIN, MIN_SLOT_GAP, SLOT, ZONE, VAR, TEMPLATE_KIND } from './constants.js';

let seq = 0;
export function uid(prefix = 'id') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const M = PAGE_MARGIN;
const G = MIN_SLOT_GAP;
const CW = PAGE_W - M * 2;          // 页内容宽 184
const CH = PAGE_H - M * 2;         // 页内容高 264
const PAGE_NUM_Y = PAGE_H - M - 8; // 页码槽 y

// 通用文字槽工厂
function text(zone, variable, r, opts = {}) {
  return {
    id: uid('txt'),
    type: SLOT.TEXT,
    zone,
    rect: { ...r },
    variable,
    fontSize: opts.fontSize ?? 8,
    color: opts.color ?? '#3a3a3a',
    align: opts.align ?? 'center',
    fontFamily: opts.fontFamily ?? '"Noto Serif SC", "Songti SC", serif'
  };
}

function photo(zone, r, spread) {
  return {
    id: uid('ph'),
    type: SLOT.PHOTO,
    zone,
    rect: r ? { ...r } : null,      // L/R：页内矩形
    spread: spread ? { ...spread } : null, // S：跨页描述符
    fill: null                      // { imageId, focus{x,y}, zoom, pan{x,y} }
  };
}

// 两页页码 + 常用姓名/日期槽
function footerTexts(extra = []) {
  return [
    text(ZONE.LEFT, VAR.PAGE, { x: M, y: PAGE_NUM_Y, w: CW, h: 8 }, { fontSize: 5, align: 'center' }),
    text(ZONE.RIGHT, VAR.PAGE, { x: M, y: PAGE_NUM_Y, w: CW, h: 8 }, { fontSize: 5, align: 'center' }),
    ...extra
  ];
}

const namesDateR = () => [
  text(ZONE.RIGHT, VAR.NAMES, { x: 16, y: 70, w: PAGE_W - 32, h: 22 }, { fontSize: 13 }),
  text(ZONE.RIGHT, VAR.DATE, { x: 16, y: 102, w: PAGE_W - 32, h: 14 }, { fontSize: 7.5, color: '#8a6d4b' })
];

// ---- 模板定义 ----------------------------------------------------------
export const TEMPLATES = [
  {
    id: 'single-1',
    kind: TEMPLATE_KIND.SINGLE,
    name: '单图·图文对页',
    photoCount: 1,
    build() {
      return {
        photoSlots: [photo(ZONE.LEFT, { x: M, y: M, w: CW, h: 240 })],
        textSlots: footerTexts(namesDateR())
      };
    }
  },
  {
    id: 'single-2',
    kind: TEMPLATE_KIND.SINGLE,
    name: '单图·上图下文',
    photoCount: 1,
    build() {
      return {
        photoSlots: [photo(ZONE.LEFT, { x: M, y: M, w: CW, h: 150 })],
        textSlots: footerTexts([
          text(ZONE.LEFT, VAR.NAMES, { x: M, y: 168, w: CW, h: 20 }, { fontSize: 12 }),
          text(ZONE.LEFT, VAR.DATE, { x: M, y: 196, w: CW, h: 12 }, { fontSize: 7, color: '#8a6d4b' }),
          ...namesDateR()
        ])
      };
    }
  },
  {
    id: 'double-1',
    kind: TEMPLATE_KIND.DOUBLE,
    name: '双图·左右整版',
    photoCount: 2,
    build() {
      return {
        photoSlots: [
          photo(ZONE.LEFT, { x: M, y: M, w: CW, h: 240 }),
          photo(ZONE.RIGHT, { x: M, y: M, w: CW, h: 240 })
        ],
        textSlots: footerTexts()
      };
    }
  },
  {
    id: 'double-2',
    kind: TEMPLATE_KIND.DOUBLE,
    name: '双图·上下叠排',
    photoCount: 2,
    build() {
      const h = (240 - G) / 2;
      return {
        photoSlots: [
          photo(ZONE.LEFT, { x: M, y: M, w: CW, h }),
          photo(ZONE.LEFT, { x: M, y: M + h + G, w: CW, h })
        ],
        textSlots: footerTexts(namesDateR())
      };
    }
  },
  {
    id: 'double-3',
    kind: TEMPLATE_KIND.DOUBLE,
    name: '双图·大小错落',
    photoCount: 2,
    build() {
      return {
        photoSlots: [
          photo(ZONE.LEFT, { x: M, y: M, w: 118, h: 240 }),
          photo(ZONE.RIGHT, { x: M, y: M, w: CW, h: 120 })
        ],
        textSlots: footerTexts([
          text(ZONE.RIGHT, VAR.NAMES, { x: M, y: 140, w: CW, h: 20 }, { fontSize: 12 }),
          text(ZONE.RIGHT, VAR.DATE, { x: M, y: 168, w: CW, h: 12 }, { fontSize: 7, color: '#8a6d4b' })
        ])
      };
    }
  },
  {
    id: 'triple-1',
    kind: TEMPLATE_KIND.TRIPLE,
    name: '三图·一大两小',
    photoCount: 3,
    build() {
      return {
        photoSlots: [
          photo(ZONE.LEFT, { x: M, y: M, w: 118, h: 240 }),
          photo(ZONE.RIGHT, { x: M, y: M, w: CW, h: 118 }),
          photo(ZONE.RIGHT, { x: M, y: M + 118 + G, w: CW, h: 118 })
        ],
        textSlots: footerTexts()
      };
    }
  },
  {
    id: 'triple-2',
    kind: TEMPLATE_KIND.TRIPLE,
    name: '三图·三等竖排',
    photoCount: 3,
    build() {
      const h = (240 - G * 2) / 3;
      return {
        photoSlots: [
          photo(ZONE.LEFT, { x: M, y: M, w: CW, h }),
          photo(ZONE.LEFT, { x: M, y: M + (h + G), w: CW, h }),
          photo(ZONE.LEFT, { x: M, y: M + (h + G) * 2, w: CW, h })
        ],
        textSlots: footerTexts(namesDateR())
      };
    }
  },
  {
    id: 'banner-1',
    kind: TEMPLATE_KIND.BANNER,
    name: '通栏·全景跨页',
    photoCount: 1,
    build() {
      return {
        photoSlots: [photo(ZONE.SPREAD, null, { x1: M, x2: M, y: M, h: 232 })],
        textSlots: footerTexts([
          text(ZONE.LEFT, VAR.NAMES, { x: M, y: 248, w: 110, h: 14 }, { fontSize: 10, align: 'left' }),
          text(ZONE.RIGHT, VAR.DATE, { x: PAGE_W - M - 110, y: 250, w: 110, h: 12 }, { fontSize: 7, color: '#8a6d4b', align: 'right' })
        ])
      };
    }
  },
  {
    id: 'banner-2',
    kind: TEMPLATE_KIND.BANNER,
    name: '通栏·上图下字',
    photoCount: 1,
    build() {
      return {
        photoSlots: [photo(ZONE.SPREAD, null, { x1: M, x2: M, y: M, h: 128 })],
        textSlots: footerTexts([
          text(ZONE.LEFT, VAR.NAMES, { x: M, y: 152, w: CW, h: 20 }, { fontSize: 12 }),
          text(ZONE.LEFT, VAR.DATE, { x: M, y: 180, w: CW, h: 12 }, { fontSize: 7, color: '#8a6d4b' }),
          text(ZONE.RIGHT, VAR.NAMES, { x: M, y: 152, w: CW, h: 20 }, { fontSize: 12 }),
          text(ZONE.RIGHT, VAR.DATE, { x: M, y: 180, w: CW, h: 12 }, { fontSize: 7, color: '#8a6d4b' })
        ])
      };
    }
  }
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id);
}

/** 依据模板生成一个对开页（spread） */
export function instantiatePage(templateId) {
  const tpl = getTemplate(templateId);
  const built = tpl.build();
  return {
    id: uid('page'),
    templateId,
    photoSlots: built.photoSlots,
    textSlots: built.textSlots
  };
}

export function newAlbum() {
  const first = instantiatePage('single-1');
  const second = instantiatePage('double-1');
  return {
    version: 1,
    variables: { names: '张先生 & 李小姐', date: '2026.10.18' },
    gutter: 6,
    pages: [first, second]
  };
}

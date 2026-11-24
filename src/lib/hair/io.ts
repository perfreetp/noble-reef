import { bumpIdCounter, type HairBundle, type HairGroup } from './types';
import { model } from './model';
import { history } from './history';

/** 发型文件格式（.hairstyle.json） */
export interface HairstyleFile {
  format: 'hair-strand-style';
  version: 1;
  bundles: HairBundle[];
  groups: HairGroup[];
}

export function exportStyle(): string {
  const data: HairstyleFile = {
    format: 'hair-strand-style',
    version: 1,
    bundles: [...model.bundles.values()].map((b) => ({
      ...b,
      anchor: { position: [...b.anchor.position], normal: [...b.anchor.normal] },
      params: { ...b.params },
    })),
    groups: [...model.groups.values()].map((g) => ({ ...g, memberIds: [...g.memberIds] })),
  };
  return JSON.stringify(data, null, 2);
}

export function downloadStyle(filename = 'hairstyle.hairstyle.json'): void {
  const blob = new Blob([exportStyle()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export class StyleParseError extends Error {}

export function parseStyle(text: string): HairstyleFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StyleParseError('不是有效的 JSON 文件');
  }
  const f = raw as Partial<HairstyleFile>;
  if (f?.format !== 'hair-strand-style' || f.version !== 1) {
    throw new StyleParseError('不是可识别的发型文件（format/version 不匹配）');
  }
  if (!Array.isArray(f.bundles)) throw new StyleParseError('发型文件缺少 bundles');
  for (const b of f.bundles) {
    if (!b.id || !b.anchor || !b.params) throw new StyleParseError('发束数据不完整');
  }
  return {
    format: 'hair-strand-style',
    version: 1,
    bundles: f.bundles,
    groups: Array.isArray(f.groups) ? f.groups : [],
  };
}

/**
 * 载入发型文件：还原全部发束与分组。
 * 锚点直接取文件中的位置/法线（导出时即头皮表面数据），
 * 由调用方决定是否再用头皮重新吸附。
 */
export function loadStyle(file: HairstyleFile): void {
  model.restoreAll({ bundles: file.bundles, groups: file.groups });
  bumpIdCounter();
  // 载入作为新的历史起点
  history.clear();
}

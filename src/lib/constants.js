// 全局常量：页面尺寸、边距、间距、渲染参数
// 对开页相册：单页 200mm × 280mm（常见 12 寸竖版相册比例）
export const PAGE_W = 200;
export const PAGE_H = 280;
export const PAGE_MARGIN = 8;          // 页面安全边距 mm
export const DEFAULT_GUTTER = 6;       // 默认中缝留白 mm
export const MIN_GUTTER = 0;
export const MAX_GUTTER = 30;
export const MIN_SLOT_GAP = 4;         // 相邻槽位最小间距 mm
export const MIN_SLOT_SIZE = 20;       // 槽位最小边长 mm
export const PX_PER_MM = 2.5;          // 画布内部渲染精度
export const SNAP_DISTANCE = 6;        // 吸附距离 mm（文档坐标）
export const MAX_ZOOM_PHOTO = 6;       // 照片相对基础填充的最大放大倍数
export const HISTORY_LIMIT = 60;

// 模板槽位类型
export const SLOT = {
  PHOTO: 'photo',
  TEXT: 'text'
};

// 跨页区域
export const ZONE = {
  LEFT: 'L',
  RIGHT: 'R',
  SPREAD: 'S'   // 跨页通栏
};

// 文字变量
export const VAR = {
  NAMES: 'names',
  DATE: 'date',
  PAGE: 'page'
};

export const TEMPLATE_KIND = {
  SINGLE: 'single',
  DOUBLE: 'double',
  TRIPLE: 'triple',
  BANNER: 'banner'
};

// 相册文档版本号（导出文件用）
export const DOC_VERSION = 1;
export const STORAGE_DOC_KEY = 'wal:document';
export const DB_NAME = 'wedding-album-db';
export const DB_STORE = 'images';

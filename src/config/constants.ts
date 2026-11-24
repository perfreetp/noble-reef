/** 全局常量：地形、笔刷、步道、植被、历史等魔法数集中管理 */

export const GRID_SIZE = 256;
export const CELL_SIZE = 2; // 米 / 格
/** 地形世界尺寸（米），原点在中心 */
export const TERRAIN_EXTENT = (GRID_SIZE - 1) * CELL_SIZE; // 510

/** 笔刷半径三档（格） */
export const BRUSH_RADII = [6, 14, 28] as const;
/** 抬升/压低默认强度（米/秒） */
export const BRUSH_STRENGTH_DEFAULT = 14;
export const BRUSH_STRENGTH_MIN = 2;
export const BRUSH_STRENGTH_MAX = 40;
/** 平滑笔刷混合系数 0..1 */
export const SMOOTH_FACTOR_DEFAULT = 0.35;
/** 单帧笔刷作用时长上限（秒），避免掉帧后高度跳变 */
export const BRUSH_MAX_DT = 1 / 30;

/** 步道最大允许坡度 */
export const SLOPE_LIMIT_DEG = 12;
export const TAN_SLOPE_LIMIT = Math.tan((SLOPE_LIMIT_DEG * Math.PI) / 180);

/** 步道采样间距（米，等弧长） */
export const PATH_SAMPLE_SPACING = 2;
/** 路面贴地偏移（防 z-fighting） */
export const PATH_SURFACE_OFFSET = 0.08;
export const PATH_WIDTH_DEFAULT = 2.4;
export const RAIL_HEIGHT_DEFAULT = 1.1;
/** 护栏立柱间距（米） */
export const RAIL_POST_INTERVAL = 3;
/** 护坡外侧偏移（米） */
export const SKIRT_OFFSET = 0.6;
/** Catmull-Rom 每控制点间细分数（建弧长表用） */
export const PATH_SUBDIV_PER_SEGMENT = 32;

/** 植被目标实例总数（树 + 灌木） */
export const VEG_TARGET = 4000;
export const VEG_TREE_RATIO = 0.6;
export const VEG_MAX_SLOPE_DEG = 30;
export const VEG_REBUILD_DEBOUNCE_MS = 200;

/** 撤销重做上限 */
export const HISTORY_LIMIT = 20;

/** 漫游播放 */
export const TOUR_PROGRESS_UI_INTERVAL_MS = 100;
export const TOUR_FP_EYE_HEIGHT = 1.7;
export const TOUR_TOP_HEIGHT = 35;
export const TOUR_TOP_BACK = 12;
export const TOUR_TOP_PITCH_DEG = 55;

/** 序列化 */
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
export const BASE64_CHUNK = 8192;

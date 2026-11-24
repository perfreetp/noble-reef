import { createStore } from 'solid-js/store';

export const DEFAULT_STATE = {
  date: 100,        // 年内第几天(2026 年)
  time: 21.5,       // 时刻(小时,UTC)
  latitude: 39.9,   // 观测纬度
  projection: 'spherical', // spherical | equirect
  milkyWay: 1,      // 银河强度档位 0/1/2
  layers: {
    stars: true,
    constellations: true,
    horizon: true,
    milkyway: true,
  },
};

export const [sky, setSky] = createStore(structuredClone(DEFAULT_STATE));

/** 导出当前天象状态为 JSON 文件 */
export function exportState() {
  const data = {
    version: 1,
    date: sky.date,
    time: Math.round(sky.time * 100) / 100,
    latitude: sky.latitude,
    projection: sky.projection,
    milkyWay: sky.milkyWay,
    layers: { ...sky.layers },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'skydome-state.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 从 JSON 文本导入并还原天象状态,返回错误信息或 null */
export function importState(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return '不是有效的 JSON 文件';
  }
  if (typeof d !== 'object' || d === null) return 'JSON 内容不是对象';
  const num = (v, lo, hi, fallback) =>
    typeof v === 'number' && isFinite(v)
      ? Math.min(hi, Math.max(lo, v))
      : fallback;

  setSky({
    date: Math.round(num(d.date, 1, 365, DEFAULT_STATE.date)),
    time: num(d.time, 0, 24, DEFAULT_STATE.time),
    latitude: num(d.latitude, -90, 90, DEFAULT_STATE.latitude),
    projection: d.projection === 'equirect' ? 'equirect' : 'spherical',
    milkyWay: Math.round(num(d.milkyWay, 0, 2, DEFAULT_STATE.milkyWay)),
    layers: {
      stars: d.layers?.stars !== false,
      constellations: d.layers?.constellations !== false,
      horizon: d.layers?.horizon !== false,
      milkyway: d.layers?.milkyway !== false,
    },
  });
  return null;
}

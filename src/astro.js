// 天文坐标与恒星时换算
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

/** 赤经(小时) 赤纬(度) -> 单位方向向量 [x,y,z]。+Y 为北天极方向。 */
export function raDecToDir(raHours, decDeg, out = [0, 0, 0]) {
  const ra = raHours * 15 * D2R;
  const dec = decDeg * D2R;
  const c = Math.cos(dec);
  out[0] = c * Math.cos(ra);
  out[1] = Math.sin(dec);
  out[2] = -c * Math.sin(ra);
  return out;
}

/** JS Date -> 儒略日 */
export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** 格林尼治平恒星时(弧度) */
export function gmstRadians(date) {
  const jd = julianDate(date);
  const T = (jd - 2451545.0) / 36525;
  let g =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  g = ((g % 360) + 360) % 360;
  return g * D2R;
}

/** 由界面状态(年内第几天 + 时刻小时)构造 UTC Date(经度取 0°,LST=GMST) */
export function stateToDate(dayOfYear, timeHours) {
  const base = Date.UTC(2026, 0, 1);
  return new Date(base + (dayOfYear - 1) * 86400000 + timeHours * 3600000);
}

/** 年内第几天 -> "M月D日" */
export function formatDay(dayOfYear) {
  const d = new Date(Date.UTC(2026, 0, 1) + (dayOfYear - 1) * 86400000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export function formatTime(hours) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

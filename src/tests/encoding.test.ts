import { describe, it, expect } from 'vitest';
import { float32ToBase64, base64ToFloat32 } from '../io/encoding';

describe('Float32 base64 编解码', () => {
  it('65536 长度随机数据 bit 级往返一致', () => {
    const data = new Float32Array(256 * 256);
    let s = 12345;
    for (let i = 0; i < data.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (s / 0x7fffffff) * 100 - 50;
    }
    const b64 = float32ToBase64(data);
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(80000);
    const back = base64ToFloat32(b64);
    expect(back.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) expect(back[i]).toBe(data[i]);
  });

  it('非 4 倍数长度解码抛错', () => {
    const bad = btoa('abc'); // 3 字节
    expect(() => base64ToFloat32(bad)).toThrow();
  });

  it('包含 NaN/Infinity 也能字节级往返', () => {
    const data = new Float32Array([NaN, Infinity, -Infinity, -0]);
    const back = base64ToFloat32(float32ToBase64(data));
    expect(Number.isNaN(back[0]!)).toBe(true);
    expect(back[1]).toBe(Infinity);
    expect(back[2]).toBe(-Infinity);
    expect(Object.is(back[3], -0)).toBe(true);
  });
});

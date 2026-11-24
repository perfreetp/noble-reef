import { describe, it, expect } from 'vitest';
import { validateProjectDto } from '../io/validate';
import { float32ToBase64 } from '../io/encoding';
import { SCHEMA_VERSION } from '../config/constants';
import type { ProjectDTO } from '../types/project';

const makeDto = (overrides: Partial<ProjectDTO> = {}): ProjectDTO => ({
  schemaVersion: SCHEMA_VERSION,
  appVersion: '1.0.0',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  terrain: {
    size: 4,
    cellSize: 2,
    encoding: 'f32-le-base64',
    data: float32ToBase64(new Float32Array(16)),
  },
  vegetation: {
    seed: 1,
    treeDensity: 0.6,
    shrubDensity: 0.4,
    rules: { maxSlopeDeg: 30, minAltitude: 2, maxAltitude: 80 },
  },
  paths: [],
  facilities: [],
  viewpoints: [],
  ...overrides,
});

describe('DTO 校验', () => {
  it('合法 DTO 通过', () => {
    expect(validateProjectDto(makeDto()).ok).toBe(true);
  });

  it('非对象报错', () => {
    expect(validateProjectDto('nope').ok).toBe(false);
    expect(validateProjectDto(null).errors[0]).toContain('JSON');
  });

  it('缺 terrain 字段报错', () => {
    const dto = makeDto();
    delete (dto as Partial<ProjectDTO>).terrain;
    expect(validateProjectDto(dto).ok).toBe(false);
  });

  it('高版本 schema 报错并提示升级', () => {
    const r = validateProjectDto(makeDto({ schemaVersion: 999 }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('升级');
  });

  it('非法设施类型报错', () => {
    const dto = makeDto({
      facilities: [
        {
          id: 'f1',
          type: 'rollercoaster' as never,
          x: 0,
          z: 0,
          rotation: 0,
          footprint: { shape: 'circle', radius: 5 },
          baseHeight: 1,
        },
      ],
    });
    const r = validateProjectDto(dto);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('类型非法'))).toBe(true);
  });

  it('t 越界与 mode 非法报错', () => {
    const dto = makeDto({
      paths: [{ id: 'p1', name: 'p', style: { width: 2, color: 0, railHeight: 1, hasWall: true, hasRail: true }, controlPoints: [] }],
      viewpoints: [
        { id: 'v1', pathId: 'p1', t: 1.5, eyeHeight: 1.7, mode: 'fp', durationSec: 4 },
        { id: 'v2', pathId: 'p1', t: 0.2, eyeHeight: 1.7, mode: 'vr' as never, durationSec: 4 },
      ],
    });
    const r = validateProjectDto(dto);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('悬空 pathId 产生告警而非错误', () => {
    const dto = makeDto({
      viewpoints: [{ id: 'v1', pathId: 'ghost', t: 0, eyeHeight: 1.7, mode: 'fp', durationSec: 4 }],
    });
    const r = validateProjectDto(dto);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('不存在'))).toBe(true);
  });
});

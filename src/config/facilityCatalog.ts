import { SLOPE_LIMIT_DEG, TAN_SLOPE_LIMIT } from './constants';
import type { FacilityType, Footprint } from '../types/project';

export interface FacilityCatalogEntry {
  type: FacilityType;
  name: string;
  description: string;
  color: number;
  footprint: Footprint;
  /** 整平 blend 环宽（格），0 表示运行时按半径推导 */
  blendCells: number;
}

/** 设施库：观景台、缆车站、售卖亭 */
export const FACILITY_CATALOG: FacilityCatalogEntry[] = [
  {
    type: 'observation',
    name: '观景台',
    description: '架空环形观景平台，占地半径 12 米',
    color: 0x4a7fb5,
    footprint: { shape: 'circle', radius: 12 },
    blendCells: 0,
  },
  {
    type: 'cable',
    name: '缆车站',
    description: '缆车始发站房，矩形占地 18×12 米',
    color: 0xb5654a,
    footprint: { shape: 'rect', w: 18, d: 12 },
    blendCells: 0,
  },
  {
    type: 'kiosk',
    name: '售卖亭',
    description: '小型零售亭，占地半径 5 米',
    color: 0x7aa857,
    footprint: { shape: 'circle', radius: 5 },
    blendCells: 0,
  },
];

export const getCatalogEntry = (type: FacilityType): FacilityCatalogEntry =>
  FACILITY_CATALOG.find((f) => f.type === type) ?? FACILITY_CATALOG[0]!;

export const slopeLimitInfo = {
  deg: SLOPE_LIMIT_DEG,
  tan: TAN_SLOPE_LIMIT,
};

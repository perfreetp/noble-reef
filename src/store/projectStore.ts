import { createStore } from 'solid-js/store';
import type { ProjectState, TerrainState } from '../types/project';
import { CELL_SIZE, GRID_SIZE, VEG_TREE_RATIO } from '../config/constants';
import { generateMountainTerrain } from '../engine/terrain/noise';

export const createInitialProject = (seed?: number): ProjectState => {
  const actualSeed = seed ?? (Date.now() ^ 0x9e3779b9) >>> 0;
  const { heights } = generateMountainTerrain(GRID_SIZE, actualSeed);
  const terrain: TerrainState = {
    size: GRID_SIZE,
    cellSize: CELL_SIZE,
    heights,
    revision: 0,
  };
  return {
    terrain,
    pathOrder: [],
    paths: {},
    facilityOrder: [],
    facilities: {},
    viewpoints: [],
    vegetation: {
      seed: actualSeed,
      treeDensity: VEG_TREE_RATIO,
      shrubDensity: 1 - VEG_TREE_RATIO,
      rules: { maxSlopeDeg: 30, minAltitude: 2, maxAltitude: 80 },
    },
  };
};

/** 全局工程 store（单例，由 main 初始化一次） */
export const [projectStore, setProjectStore] = createStore<ProjectState>(createInitialProject());

import type { ProjectDTO } from '../types/project';

/**
 * 版本迁移链：MIGRATIONS[n] 把 schemaVersion n 升级到 n+1。
 * 当前为 v1，预留链式机制；后续升版在此追加纯函数迁移。
 */
export const MIGRATIONS: Array<(dto: unknown) => ProjectDTO> = [];

export const CURRENT_MIGRATION_COUNT = 1;

export const migrate = (dto: ProjectDTO): ProjectDTO => {
  let current = dto;
  while (current.schemaVersion < CURRENT_MIGRATION_COUNT) {
    const fn = MIGRATIONS[current.schemaVersion];
    if (!fn) break;
    current = fn(current);
  }
  return current;
};

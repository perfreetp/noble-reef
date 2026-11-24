import type { Scalp } from '../hair/scalp';

/** 视口创建后登记的共享对象（供演示发量生成等使用） */
export const shared: { scalp: Scalp | null } = { scalp: null };

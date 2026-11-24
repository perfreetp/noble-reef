export interface Atom {
  element: string;
  x: number;
  y: number;
  z: number;
  name?: string;
  serial?: number;
}

export interface Bond {
  a: number;
  b: number;
  /** 1 单键 2 双键 3 三键 */
  order: number;
}

export interface Molecule {
  id: string;
  name: string;
  atoms: Atom[];
  bonds: Bond[];
}

export type DisplayMode = "ballstick" | "spacefill";

export type ColorScheme = { type: "cpk" } | { type: "custom"; color: string };

export interface ClipSettings {
  enabled: boolean;
  yaw: number;   // 法线方位角（度）
  pitch: number; // 法线俯仰角（度）
  d: number;     // 平面沿法线方向的位置
}

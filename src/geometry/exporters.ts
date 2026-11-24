import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { PieceStats } from '../types';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportGeometryAsSTL(geometry: THREE.BufferGeometry, filename: string) {
  const exporter = new STLExporter();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  const result = exporter.parse(mesh, { binary: true }) as DataView;
  const bytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  const blob = new Blob([bytes as BlobPart], { type: 'model/stl' });
  downloadBlob(blob, filename);
}

export function exportBillOfMaterialsCsv(stats: PieceStats[], meta: { modelName: string; tenonCount: number; wallThickness: number }) {
  const rows = [
    ['手办分件清单'],
    ['模型', meta.modelName],
    ['榫卯总数', String(meta.tenonCount)],
    ['壳厚(mm)', String(meta.wallThickness)],
    [],
    ['片件', '三角面', '体积(mm³)', '体积(cm³)', '定位柱', '凹槽', '封口状态'],
    ...stats.map((s) => [
      s.name,
      String(s.triangles),
      s.volumeMm3.toFixed(1),
      s.volumeCm3.toFixed(2),
      String(s.tenons),
      String(s.sockets),
      s.watertight ? '已封口' : '需检查',
    ]),
  ];
  const csv = '﻿' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${meta.modelName}-分件清单.csv`);
}

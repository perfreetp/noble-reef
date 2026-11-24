/**
 * File exports: project JSON, STL, glTF, and the collision manifest + OBJ.
 * Kept out of main.js so the DOM-free geometry/serialization logic stays testable.
 */

const NL = String.fromCharCode(10);

export function buildCollisionExport(doc, payload) {
  const colliders = [];
  let vertexOffset = 1; // OBJ indices are 1-based across the whole file
  let faceOffset = 1;
  const objParts = [];
  const safeName = String(doc.name || '').replace(/[\r\n]+/g, ' ');
  const header = [
    '# GRIND skatepark collision mesh',
    '# source: ' + safeName,
    '# units: metres, up: +Y, right-handed',
    '# generated: ' + new Date().toISOString(),
    '',
  ].join(NL);
  objParts.push(header);

  for (const chunk of payload.chunks) {
    const isGroup = Boolean(chunk.isGroup);
    const group = isGroup ? doc.groups.find((g) => g.id === chunk.id) : null;
    const el = !isGroup ? doc.elements.find((e) => e.id === chunk.id) : null;
    if (!isGroup && !el) continue;

    const name = `collider_${colliders.length + 1}`;
    const pos = chunk.positions;
    const norm = chunk.normals;
    const idx = chunk.indices;
    const vertCount = pos.length / 3;
    const triCount = idx.length / 3;

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const lines = [`o ${name}`];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = pos[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
      lines.push(`v ${pos[i].toFixed(5)} ${pos[i + 1].toFixed(5)} ${pos[i + 2].toFixed(5)}`);
    }
    for (let i = 0; i < norm.length; i += 3) {
      lines.push(`vn ${norm[i].toFixed(4)} ${norm[i + 1].toFixed(4)} ${norm[i + 2].toFixed(4)}`);
    }
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] + vertexOffset;
      const b = idx[i + 1] + vertexOffset;
      const c = idx[i + 2] + vertexOffset;
      const na = idx[i] + 1;
      const nb = idx[i + 1] + 1;
      const nc = idx[i + 2] + 1;
      lines.push(`f ${a}//${na} ${b}//${nb} ${c}//${nc}`);
    }
    objParts.push(lines.join(NL) + NL);

    const info = isGroup ? payload.groupInfo?.[chunk.id] : null;
    colliders.push({
      name,
      id: chunk.id,
      label: group ? docGroupLabel(doc, group) : el.name || el.type,
      kind: isGroup ? 'merged' : 'element',
      type: el ? el.type : 'group',
      params: el ? { ...el.params } : null,
      elementIds: group ? [...group.members] : [chunk.id],
      cutterIds: group ? [...group.cutters] : [],
      transform: isGroup ? null : { position: [...el.position], rotationY: el.rotationY || 0 },
      manifold: isGroup ? info?.status === 'NoError' : true,
      genus: info ? info.genus : null,
      volume: info ? Math.round(info.volume * 1e4) / 1e4 : null,
      vertexCount: vertCount,
      triangleCount: triCount,
      obj: { vertexStart: vertexOffset, faceStart: faceOffset },
      bounds: {
        min: min.map((v) => Math.round(v * 1e4) / 1e4),
        max: max.map((v) => Math.round(v * 1e4) / 1e4),
      },
    });
    vertexOffset += vertCount;
    faceOffset += triCount;
  }

  const json = {
    format: 'grind.collision',
    version: 1,
    generatedAt: new Date().toISOString(),
    units: 'm',
    up: 'Y',
    handedness: 'right',
    note: 'Triangles are CCW seen from outside the solid; every collider is a closed manifold. The OBJ shares these vertices - slice with obj.vertexStart/faceStart.',
    source: { name: doc.name, elements: doc.elements.length, groups: doc.groups.length },
    totals: {
      colliders: colliders.length,
      vertices: vertexOffset - 1,
      triangles: faceOffset - 1,
    },
    colliders,
  };
  return { json, obj: objParts.join(NL) };
}

function docGroupLabel(doc, group) {
  if (group.name) return group.name;
  const names = group.members.map((id) => {
    const el = doc.elements.find((e) => e.id === id);
    return el ? el.name || el.type : '?';
  });
  return names.slice(0, 2).join(' + ') + (names.length > 2 ? ` 等 ${names.length} 件` : '');
}

/** OBJ text for the park's merged solids (STL alternative with normals). */
export function buildObjExport(payload, docName) {
  const parts = [
    '# GRIND skatepark solids',
    '# source: ' + String(docName || '').replace(/[\r\n]+/g, ' '),
    '# units: metres, up: +Y',
    '',
  ];
  let offset = 1;
  for (const chunk of payload.chunks) {
    const name = chunk.isGroup ? `merged_${chunk.id}` : `element_${chunk.id}`;
    parts.push(`o ${name}`);
    const pos = chunk.positions;
    for (let i = 0; i < pos.length; i += 3) {
      parts.push(`v ${pos[i].toFixed(5)} ${pos[i + 1].toFixed(5)} ${pos[i + 2].toFixed(5)}`);
    }
    const idx = chunk.indices;
    for (let i = 0; i < idx.length; i += 3) {
      parts.push(`f ${idx[i] + offset} ${idx[i + 1] + offset} ${idx[i + 2] + offset}`);
    }
    offset += pos.length / 3;
  }
  return parts.join(NL) + NL;
}

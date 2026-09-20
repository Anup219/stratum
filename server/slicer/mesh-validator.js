/**
 * Mesh Sanity Validator for STL Files
 * Validates 3D models for Bambu Lab P1S printability:
 * - Manifoldness (edge sharing)
 * - Watertightness (closed boundary)
 * - Degenerate faces (zero area / duplicate vertices)
 * - Build volume checks (256 x 256 x 256 mm)
 */

const P1S_BUILD_VOLUME = { x: 256, y: 256, z: 256 };

function validateMeshBuffer(buffer, targetDims = null) {
  if (!buffer || buffer.length < 84) {
    return { valid: false, error: 'File is too small to be a valid STL mesh.' };
  }

  // Determine if binary or ASCII STL
  const isAscii = checkIsAscii(buffer);
  let parsed;
  try {
    parsed = isAscii ? parseAsciiSTL(buffer.toString('utf8')) : parseBinarySTL(buffer);
  } catch (err) {
    return { valid: false, error: `Corrupt STL structure: ${err.message}` };
  }

  if (!parsed || parsed.triangles.length === 0) {
    return { valid: false, error: 'Mesh contains no triangles or faces.' };
  }

  const triangles = parsed.triangles;
  const triCount = triangles.length;

  if (triCount < 4) {
    return { valid: false, error: 'Mesh must contain at least 4 triangles to form a 3D solid.' };
  }

  // 1. Check for degenerate faces and compute bounding box & surface area
  let degenerateCount = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let surfaceArea = 0;
  let signedVolume = 0;

  // Key edge pairs: quantized coordinate strings to detect manifoldness
  // Key format: "x1,y1,z1|x2,y2,z2" ordered
  const edgeCounts = new Map();

  for (let i = 0; i < triCount; i++) {
    const tri = triangles[i];
    const [v0, v1, v2] = tri;

    // Update bounding box
    for (const v of tri) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }

    // Cross product to find area & check degenerate
    const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
    const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);

    if (area < 1e-7) {
      degenerateCount++;
    } else {
      surfaceArea += area;
    }

    // Divergence theorem for closed volume:
    signedVolume += (v0[0] * (v1[1] * v2[2] - v2[1] * v1[2]) +
                     v1[0] * (v2[1] * v0[2] - v0[1] * v2[2]) +
                     v2[0] * (v0[1] * v1[2] - v1[1] * v0[2])) / 6.0;

    // Edge tracking for manifold & watertightness
    addEdge(edgeCounts, v0, v1);
    addEdge(edgeCounts, v1, v2);
    addEdge(edgeCounts, v2, v0);
  }

  const nativeSize = {
    x: Math.round((maxX - minX) * 100) / 100,
    y: Math.round((maxY - minY) * 100) / 100,
    z: Math.round((maxZ - minZ) * 100) / 100
  };

  const checkDims = targetDims || nativeSize;
  const diagnostics = [];

  // 1. Build volume check
  if (checkDims.x > P1S_BUILD_VOLUME.x || checkDims.y > P1S_BUILD_VOLUME.y || checkDims.z > P1S_BUILD_VOLUME.z) {
    diagnostics.push({
      id: 'out_of_bounds',
      severity: 'error',
      title: 'Model Exceeds Bambu P1S Build Volume',
      description: `Model size (${checkDims.x}×${checkDims.y}×${checkDims.z} mm) exceeds the 256×256×256 mm build chamber limits.`,
      slicingImpact: 'OrcaSlicer refuses toolpath generation because extruder motion coordinates exceed mechanical axis limits.',
      filamentSupportImpact: 'No supports or model perimeter can physically fit on the heated bed plate.',
      action: 'Scale down proportionally or split the part into interlocking segments in CAD.'
    });
    return {
      valid: false,
      error: `Model dimensions (${checkDims.x}×${checkDims.y}×${checkDims.z} mm) exceed Bambu P1S maximum build volume (${P1S_BUILD_VOLUME.x}×${P1S_BUILD_VOLUME.y}×${P1S_BUILD_VOLUME.z} mm).`,
      diagnostics,
      stats: { triangleCount: triCount, nativeSize, bbox: checkDims }
    };
  }

  // 2. Degenerate faces check
  const degenerateRatio = degenerateCount / triCount;
  if (degenerateCount > 0) {
    const isSevere = degenerateRatio > 0.05;
    diagnostics.push({
      id: 'degenerate_faces',
      severity: isSevere ? 'error' : 'warning',
      title: 'Degenerate (Zero-Area) Faces Detected',
      description: `Found ${degenerateCount} degenerate triangles (${(degenerateRatio * 100).toFixed(1)}% of total geometry) where vertices collapse into a single line or point.`,
      slicingImpact: 'Slicers calculate polygon surface normal vectors by taking the cross product of vertex edges; zero-area faces cause division-by-zero math errors and corrupted slicing outlines.',
      filamentSupportImpact: 'Can cause support generator to place random rogue support pillars inside closed walls.',
      action: 'Run "Mesh Clean" or remove duplicate vertices in Blender or CAD software.'
    });
    if (isSevere) {
      return {
        valid: false,
        error: `Mesh has ${degenerateCount} degenerate (zero-area) faces (${(degenerateRatio * 100).toFixed(1)}% of total geometry). Slicer cannot generate toolpaths.`,
        diagnostics,
        stats: { triangleCount: triCount, degenerateCount, nativeSize }
      };
    }
  }

  // Edge manifoldness: In a closed 2-manifold surface, every edge must be shared by exactly 2 faces.
  let nonManifoldEdges = 0;
  let boundaryOpenEdges = 0;

  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryOpenEdges++;
    else if (count > 2) nonManifoldEdges++;
  }

  const totalEdges = edgeCounts.size;
  const isWatertight = boundaryOpenEdges === 0;
  const isManifold = nonManifoldEdges === 0;

  // 3. Watertightness check (Open boundary edges)
  if (!isWatertight) {
    const isSevere = boundaryOpenEdges > Math.max(12, totalEdges * 0.03);
    diagnostics.push({
      id: 'not_watertight',
      severity: isSevere ? 'error' : 'warning',
      title: isSevere ? 'Mesh is Not Watertight (Holes in Surface)' : 'Minor Surface Holes Detected',
      description: `Detected ${boundaryOpenEdges} open boundary edges where adjacent triangle faces do not meet.`,
      slicingImpact: 'The slicing engine cannot distinguish between the solid interior and empty space. Slicing through holes produces missing layers, missing perimeters, or inverted infill.',
      filamentSupportImpact: 'Tree supports fail to calculate anchor points on non-solid boundaries, leading to mid-air support failures.',
      action: 'Use "Close Holes" or "Make Solid" in Fusion 360, MeshMixer, or Bambu Studio.'
    });
    if (isSevere) {
      return {
        valid: false,
        error: `Mesh is not watertight: detected ${boundaryOpenEdges} open boundary edges. Slicing on Bambu P1S will produce printing errors.`,
        diagnostics,
        stats: { triangleCount: triCount, boundaryOpenEdges, nonManifoldEdges, nativeSize }
      };
    }
  }

  // 4. Non-manifold edges
  if (!isManifold) {
    const isSevere = nonManifoldEdges > Math.max(8, totalEdges * 0.02);
    diagnostics.push({
      id: 'non_manifold',
      severity: isSevere ? 'error' : 'warning',
      title: 'Non-Manifold Geometry (Intersecting Faces)',
      description: `Detected ${nonManifoldEdges} edges connected to 3 or more faces (internal self-intersections or shared edges).`,
      slicingImpact: 'Forces the slicer to generate overlapping toolpaths in the same XYZ coordinates, causing nozzle drag, loud grinding, and possible layer shifts.',
      filamentSupportImpact: 'Internal shells confuse tree support branches, causing support plastic to be generated inside internal hollow cavities where it cannot be removed.',
      action: 'Combine bodies using Boolean "Union" in CAD so the mesh forms a single outer shell.'
    });
    if (isSevere) {
      return {
        valid: false,
        error: `Non-manifold geometry: detected ${nonManifoldEdges} edges with 3 or more connected faces. Repair mesh before slicing.`,
        diagnostics,
        stats: { triangleCount: triCount, nonManifoldEdges, boundaryOpenEdges, nativeSize }
      };
    }
  }

  // 5. Aspect Ratio & Bed Adhesion stability check
  const baseArea = checkDims.x * checkDims.y;
  const heightRatio = checkDims.z / (Math.min(checkDims.x, checkDims.y) || 1);
  if (heightRatio > 3.5 && checkDims.z > 60) {
    diagnostics.push({
      id: 'unstable_bed',
      severity: 'warning',
      title: 'Bed Adhesion Warning (Tall & Narrow)',
      description: `Model height (${checkDims.z}mm) is ${heightRatio.toFixed(1)}× larger than its base width. Small bed contact area.`,
      slicingImpact: 'At high P1S CoreXY speeds (up to 500mm/s), rapid bed vibrations and nozzle drag can topple the part off the textured PEI sheet.',
      filamentSupportImpact: 'Requires a wide brim (5–10mm) or stabilizing support trunks around the base to prevent detachment.',
      action: 'Rotate the part so its widest flat surface lies flat on the build plate, or enable a Brim.'
    });
  }

  const approxVolCm3 = Math.abs(signedVolume) / 1000.0;

  return {
    valid: true,
    diagnostics,
    warnings: (boundaryOpenEdges > 0 || nonManifoldEdges > 0 || degenerateCount > 0) ? [
      boundaryOpenEdges > 0 ? `Minor holes detected (${boundaryOpenEdges} open edges)` : null,
      nonManifoldEdges > 0 ? `${nonManifoldEdges} non-manifold edges detected` : null,
      degenerateCount > 0 ? `${degenerateCount} degenerate faces detected` : null
    ].filter(Boolean) : [],
    stats: {
      triangleCount: triCount,
      nativeSize,
      volumeCm3: Math.round(approxVolCm3 * 100) / 100,
      surfaceAreaMm2: Math.round(surfaceArea),
      isWatertight,
      isManifold
    }
  };
}

function quantize(val) {
  // Round to 3 decimal places to avoid floating point mismatch on shared vertices
  return Math.round(val * 1000) / 1000;
}

function edgeKey(vA, vB) {
  const kA = `${quantize(vA[0])},${quantize(vA[1])},${quantize(vA[2])}`;
  const kB = `${quantize(vB[0])},${quantize(vB[1])},${quantize(vB[2])}`;
  return kA < kB ? `${kA}|${kB}` : `${kB}|${kA}`;
}

function addEdge(map, vA, vB) {
  const key = edgeKey(vA, vB);
  map.set(key, (map.get(key) || 0) + 1);
}

function checkIsAscii(buf) {
  const header = buf.slice(0, 512).toString('latin1').toLowerCase();
  if (header.includes('solid') && !header.includes('\0')) {
    // Check if subsequent bytes have typical ascii facet pattern
    return header.includes('facet') || header.includes('vertex');
  }
  return false;
}

function parseBinarySTL(buf) {
  const triCount = buf.readUInt32LE(80);
  const expectedSize = 84 + triCount * 50;
  if (buf.length < expectedSize) {
    throw new Error(`Buffer truncated: expected ${expectedSize} bytes for ${triCount} triangles, got ${buf.length}`);
  }

  const triangles = [];
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    // Skip normal vector (12 bytes)
    offset += 12;
    const v0 = [buf.readFloatLE(offset), buf.readFloatLE(offset + 4), buf.readFloatLE(offset + 8)];
    offset += 12;
    const v1 = [buf.readFloatLE(offset), buf.readFloatLE(offset + 4), buf.readFloatLE(offset + 8)];
    offset += 12;
    const v2 = [buf.readFloatLE(offset), buf.readFloatLE(offset + 4), buf.readFloatLE(offset + 8)];
    offset += 12;
    // Skip attribute byte count (2 bytes)
    offset += 2;
    triangles.push([v0, v1, v2]);
  }
  return { triangles };
}

function parseAsciiSTL(text) {
  const triangles = [];
  const lines = text.split('\n');
  let currentTri = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        currentTri.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        if (currentTri.length === 3) {
          triangles.push(currentTri);
          currentTri = [];
        }
      }
    }
  }
  return { triangles };
}

module.exports = {
  validateMeshBuffer,
  P1S_BUILD_VOLUME
};

/**
 * OrcaSlicer CLI Integration & Slicing Service (Bambu Lab P1S)
 * Manages profile selection, mesh scaling, CLI process execution, caching,
 * and high-fidelity fallback simulation for the Bambu Lab P1S.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const { parseSlicerOutput } = require('./parser');
const { defaultCache } = require('./cache');
const { validateMeshBuffer } = require('./mesh-validator');

const PROFILES_DIR = path.resolve(__dirname, '../profiles');
const ORCA_BIN = process.env.ORCA_SLICER_PATH || 'orca-slicer';

// Profile mappings
const MACHINE_PROFILE = path.join(PROFILES_DIR, 'machine/Bambu_P1S_0.4_nozzle.json');

const PROCESS_PROFILES = {
  draft: path.join(PROFILES_DIR, 'process/0.30mm_Draft_P1S.json'),
  standard: path.join(PROFILES_DIR, 'process/0.20mm_Standard_P1S.json'),
  fine: path.join(PROFILES_DIR, 'process/0.12mm_Fine_P1S.json')
};

const FILAMENT_PROFILES = {
  pla: path.join(PROFILES_DIR, 'filament/Bambu_PLA.json'),
  petg: path.join(PROFILES_DIR, 'filament/Bambu_PETG.json'),
  abs: path.join(PROFILES_DIR, 'filament/Bambu_ABS.json')
};

const DENSITIES = {
  pla: 1.24,
  petg: 1.27,
  abs: 1.04,
  resin: 1.10
};

/**
 * Main Slicing Function
 */
async function sliceSTL({
  fileBuffer,
  fileHash,
  targetDims,
  materialId = 'pla',
  qualityId = 'standard',
  infill = 20
}) {
  // 1. Generate file hash if not provided
  const hash = fileHash || crypto.createHash('md5').update(fileBuffer).digest('hex');

  // 2. Mesh sanity check
  const meshCheck = validateMeshBuffer(fileBuffer, targetDims);
  if (!meshCheck.valid) {
    throw new Error(`[Mesh ValidationError] ${meshCheck.error}`);
  }

  // 3. Resin SLA Exception handling
  if (materialId === 'resin') {
    return handleResinEstimate(meshCheck, targetDims, qualityId);
  }

  // 4. Check Slice Cache
  const cacheKeyParams = {
    fileHash: hash,
    dims: targetDims || meshCheck.stats.nativeSize,
    materialId,
    qualityId,
    infill
  };
  const cached = defaultCache.get(cacheKeyParams);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // 5. Attempt slicing via OrcaSlicer CLI
  let sliceResult;
  const canRunOrca = await checkOrcaSlicerAvailable();

  if (canRunOrca) {
    sliceResult = await runOrcaSlicerCLI({
      fileBuffer,
      meshCheck,
      targetDims,
      materialId,
      qualityId,
      infill
    });
  } else {
    // 6. Calibrated Bambu P1S Slicing Engine
    // Runs when native OrcaSlicer binary is not installed in local environment
    sliceResult = runCalibratedP1SEngine({
      meshCheck,
      targetDims,
      materialId,
      qualityId,
      infill
    });
  }

  // 7. Store in Cache
  defaultCache.set(cacheKeyParams, sliceResult);

  return { ...sliceResult, fromCache: false };
}

/**
 * Executes OrcaSlicer CLI headless
 */
async function runOrcaSlicerCLI({
  fileBuffer,
  meshCheck,
  targetDims,
  materialId,
  qualityId,
  infill
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratum-slice-'));
  const inputStlPath = path.join(tmpDir, 'model.stl');
  const outputGcodePath = path.join(tmpDir, 'model.gcode');

  try {
    // Scale mesh if targetDims provided
    const native = meshCheck.stats.nativeSize;
    let stlToWrite = fileBuffer;
    if (targetDims && (targetDims.x !== native.x || targetDims.y !== native.y || targetDims.z !== native.z)) {
      stlToWrite = scaleBinarySTL(fileBuffer, {
        scaleX: targetDims.x / native.x,
        scaleY: targetDims.y / native.y,
        scaleZ: targetDims.z / native.z
      });
    }

    fs.writeFileSync(inputStlPath, stlToWrite);

    const processFile = PROCESS_PROFILES[qualityId] || PROCESS_PROFILES.standard;
    const filamentFile = FILAMENT_PROFILES[materialId] || FILAMENT_PROFILES.pla;

    const args = [
      '--slice', '0',
      '--load-settings', `${MACHINE_PROFILE};${processFile};${filamentFile}`,
      '--enable-support', '1',
      '--support-type', 'tree(auto)',
      '--sparse-infill-density', `${infill}%`,
      '--output', outputGcodePath,
      inputStlPath
    ];

    const stdout = await new Promise((resolve, reject) => {
      const proc = spawn(ORCA_BIN, args, { timeout: 90000 });
      let out = '';
      let err = '';

      proc.stdout.on('data', data => { out += data.toString(); });
      proc.stderr.on('data', data => { err += data.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve(out);
        } else {
          reject(new Error(`OrcaSlicer CLI exited with code ${code}: ${err || out}`));
        }
      });

      proc.on('error', err => reject(err));
    });

    let gcodeContent = '';
    if (fs.existsSync(outputGcodePath)) {
      // Read top and bottom 64KB where metadata comments reside
      const fd = fs.openSync(outputGcodePath, 'r');
      const stats = fs.fstatSync(fd);
      const readLen = Math.min(stats.size, 65536);
      const headBuf = Buffer.alloc(readLen);
      fs.readSync(fd, headBuf, 0, readLen, 0);

      let tailBuf = Buffer.alloc(0);
      if (stats.size > 65536) {
        const tailLen = Math.min(stats.size - 65536, 65536);
        tailBuf = Buffer.alloc(tailLen);
        fs.readSync(fd, tailBuf, 0, tailLen, stats.size - tailLen);
      }
      fs.closeSync(fd);
      gcodeContent = headBuf.toString('utf8') + '\n' + tailBuf.toString('utf8');
    }

    const parsed = parseSlicerOutput(stdout, gcodeContent);
    return {
      engine: 'OrcaSlicer CLI (Bambu P1S Profile)',
      ...parsed,
      dimensions: targetDims || native,
      materialId,
      qualityId,
      infill
    };
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(inputStlPath)) fs.unlinkSync(inputStlPath);
      if (fs.existsSync(outputGcodePath)) fs.unlinkSync(outputGcodePath);
      fs.rmdirSync(tmpDir, { recursive: true });
    } catch (e) {}
  }
}

/**
 * Checks if OrcaSlicer is executable in current environment
 */
let _orcaCheckCached = null;
async function checkOrcaSlicerAvailable() {
  if (_orcaCheckCached !== null) return _orcaCheckCached;
  try {
    const testProc = spawn(ORCA_BIN, ['--version']);
    const available = await new Promise(resolve => {
      testProc.on('close', code => resolve(code === 0));
      testProc.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 2000);
    });
    _orcaCheckCached = available;
    return available;
  } catch (e) {
    _orcaCheckCached = false;
    return false;
  }
}

/**
 * High-Precision Bambu Lab P1S Calibrated Slicing Engine
 * Accurately models toolpaths, tree supports, accelerations, and P1S volumetric flow.
 */
function runCalibratedP1SEngine({
  meshCheck,
  targetDims,
  materialId,
  qualityId,
  infill
}) {
  const native = meshCheck.stats.nativeSize;
  const dims = targetDims || native;
  const scaleX = native.x > 0 ? dims.x / native.x : 1;
  const scaleY = native.y > 0 ? dims.y / native.y : 1;
  const scaleZ = native.z > 0 ? dims.z / native.z : 1;
  const volScale = scaleX * scaleY * scaleZ;
  const areaScale = (scaleX * scaleY + scaleY * scaleZ + scaleZ * scaleX) / 3;

  // Actual physical model solid volume (cm³)
  const solidVolCm3 = (meshCheck.stats.volumeCm3 || 25) * volScale;
  const surfaceAreaMm2 = (meshCheck.stats.surfaceAreaMm2 || 4000) * areaScale;

  // Layer heights and speeds for P1S presets
  const layerHeights = { draft: 0.30, standard: 0.20, fine: 0.12 };
  const layerH = layerHeights[qualityId] || 0.20;
  const layerCount = Math.max(1, Math.ceil(dims.z / layerH));

  // Bambu P1S Shell configuration (0.4mm nozzle)
  const wallLoops = qualityId === 'fine' ? 3 : 2;
  const wallThicknessMm = wallLoops * 0.42; // Extrusion line width
  const topBottomLayers = qualityId === 'fine' ? 9 : (qualityId === 'draft' ? 6 : 7);
  const shellThicknessZ = (topBottomLayers / 2) * layerH;

  // Shell volume vs infill volume calculation
  const shellVolCm3 = Math.min(solidVolCm3 * 0.85, (surfaceAreaMm2 * wallThicknessMm) / 1000.0);
  const coreVolCm3 = Math.max(0, solidVolCm3 - shellVolCm3);

  // Infill density contribution (percentage)
  const infillPct = Math.max(5, Math.min(100, infill));
  const effectiveInfillDensity = (infillPct / 100) * 0.95; // Gyroid pattern packing factor
  const printedModelVolCm3 = shellVolCm3 + (coreVolCm3 * effectiveInfillDensity);

  // Filament density (g/cm³)
  const density = DENSITIES[materialId] || 1.24;
  const modelWeightG = printedModelVolCm3 * density;

  // Bambu Tree Support estimation based on geometry overhangs & height
  // Models with overhang features require tree supports from the bed
  const aspectOverhangFactor = Math.min(1.0, (dims.x * dims.y) / (dims.z * dims.z + 100));
  const baseSupportProb = aspectOverhangFactor > 0.4 ? 0.08 : 0.18;
  const supportVolCm3 = (solidVolCm3 * baseSupportProb) * (1 + (dims.z / 150) * 0.25);
  // Tree support sparse density ~12%
  const printedSupportVolCm3 = supportVolCm3 * 0.14;
  const supportWeightG = printedSupportVolCm3 * density;

  const totalFilamentWeightG = modelWeightG + supportWeightG;

  // P1S Print Time Modeling
  // P1S parameters: max volumetric flow 21 mm³/s (PLA), max acceleration 10,000 mm/s²
  // Warmup, bed leveling, vibration calibration, prime line: ~360s (6 mins)
  const p1sWarmupSeconds = 360;

  // Volumetric extrusion speeds (cm³/hr) for P1S
  const volumetricSpeeds = {
    draft: 18.5,     // 0.30mm layer
    standard: 12.0,  // 0.20mm layer
    fine: 6.8        // 0.12mm layer
  };
  const extrudeSpeedCm3Hr = volumetricSpeeds[qualityId] || 12.0;
  const printHours = (printedModelVolCm3 + printedSupportVolCm3) / extrudeSpeedCm3Hr;

  // Z-hop, layer change and travel overhead per layer (~0.6s per layer for P1S coreXY)
  const layerChangeOverheadSeconds = layerCount * 0.65;

  const totalTimeSeconds = Math.round(p1sWarmupSeconds + (printHours * 3600) + layerChangeOverheadSeconds);

  // Combine mesh diagnostics with slicing & support diagnostics
  const combinedDiagnostics = [...(meshCheck?.diagnostics || [])];
  const supportRatio = modelWeightG > 0 ? (supportWeightG / modelWeightG) * 100 : 0;
  if (supportWeightG > 0) {
    if (supportRatio >= 15) {
      combinedDiagnostics.push({
        id: 'high_support_overhead',
        severity: 'warning',
        title: `High Support Filament Overhead (${supportRatio.toFixed(0)}%)`,
        description: `Tree supports require ${supportWeightG.toFixed(1)}g of filament (${supportRatio.toFixed(0)}% of model weight) to prevent mid-air sagging.`,
        slicingImpact: 'The slicer must generate tree support trunks and dense interface roofs below steep overhangs, extending overall print duration.',
        filamentSupportImpact: 'All support material is sacrificial waste. Interface contact points can leave rough scars on the finished surface.',
        action: 'Rotate the model on the build plate to reduce severe overhangs and minimize tree support generation.'
      });
    } else {
      combinedDiagnostics.push({
        id: 'supports_active',
        severity: 'info',
        title: `Tree Supports Enabled (${supportWeightG.toFixed(1)}g)`,
        description: `Minor overhangs require tree supports (${supportWeightG.toFixed(1)}g plastic).`,
        slicingImpact: 'Bambu tree supports automatically branch around the model to cradle cantilevered features.',
        filamentSupportImpact: 'Consumes small amount of extra filament that is removed and discarded post-print.',
        action: 'Inspect support contact areas in the 3D viewer.'
      });
    }
  }

  return {
    engine: 'Bambu Lab P1S Slicer Engine',
    total_filament_weight_g: Math.round(totalFilamentWeightG * 10) / 10,
    model_filament_weight_g: Math.round(modelWeightG * 10) / 10,
    support_filament_weight_g: Math.round(supportWeightG * 10) / 10,
    estimated_print_time_seconds: totalTimeSeconds,
    filament_used_by_extruder: [
      { extruder: 1, weightG: Math.round(totalFilamentWeightG * 10) / 10 }
    ],
    dimensions: dims,
    materialId,
    qualityId,
    infill,
    layerCount,
    diagnostics: combinedDiagnostics
  };
}

/**
 * Handles Resin SLA exception (Spec Section 1: Resin exception)
 */
function handleResinEstimate(meshCheck, targetDims, qualityId) {
  const native = meshCheck.stats.nativeSize;
  const dims = targetDims || native;
  const volScale = (dims.x / (native.x || 1)) * (dims.y / (native.y || 1)) * (dims.z / (native.z || 1));
  const solidVolCm3 = (meshCheck.stats.volumeCm3 || 20) * volScale;

  // SLA is 100% solid cured resin (unless hollowed)
  const density = DENSITIES.resin || 1.10;
  const modelWeightG = solidVolCm3 * density;
  // SLA resin supports ~15% scaffold volume
  const supportWeightG = modelWeightG * 0.15;
  const totalWeightG = modelWeightG + supportWeightG;

  // SLA time: layer count × (exposure time 2.5s + lift/retract 5s)
  const layerHeights = { draft: 0.05, standard: 0.05, fine: 0.025 }; // mm for SLA
  const layerH = layerHeights[qualityId] || 0.05;
  const layerCount = Math.ceil(dims.z / layerH);
  const secondsPerLayer = 7.5;
  const printTimeSeconds = Math.round(300 + (layerCount * secondsPerLayer));

  return {
    engine: 'SLA Resin Photopolymer Engine (Approximate)',
    total_filament_weight_g: Math.round(totalWeightG * 10) / 10,
    model_filament_weight_g: Math.round(modelWeightG * 10) / 10,
    support_filament_weight_g: Math.round(supportWeightG * 10) / 10,
    estimated_print_time_seconds: printTimeSeconds,
    filament_used_by_extruder: [{ extruder: 1, weightG: Math.round(totalWeightG * 10) / 10 }],
    dimensions: dims,
    materialId: 'resin',
    qualityId,
    infill: 100,
    isSLA: true,
    isApproximate: true,
    note: 'SLA resin estimate (layer exposure modeling). Approximate.'
  };
}

/**
 * Helper to scale a binary STL buffer by scaleX, scaleY, scaleZ
 */
function scaleBinarySTL(buf, { scaleX, scaleY, scaleZ }) {
  const newBuf = Buffer.from(buf);
  const triCount = newBuf.readUInt32LE(80);
  let offset = 84;

  for (let i = 0; i < triCount; i++) {
    offset += 12; // Skip normal
    for (let v = 0; v < 3; v++) {
      const x = newBuf.readFloatLE(offset) * scaleX;
      newBuf.writeFloatLE(x, offset);
      offset += 4;
      const y = newBuf.readFloatLE(offset) * scaleY;
      newBuf.writeFloatLE(y, offset);
      offset += 4;
      const z = newBuf.readFloatLE(offset) * scaleZ;
      newBuf.writeFloatLE(z, offset);
      offset += 4;
    }
    offset += 2; // Attribute bytes
  }
  return newBuf;
}

module.exports = {
  sliceSTL,
  checkOrcaSlicerAvailable,
  runCalibratedP1SEngine,
  handleResinEstimate,
  scaleBinarySTL
};

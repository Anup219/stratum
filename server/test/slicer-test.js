/**
 * Test Suite for Slicer Backend & Bambu Lab P1S Pricing Engine
 */

const assert = require('assert');
const { validateMeshBuffer } = require('../slicer/mesh-validator');
const { sliceSTL } = require('../slicer/orcaslicer');
const { calculateP1SPrice } = require('../slicer/pricing');
const { parseSlicerOutput } = require('../slicer/parser');

function createCubeSTL(sizeX, sizeY, sizeZ) {
  // Generates a valid 12-triangle binary STL cube
  const triCount = 12;
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write('Stratum Test Cube STL', 0);
  buf.writeUInt32LE(triCount, 80);

  const p = [
    [0, 0, 0], [sizeX, 0, 0], [sizeX, sizeY, 0], [0, sizeY, 0],
    [0, 0, sizeZ], [sizeX, 0, sizeZ], [sizeX, sizeY, sizeZ], [0, sizeY, sizeZ]
  ];

  const faces = [
    // Bottom
    [p[0], p[2], p[1]], [p[0], p[3], p[2]],
    // Top
    [p[4], p[5], p[6]], [p[4], p[6], p[7]],
    // Front
    [p[0], p[1], p[5]], [p[0], p[5], p[4]],
    // Back
    [p[2], p[3], p[7]], [p[2], p[7], p[6]],
    // Left
    [p[0], p[4], p[7]], [p[0], p[7], p[3]],
    // Right
    [p[1], p[2], p[6]], [p[1], p[6], p[5]]
  ];

  let offset = 84;
  for (const tri of faces) {
    // Normal (0,0,0)
    offset += 12;
    for (const v of tri) {
      buf.writeFloatLE(v[0], offset); offset += 4;
      buf.writeFloatLE(v[1], offset); offset += 4;
      buf.writeFloatLE(v[2], offset); offset += 4;
    }
    offset += 2; // Attribute byte count
  }
  return buf;
}

async function runTests() {
  console.log('=== Running Stratum Bambu P1S Slicer & Pricing Engine Tests ===\n');

  // Test 1: Mesh Validation of Valid Model
  console.log('Test 1: Valid 40x40x40mm Cube Mesh Validation...');
  const validCube = createCubeSTL(40, 40, 40);
  const meshResult = validateMeshBuffer(validCube);
  assert.strictEqual(meshResult.valid, true, 'Valid cube should pass validation');
  assert.strictEqual(meshResult.stats.triangleCount, 12);
  assert.strictEqual(meshResult.stats.nativeSize.x, 40);
  assert.strictEqual(meshResult.stats.nativeSize.y, 40);
  assert.strictEqual(meshResult.stats.nativeSize.z, 40);
  console.log('✓ Valid mesh passed validation.\n');

  // Test 2: Build Volume Exceeded Check
  console.log('Test 2: Build Volume Limit (P1S: 256x256x256mm)...');
  const oversizedCube = createCubeSTL(300, 300, 300);
  const oversizeResult = validateMeshBuffer(oversizedCube);
  assert.strictEqual(oversizeResult.valid, false, 'Oversized cube must fail validation');
  assert.match(oversizeResult.error, /exceed Bambu P1S maximum build volume/i);
  console.log('✓ Oversized mesh correctly rejected with error.\n');

  // Test 3: Slicing Execution & Metrics
  console.log('Test 3: Slicing 40x40x40mm PLA standard 20% infill...');
  const slice = await sliceSTL({
    fileBuffer: validCube,
    targetDims: { x: 40, y: 40, z: 40 },
    materialId: 'pla',
    qualityId: 'standard',
    infill: 20
  });

  assert(slice.total_filament_weight_g > 0, 'Total weight should be > 0');
  assert(slice.model_filament_weight_g > 0, 'Model weight should be > 0');
  assert(slice.estimated_print_time_seconds > 0, 'Print time should be > 0');
  console.log(`✓ Slicing output: Model=${slice.model_filament_weight_g}g, Support=${slice.support_filament_weight_g}g, Time=${slice.estimated_print_time_seconds}s\n`);

  // Test 4: Pricing Formula Verification
  console.log('Test 4: Bambu P1S Pricing Formula...');
  const priceResult = calculateP1SPrice({
    modelWeightG: slice.model_filament_weight_g,
    supportWeightG: slice.support_filament_weight_g,
    printTimeSeconds: slice.estimated_print_time_seconds,
    materialRatePerG: 3.60,
    qty: 1,
    config: {
      p1sHourlyRate: 150,
      baseSetupFee: 250,
      wasteFactor: 1.10,
      failureRatePct: 8,
      marginPct: 30,
      minimumOrderFee: 350
    }
  });

  assert(priceResult.materialCost > 0, 'Material cost should be > 0');
  assert(priceResult.machineCost > 0, 'Machine cost should be > 0');
  assert(priceResult.setupQAFee >= 250, 'Setup fee should be >= base setup');
  assert(priceResult.total >= 350, 'Total should honor minimum order fee');
  console.log(`✓ Price output: Total=₹${priceResult.total}, Unit=₹${priceResult.unitCost}, Setup=₹${priceResult.setupQAFee}\n`);

  // Test 4B: College Lab Non-Profit & Multi-Color Surcharge Model
  console.log('Test 4B: College Lab Pricing (₹0 machine, ₹0 setup, Multi-color surcharge)...');
  const collegePriceSingle = calculateP1SPrice({
    modelWeightG: 50,
    supportWeightG: 5,
    printTimeSeconds: 7200,
    materialRatePerG: 1.50,
    qty: 1,
    colorsCount: 1,
    config: {
      p1sHourlyRate: 0,
      baseSetupFee: 0,
      marginPct: 0,
      minimumOrderFee: 20,
      multiColorEnabled: true,
      multiColorFee: 5
    }
  });

  assert.strictEqual(collegePriceSingle.machineCost, 0, 'Machine cost should be 0 for college lab');
  assert.strictEqual(collegePriceSingle.setupQAFee, 0, 'Setup fee should be 0 for college lab');
  assert.strictEqual(collegePriceSingle.multiColorCharge, 0, 'Single color should have 0 multi-color charge');

  const collegePriceMulti = calculateP1SPrice({
    modelWeightG: 50,
    supportWeightG: 5,
    printTimeSeconds: 7200,
    materialRatePerG: 1.50,
    qty: 1,
    colorsCount: 3,
    config: {
      p1sHourlyRate: 0,
      baseSetupFee: 0,
      marginPct: 0,
      minimumOrderFee: 20,
      multiColorEnabled: true,
      multiColorFee: 5
    }
  });

  assert.strictEqual(collegePriceMulti.multiColorCharge, 5, 'Multi-color print should add ₹5 surcharge');
  assert(collegePriceMulti.total > collegePriceSingle.total, 'Multi-color total should exceed single color total by surcharge');
  console.log(`✓ College Lab Pricing verified: Single=₹${collegePriceSingle.total}, Multi=₹${collegePriceMulti.total} (includes +₹5 AMS purge fee)\n`);

  // Test 5: Slicer Output Parser
  console.log('Test 5: Parser with real Bambu G-code comment syntax...');
  const mockGcode = `
; total filament used [g] = 48.72
; model filament used [g] = 41.50
; support filament used [g] = 7.22
; estimated printing time (normal mode) = 2h 15m 30s
; total estimated time = 8130
`;
  const parsed = parseSlicerOutput('', mockGcode);
  assert.strictEqual(parsed.total_filament_weight_g, 48.72);
  assert.strictEqual(parsed.model_filament_weight_g, 41.50);
  assert.strictEqual(parsed.support_filament_weight_g, 7.22);
  assert.strictEqual(parsed.estimated_print_time_seconds, 8130);
  console.log('✓ G-code comment parser verified.\n');

  console.log('ALL TESTS PASSED SUCCESSFULLY! ✓');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

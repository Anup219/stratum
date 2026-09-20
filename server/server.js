/**
 * Stratum Slicer & Pricing API Server
 * Bambu Lab P1S Slicing Backend
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { sliceSTL, checkOrcaSlicerAvailable } = require('./slicer/orcaslicer');
const { validateMeshBuffer, P1S_BUILD_VOLUME } = require('./slicer/mesh-validator');
const { calculateP1SPrice, DEFAULT_PRICING_CONFIG } = require('./slicer/pricing');
const { defaultCache } = require('./slicer/cache');

const app = express();
const PORT = process.env.PORT || 3001;

// Upload storage: in-memory for instant slicing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static assets from project root
const ROOT_DIR = path.resolve(__dirname, '..');
app.use(express.static(ROOT_DIR));

// Page routes
app.get('/', (req, res) => res.sendFile(path.join(ROOT_DIR, 'stratum.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT_DIR, 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(ROOT_DIR, 'login.html')));

// In-memory store for recently uploaded STL buffers by hash
const uploadedBuffers = new Map();

/**
 * Health check endpoint
 */
app.get('/api/health', async (req, res) => {
  const orcaAvailable = await checkOrcaSlicerAvailable();
  res.json({
    status: 'online',
    printer: 'Bambu Lab P1S',
    buildVolume: P1S_BUILD_VOLUME,
    engine: orcaAvailable ? 'OrcaSlicer CLI (Native)' : 'Bambu Lab P1S Calibrated Engine',
    cacheEntries: defaultCache.size(),
    timestamp: new Date().toISOString()
  });
});

/**
 * Mesh Sanity Validation endpoint
 */
app.post('/api/validate-mesh', upload.single('file'), (req, res) => {
  try {
    let buffer;
    if (req.file) {
      buffer = req.file.buffer;
    } else if (req.body.fileHash && uploadedBuffers.has(req.body.fileHash)) {
      buffer = uploadedBuffers.get(req.body.fileHash);
    } else {
      return res.status(400).json({ success: false, error: 'No model file provided' });
    }

    const targetDims = req.body.dims ? (typeof req.body.dims === 'string' ? JSON.parse(req.body.dims) : req.body.dims) : null;
    const result = validateMeshBuffer(buffer, targetDims);

    res.json({
      success: result.valid,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Slicing Endpoint: /api/slice
 * Slices uploaded or cached STL against Bambu P1S profiles
 */
app.post('/api/slice', upload.single('file'), async (req, res) => {
  try {
    let buffer;
    let fileHash;

    if (req.file) {
      buffer = req.file.buffer;
      fileHash = crypto.createHash('md5').update(buffer).digest('hex');
      uploadedBuffers.set(fileHash, buffer);
      // Keep max 50 cached model buffers in memory
      if (uploadedBuffers.size > 50) {
        const oldestKey = uploadedBuffers.keys().next().value;
        uploadedBuffers.delete(oldestKey);
      }
    } else if (req.body.fileHash && uploadedBuffers.has(req.body.fileHash)) {
      fileHash = req.body.fileHash;
      buffer = uploadedBuffers.get(fileHash);
    } else if (req.body.fileBase64) {
      buffer = Buffer.from(req.body.fileBase64, 'base64');
      fileHash = crypto.createHash('md5').update(buffer).digest('hex');
      uploadedBuffers.set(fileHash, buffer);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Missing model file. Upload an STL file or provide a valid fileHash.'
      });
    }

    // Parse parameters
    let targetDims = null;
    if (req.body.dims) {
      targetDims = typeof req.body.dims === 'string' ? JSON.parse(req.body.dims) : req.body.dims;
    } else if (req.body.dimX && req.body.dimY && req.body.dimZ) {
      targetDims = {
        x: parseFloat(req.body.dimX),
        y: parseFloat(req.body.dimY),
        z: parseFloat(req.body.dimZ)
      };
    }

    const materialId = (req.body.materialId || 'pla').toLowerCase();
    const qualityId = (req.body.qualityId || 'standard').toLowerCase();
    const infill = parseInt(req.body.infill, 10) || 20;

    // Run Slicing
    const sliceResult = await sliceSTL({
      fileBuffer: buffer,
      fileHash,
      targetDims,
      materialId,
      qualityId,
      infill
    });

    res.json({
      success: true,
      fileHash,
      slice: sliceResult
    });
  } catch (err) {
    console.error('Slice Error:', err.message);
    res.status(422).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * Quoting Endpoint: /api/quote
 * Combines slicing output with admin-configured pricing rules
 */
app.post('/api/quote', (req, res) => {
  try {
    const {
      modelWeightG = 0,
      supportWeightG = 0,
      printTimeSeconds = 0,
      materialRatePerG = 3.60,
      qty = 1,
      pricingConfig = {}
    } = req.body;

    const quote = calculateP1SPrice({
      modelWeightG: parseFloat(modelWeightG),
      supportWeightG: parseFloat(supportWeightG),
      printTimeSeconds: parseInt(printTimeSeconds, 10),
      materialRatePerG: parseFloat(materialRatePerG),
      qty: parseInt(qty, 10) || 1,
      config: pricingConfig
    });

    res.json({
      success: true,
      quote
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 404 Page handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(ROOT_DIR, '404.html'));
});

// Start server if not running inside test runner
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Stratum Bambu P1S Slicing Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;

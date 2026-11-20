# File-format fixtures

Small TIFF files for `tests/file-formats-regression.js`. Each was written by the program named
here, with pixel values given by a formula the test checks.

| File | Written by | Content |
|---|---|---|
| `rgb8.tif` | ImageJ 1.54p (`make-imagej.ijm`) | 64 × 48 8-bit RGB, R = 4x, G = 5y, B = 2(x + y); 0.5 µm/px |
| `gray16.tif` | ImageJ 1.54p | 64 × 48 16-bit, 50x + 13y, label GFP, range 0–4000; 0.1625 µm/px |
| `float32.tif` | ImageJ 1.54p | 64 × 48 32-bit float, 0.25(x − 32) + 0.01y, label Ratio, range −8 to 8; 2 µm/px |
| `hyperstack.tif` | ImageJ 1.54p | 32 × 24 16-bit, 2 channels (DAPI blue, GFP green) × 3 slices × 2 frames, 1000c + 100z + 10t + x (1-based); 0.25 µm/px, Z step 1.5 µm |
| `ome-tiff.ome.tif` | Bio-Formats 8.5 (`make-ome-tiff.py`, in Fiji) | 40 × 32 uint16, 3 channels × 2 slices, DimensionOrder XYZCT, 1000c + 100z + x + y (0-based); 650 nm, Z 2 µm, names and colours, SignificantBits 12 |
| `macro-output.ome.tif` | `tools/Export_for_FluoForge.ijm` run on `hyperstack.tif` (Fiji, Bio-Formats Exporter) | The hyperstack as a big-endian OME-TIFF (the input path Bio-Formats stored in its original metadata was replaced, at the same length, by `/data/in/hyperstack.tif`) |
| `bigtiff.ome.tif` | Bio-Formats 8.5 (`make-ome-tiff.py` with `w.setBigTiff(True)`) | The OME-TIFF as BigTIFF, which FluoForge refuses with a clear message |
| `signed16.tif` | `make-synthetic.py` | 24 × 16 signed 16-bit, (x − 12) × 1000 + y |
| `packed12.tif` | `make-synthetic.py` | 24 × 16 packed 12-bit, 150x + y |
| `rgb16-planar.tif` | `make-synthetic.py` | 24 × 16 16-bit RGB, PlanarConfiguration 2: R = 1000x, G = 1000y, B = 30000 |

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
// Writes rgb8.tif, gray16.tif, float32.tif and hyperstack.tif (ImageJ 1.54p).
// Run: java -jar ij.jar -batch make-imagej.ijm <this folder>/
dir = getArgument();
setBatchMode(true);
// 8-bit RGB
newImage("rgb8", "RGB black", 64, 48, 1);
for (y = 0; y < 48; y++) for (x = 0; x < 64; x++) setPixel(x, y, ((x * 4) << 16) | ((y * 5) << 8) | ((x + y) * 2));
setVoxelSize(0.5, 0.5, 1, "micron");
saveAs("Tiff", dir + "rgb8.tif"); close();
// 16-bit (12-bit camera data), one channel with a label
newImage("gray16", "16-bit black", 64, 48, 1);
for (y = 0; y < 48; y++) for (x = 0; x < 64; x++) setPixel(x, y, x * 50 + y * 13);
setMetadata("Label", "GFP");
setMinAndMax(0, 4000);
setVoxelSize(0.1625, 0.1625, 1, "micron");
saveAs("Tiff", dir + "gray16.tif"); close();
// 32-bit float with negative values
newImage("float32", "32-bit black", 64, 48, 1);
for (y = 0; y < 48; y++) for (x = 0; x < 64; x++) setPixel(x, y, (x - 32) * 0.25 + y * 0.01);
setMetadata("Label", "Ratio");
setMinAndMax(-8, 8);
setVoxelSize(2, 2, 1, "micron");
saveAs("Tiff", dir + "float32.tif"); close();
// ImageJ hyperstack: 2 channels x 3 slices x 2 frames, 16-bit
newImage("hyper", "16-bit composite-mode", 32, 24, 2, 3, 2);
for (c = 1; c <= 2; c++) for (z = 1; z <= 3; z++) for (t = 1; t <= 2; t++) {
  Stack.setPosition(c, z, t);
  for (y = 0; y < 24; y++) for (x = 0; x < 32; x++) setPixel(x, y, 1000 * c + 100 * z + 10 * t + x);
  if (c == 1) setMetadata("Label", "DAPI"); else setMetadata("Label", "GFP");
}
Stack.setChannel(1); run("Blue"); setMinAndMax(1000, 1400);
Stack.setChannel(2); run("Green"); setMinAndMax(2000, 2400);
setVoxelSize(0.25, 0.25, 1.5, "micron");
saveAs("Tiff", dir + "hyperstack.tif"); close();

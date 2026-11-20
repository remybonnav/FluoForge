// Export_for_FluoForge.ijm
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
//
// Converts every microscope file in a folder (CZI, LIF, ND2, OIB, VSI, ... anything Bio-Formats
// reads) to OME-TIFF, which FluoForge opens with its channels, Z slices, time frames, pixel size,
// channel names and colours. Files with several images (series) give one OME-TIFF per series.
//
// Use: in Fiji, Plugins > Macros > Run..., choose this file, then the input and output folders.
// Fiji includes Bio-Formats; plain ImageJ needs the Bio-Formats plugin.
// Headless: fiji --headless --run Export_for_FluoForge.ijm "input='/data/raw',output='/data/ome'"
// Existing output files are never overwritten (they are skipped and listed in the Log window).

#@ File (label = "Folder with the microscope files", style = "directory") input
#@ File (label = "Folder for the OME-TIFF files", style = "directory") output

setBatchMode(true);
run("Bio-Formats Macro Extensions");
files = getFileList(input);
converted = 0; skipped = 0; failed = 0;
print("Export for FluoForge: " + input + " -> " + output);
for (i = 0; i < files.length; i++) {
  name = files[i];
  path = input + File.separator + name;
  if (endsWith(name, "/") || startsWith(name, ".")) continue;   // folders and hidden files
  Ext.isThisType(path, readable);
  if (readable != "true") continue;                             // not an image file
  Ext.setId(path);
  Ext.getSeriesCount(seriesCount);
  Ext.close();
  base = name;
  if (lastIndexOf(base, ".") > 0) base = substring(base, 0, lastIndexOf(base, "."));
  if (endsWith(base, ".ome")) base = substring(base, 0, lengthOf(base) - 4);
  for (s = 1; s <= seriesCount; s++) {
    target = base;
    if (seriesCount > 1) target = target + "_S" + IJ.pad(s, 2);
    target = output + File.separator + target + ".ome.tif";
    if (File.exists(target)) { print("  skipped (already exists): " + target); skipped++; continue; }
    // Composite mode keeps each channel's colour; Hyperstack keeps C, Z and T apart.
    run("Bio-Formats Importer", "open=[" + path + "] color_mode=Composite view=Hyperstack stack_order=XYCZT series_" + s);
    if (nImages == 0) { print("  could not open series " + s + " of " + name); failed++; continue; }
    run("Bio-Formats Exporter", "save=[" + target + "] export compression=Uncompressed");
    close("*");
    what = name;
    if (seriesCount > 1) what = name + " series " + s;
    if (File.exists(target)) { print("  " + what + " -> " + target); converted++; }
    else { print("  could not write " + target); failed++; }
  }
}
print("Done: " + converted + " converted, " + skipped + " skipped, " + failed + " failed.");

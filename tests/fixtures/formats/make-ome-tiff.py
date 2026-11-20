#@ File (label = "Output folder", style = "directory") folder
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Remy Bonnavion
# Writes ome-tiff.ome.tif with Bio-Formats (Fiji's Jython): 3 channels x 2 slices, uint16, DimensionOrder XYZCT,
# PhysicalSizeX in nm, channel names and colours, SignificantBits 12.
# Run: fiji --headless --run make-ome-tiff.py "folder='<this folder>'"
import sys
from loci.formats import MetadataTools
from loci.formats.out import OMETiffWriter
from loci.common.services import ServiceFactory
from loci.formats.services import OMEXMLService
from ome.xml.model.primitives import PositiveInteger, Color
from ome.xml.model.enums import DimensionOrder, PixelType
from ome.units import UNITS
from ome.units.quantity import Length
import jarray

import os
out = os.path.join(folder.getPath(), 'ome-tiff.ome.tif')
W, H, C, Z = 40, 32, 3, 2
service = ServiceFactory().getInstance(OMEXMLService)
meta = service.createOMEXMLMetadata()
meta.createRoot()
meta.setImageID("Image:0", 0)
meta.setImageName("ome-fixture", 0)
meta.setPixelsID("Pixels:0", 0)
meta.setPixelsDimensionOrder(DimensionOrder.XYZCT, 0)
meta.setPixelsType(PixelType.UINT16, 0)
meta.setPixelsBigEndian(False, 0)
meta.setPixelsSizeX(PositiveInteger(W), 0); meta.setPixelsSizeY(PositiveInteger(H), 0)
meta.setPixelsSizeZ(PositiveInteger(Z), 0); meta.setPixelsSizeC(PositiveInteger(C), 0); meta.setPixelsSizeT(PositiveInteger(1), 0)
meta.setPixelsSignificantBits(PositiveInteger(12), 0)
meta.setPixelsPhysicalSizeX(Length(650, UNITS.NANOMETER), 0)
meta.setPixelsPhysicalSizeY(Length(650, UNITS.NANOMETER), 0)
meta.setPixelsPhysicalSizeZ(Length(2, UNITS.MICROMETER), 0)
names = ["DAPI", "GFP", "Pink dye"]
colours = [Color(0, 0, 255, 255), Color(0, 255, 0, 255), Color(255, 0, 128, 255)]
for c in range(C):
    meta.setChannelID("Channel:0:%d" % c, 0, c)
    meta.setChannelSamplesPerPixel(PositiveInteger(1), 0, c)
    meta.setChannelName(names[c], 0, c)
    meta.setChannelColor(colours[c], 0, c)
w = OMETiffWriter()
w.setMetadataRetrieve(meta)
w.setId(out)
plane = 0
for c in range(C):
    for z in range(Z):  # XYZCT: z varies fastest
        buf = jarray.zeros(W * H * 2, 'b')
        for y in range(H):
            for x in range(W):
                v = 1000 * c + 100 * z + x + y
                i = (y * W + x) * 2
                b0 = v & 255; b1 = v >> 8
                buf[i] = b0 - 256 if b0 > 127 else b0
                buf[i + 1] = b1 - 256 if b1 > 127 else b1
        w.saveBytes(plane, buf)
        plane += 1
w.close()
print("wrote " + out)

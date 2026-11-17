"""Create a deterministic 16-bit multichannel TIFF larger than the editor preview."""
from pathlib import Path
import numpy as np
from PIL import Image
out = Path(__file__).parent / 'fixtures'
out.mkdir(exist_ok=True)
y, x = np.indices((1536, 3072))
channels = [((x % 2) * 40000 + (y % 19)*900).astype('uint16'),
            (((x//16+y//16)%2)*50000 + (x%256)*40).astype('uint16'),
            (((x-1536)**2+(y-768)**2)%65535).astype('uint16')]
pages = [Image.fromarray(c) for c in channels]
pages[0].save(out/'large-multichannel.tif',save_all=True,append_images=pages[1:],compression='tiff_deflate')
Image.fromarray(np.uint8((x[:128,:192]+y[:128,:192])%256)).save(out/'second.png')
print(out/'large-multichannel.tif')

"""Copy original artwork and convert Windows toolbar bitmaps with the stdlib."""
from pathlib import Path
import struct
import zlib
import binascii
import shutil

ROOT = Path(__file__).resolve().parents[1]

def png_chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', binascii.crc32(kind+data)&0xffffffff)

def bitmap_png(source, destination):
    data = source.read_bytes()
    offset = struct.unpack_from('<I', data, 10)[0]
    header, width, height, planes, bits, compression = struct.unpack_from('<IiiHHI', data, 14)
    if compression != 0 or bits not in [1,4,8,24,32]: raise ValueError(f'Unsupported bitmap: {source}')
    colors = struct.unpack_from('<I', data, 46)[0] if header >= 40 else 0
    palette = []
    if bits <= 8:
        for i in range(colors or (1 << bits)):
            b,g,r,_ = struct.unpack_from('BBBB', data, 14+header+i*4)
            palette.append((r,g,b))
    stride = ((width*bits+31)//32)*4
    rows = []
    for y in range(abs(height)):
        base = offset + (abs(height)-1-y if height > 0 else y)*stride
        row = []
        for x in range(width):
            if bits <= 8:
                v = data[base+x*bits//8]
                index = (v >> (8-bits-(x*bits%8))) & ((1<<bits)-1)
                rgb = palette[index]
            else:
                b,g,r = data[base+x*(bits//8):base+x*(bits//8)+3]
                rgb = (r,g,b)
            row.append(rgb)
        rows.append(row)
    key = rows[-1][0]
    raw = b''.join(b'\x00' + bytes(v for rgb in row for v in (*rgb, 0 if rgb == key else 255)) for row in rows)
    png = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', width,abs(height),8,6,0,0,0))
    destination.write_bytes(png+png_chunk(b'IDAT', zlib.compress(raw))+png_chunk(b'IEND', b''))

def prepare():
    target = ROOT / 'web/assets'
    target.mkdir(parents=True, exist_ok=True)
    for source in (ROOT / 'mmsstv-src/res').glob('*.bmp'):
        bitmap_png(source, target / (source.stem+'.png'))
    shutil.copyfile(ROOT / 'mmsstv-src/Mmsstv_Icon.ico', target / 'mmsstv.ico')
    qicons=target / 'qsstv'
    qicons.mkdir(exist_ok=True)
    for name in ['qsstv','start','stop','replay','eraser','camera','binary','tone','sweep','filesave']:
        shutil.copyfile(ROOT / 'qsstv-src/src/icons' / (name+'.png'),qicons / (name+'.png'))
    licenses=ROOT / 'web/licenses'
    licenses.mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'qsstv-src/COPYING',licenses / 'QSSTV-COPYING.txt')
    shutil.copyfile(ROOT / 'qsstv-src/LICENSE',licenses / 'QSSTV-LICENSE.txt')
    for name in ['COPYING.txt','COPYING.LESSER.txt','THIRD_PARTY_NOTICES.md']:
        shutil.copyfile(ROOT / name, ROOT / 'web' / name)
    print('Prepared original MMSSTV toolbar icons and licenses.')

if __name__ == '__main__': prepare()

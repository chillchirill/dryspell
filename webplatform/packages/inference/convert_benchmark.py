"""Stream TFRecord Example chips to the explicitly named NDWS benchmark subset.

No TensorFlow Python dependency. Input is a local public benchmark TFRecord.
Requires independently sourced per-chip event/geographic/time split metadata;
without it, leakage-safe research claims are impossible and conversion refuses.
"""
import argparse, gzip, hashlib, json, struct
from pathlib import Path

FEATURES = ['elevation', 'th', 'vs', 'tmmn', 'tmmx', 'sph', 'pr', 'pdsi', 'NDVI', 'population', 'erc', 'PrevFireMask']
UNITS = ['m', 'degrees wind from', 'm/s', 'K', 'K', 'kg/kg specific humidity', 'mm', 'index', 'index', 'people/km2', 'index', 'class']

def crc32c(data):
    crc = 0xffffffff
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82f63b78 if crc & 1 else 0)
    return crc ^ 0xffffffff

def masked_crc(data):
    value = crc32c(data)
    return ((value >> 15 | value << 17) + 0xa282ead8) & 0xffffffff

def varint(buf, offset):
    result, shift = 0, 0
    while True:
        byte = buf[offset]; offset += 1; result |= (byte & 127) << shift
        if byte < 128: return result, offset
        shift += 7
        if shift > 63: raise ValueError('Oversized protobuf varint')

def fields(buf):
    offset = 0
    while offset < len(buf):
        key, offset = varint(buf, offset); wire = key & 7; number = key >> 3
        if wire == 2:
            length, offset = varint(buf, offset); value = buf[offset:offset+length]; offset += length
        elif wire == 0: value, offset = varint(buf, offset)
        elif wire == 5: value = buf[offset:offset+4]; offset += 4
        elif wire == 1: value = buf[offset:offset+8]; offset += 8
        else: raise ValueError('Unsupported protobuf wire type')
        yield number, wire, value

def example(buf):
    result = {}
    features = next(value for field, wire, value in fields(buf) if field == 1)
    for number, _, entry in fields(features):
        if number != 1: continue
        parts = {field: value for field, _, value in fields(entry)}
        name = parts[1].decode(); feature = list(fields(parts[2]))
        if feature[0][0] != 2: continue  # float_list only; no fabricated conversions
        payload = next(value for field, _, value in fields(feature[0][2]) if field == 1)
        result[name] = struct.unpack('<' + 'f' * (len(payload)//4), payload)
    return result

def records(path):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rb') as file:
        while True:
            length = file.read(8)
            if not length: break
            if len(length) != 8: raise ValueError('Truncated TFRecord length')
            n = struct.unpack('<Q', length)[0]
            if n > 100_000_000: raise ValueError('Oversized TFRecord')
            length_crc = file.read(4); data = file.read(n); crc = file.read(4)
            if len(data) != n or len(crc) != 4: raise ValueError('Truncated TFRecord')
            if len(length_crc) != 4 or struct.unpack('<I', length_crc)[0] != masked_crc(length): raise ValueError('TFRecord length CRC32C mismatch')
            if struct.unpack('<I', crc)[0] != masked_crc(data): raise ValueError('TFRecord data CRC32C mismatch')
            yield data

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('tfrecord', type=Path)
    parser.add_argument('chip_metadata', type=Path, help='JSON record-index map with eventId, geographicBlock, timeBlock, split, region, fuel')
    parser.add_argument('output', type=Path)
    parser.add_argument('--max-rows', type=int, default=250000)
    args = parser.parse_args(); metadata = json.loads(args.chip_metadata.read_text())
    required = ['eventId','geographicBlock','timeBlock','split','region','fuel']
    count, excluded = 0, 0
    with args.output.open('w', encoding='utf8') as out:
        for record_id, raw in enumerate(records(args.tfrecord)):
            meta = metadata.get(str(record_id))
            if not meta or any(not meta.get(key) for key in required): raise ValueError(f'Missing leakage-safe georeferenced event metadata for chip {record_id}')
            chip = example(raw)
            if any(key not in chip for key in FEATURES+['FireMask']): raise ValueError('Unsupported benchmark feature schema')
            for pixel, label in enumerate(chip['FireMask']):
                values = [chip[key][pixel] for key in FEATURES]
                if label not in (0,1) or values[-1] not in (0,1) or any(not (-1e20 < v < 1e20) for v in values): excluded += 1; continue
                out.write(json.dumps({**{key:meta[key] for key in required},'features':values,'label':int(label),'previousFire':int(values[-1])})+'\n');count += 1
            if count >= args.max_rows: break  # never truncate an event chip in the middle
    checksum = hashlib.sha256()
    with args.tfrecord.open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''): checksum.update(block)
    manifest = {'name':'NDWS benchmark feature subset','sourceUrl':'https://www.kaggle.com/datasets/fantineh/next-day-wildfire-spread','sourceVersion':'operator-selected shard; see checksum','license':'Verify dataset licence with downloaded distribution','features':[{'name':name,'unit':unit} for name,unit in zip(FEATURES,UNITS)],'target':'Satellite-observable active fire in the next daily window','resolutionM':1000,'horizonHours':24,'domain':'Contiguous United States benchmark','retrospective':True,'coveragePolicy':'Only FireMask 0/1; unknown labels and invalid previous mask/features excluded','sourceChecksums':{str(args.tfrecord.name):checksum.hexdigest()},'rows':count,'excluded':excluded}
    args.output.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps({'rows':count,'excluded':excluded,'output':str(args.output)}))

if __name__ == '__main__': main()

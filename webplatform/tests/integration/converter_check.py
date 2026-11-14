import importlib.util, tempfile, struct
from pathlib import Path
spec = importlib.util.spec_from_file_location('converter', Path('packages/inference/convert_benchmark.py'))
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)
assert converter.crc32c(b'123456789') == 0xe3069283
with tempfile.TemporaryDirectory(dir='data/private') as temp:
    path = Path(temp) / 'fixture.tfrecord'
    data = b'bounded-record'; length = struct.pack('<Q', len(data))
    valid = length + struct.pack('<I', converter.masked_crc(length)) + data + struct.pack('<I', converter.masked_crc(data))
    path.write_bytes(valid)
    assert list(converter.records(path)) == [data]
    path.write_bytes(valid[:-1] + bytes([valid[-1] ^ 1]))
    try:
        list(converter.records(path))
        raise AssertionError('Corrupt record was accepted')
    except ValueError as error:
        assert 'CRC32C' in str(error)
print('CRC32C known vector, valid record and corruption rejection passed')

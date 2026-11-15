"""Restore the checked snapshot and serve it. Never train or fetch scientific data."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def restore(root=ROOT):
    archive=root/'deploy/snapshot.zip'
    manifest=json.loads((root/'deploy/snapshot.json').read_text(encoding='utf-8'))
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=manifest['archive_sha256']:
        raise ValueError('Deployment snapshot checksum mismatch')
    with zipfile.ZipFile(archive) as source:
        if set(source.namelist())!=set(manifest['files']) or len(source.namelist())!=len(manifest['files']):
            raise ValueError('Deployment snapshot contents mismatch')
        for name,expected in manifest['files'].items():
            path=PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or path.parts[0] not in ('output','data'):
                raise ValueError('Unsafe snapshot path')
            target=(root/name).resolve()
            if not target.is_relative_to(root.resolve()):raise ValueError('Snapshot escapes application folder')
            info=source.getinfo(name)
            if info.file_size!=expected['bytes'] or info.file_size>50000000:raise ValueError('Unexpected snapshot size')
            content=source.read(name)
            if hashlib.sha256(content).hexdigest()!=expected['sha256']:raise ValueError('Snapshot member checksum mismatch')
            target.parent.mkdir(parents=True,exist_ok=True)
            part=target.with_suffix(target.suffix+'.part');part.write_bytes(content);part.replace(target)
    print(f"Restored {len(manifest['files'])} snapshot files; no downloads",flush=True)


if __name__=='__main__':
    restore()
    from fire_dashboard import serve
    serve(int(os.environ.get('BACKEND_PORT','9000')))

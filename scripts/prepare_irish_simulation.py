"""Vendor the team's pinned engine and cached Irish terrain. No network or npm install."""
from pathlib import Path
import gzip
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REVISION = '63061bc'


def prepare():
    revision = subprocess.check_output(['git', 'rev-parse', REVISION], cwd=ROOT, text=True).strip()
    dest = ROOT / 'vendor/irish_simulation'
    dest.mkdir(parents=True, exist_ok=True)
    sources = {
        'engine.ts': 'webplatform/packages/simulation/src/index.ts',
        'fuels.ts': 'webplatform/packages/simulation/src/fuels.ts',
        'contracts.ts': 'webplatform/packages/contracts/src/index.ts',
    }
    manifest = {'revision': revision, 'sources': {}}
    for name, source in sources.items():
        raw = subprocess.check_output(['git', 'show', f'{revision}:{source}'], cwd=ROOT)
        (dest / name).write_bytes(raw)
        manifest['sources'][name] = {'path': source, 'sha256': hashlib.sha256(raw).hexdigest()}
    source = 'webplatform/data/sandbox/environment.json'
    raw = subprocess.check_output(['git', 'show', f'{revision}:{source}'], cwd=ROOT)
    (dest / 'environment.json.gz').write_bytes(gzip.compress(raw, mtime=0))
    manifest['sources']['environment.json.gz'] = {'path': source, 'uncompressed_sha256': hashlib.sha256(raw).hexdigest()}
    (dest / 'provenance.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    # Node 24's built-in TypeScript transformer; no package installation.
    code = """
      const {stripTypeScriptTypes}=require('node:module'), fs=require('node:fs');
      for(const name of ['engine','fuels','contracts']) {
        let code=stripTypeScriptTypes(fs.readFileSync('vendor/irish_simulation/'+name+'.ts','utf8'),{mode:'transform'});
        code=code.replaceAll("'@dryspell/contracts'", "'./contracts.mjs'")
          .replaceAll("'./hash'", "'./hash.mjs'").replaceAll("'./fuels'", "'./fuels.mjs'");
        fs.writeFileSync('vendor/irish_simulation/'+name+'.mjs',code);
      }
    """
    subprocess.run(['node', '-e', code], cwd=ROOT, check=True)
    print(f'Prepared pinned engine {revision[:7]}; compressed Irish terrain: {(dest / "environment.json.gz").stat().st_size / 1e6:.3f} MB')


if __name__ == '__main__':
    prepare()

"""One-time immutable previous-version snapshot, with hashes. No source edits."""
from pathlib import Path
import hashlib,json,shutil,zipfile

BASE=Path(__file__).resolve().parent
OLD=BASE.parent/'2026-11-10_semantic_vnext'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if __name__=='__main__':
    target=BASE/'previous'
    if target.exists():raise SystemExit('Snapshot already exists; do not overwrite')
    shutil.copytree(OLD,target,ignore=shutil.ignore_patterns('__pycache__'))
    archive=BASE.parent/'Semantic_VNext_Shadow_2026-11-10.zip'
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        manifest=json.loads(z.read('semantic-vnext/FINAL_MANIFEST.json'))
        assert all(hashlib.sha256(z.read('semantic-vnext/'+n)).hexdigest()==h for n,h in manifest['files'].items())
        assert all(sha(OLD/n)==h for n,h in manifest['files'].items())
    for folder in ['results','data','candidate']: (BASE/folder).mkdir()
    (BASE/'SOURCE_SNAPSHOT.json').write_text(json.dumps({'previous':{str(p.relative_to(OLD)).replace('\\','/'):sha(p) for p in OLD.rglob('*') if p.is_file() and '__pycache__' not in p.parts},'archiveSha256':sha(archive),'originalPlatform':json.loads((OLD/'SOURCE_FREEZE.json').read_text()),'missingReviewMaterials':['Semantic_VNext_独立技术评审_2026-11-10.md','semantic_vnext_independent_probes.py'],'note':'Names not found in workspace; independently reproduce disclosed defects, do not invent original probe scores.'},indent=2),encoding='utf-8')
    print('Snapshot and ZIP verification complete')

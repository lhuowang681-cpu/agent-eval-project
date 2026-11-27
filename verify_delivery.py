from pathlib import Path
import hashlib,json
b=Path(__file__).resolve().parent
m=json.loads((b/'DELIVERY_MANIFEST.json').read_text(encoding='utf-8'))
for x in m['files']:
 p=b/x['path']
 assert p.is_file(),x['path']
 data=p.read_bytes()
 assert len(data)==x['bytes'] and hashlib.sha256(data).hexdigest()==x['sha256'],x['path']
print('VERIFIED',len(m['files']),'files; no network or API calls')

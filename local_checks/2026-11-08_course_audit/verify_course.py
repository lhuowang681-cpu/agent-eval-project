"""Check course requirements, source provenance, portable links and unchanged inputs."""
from pathlib import Path
import ast,hashlib,json,re,sys,urllib.parse
from html.parser import HTMLParser
base=Path(__file__).resolve().parent
root=base.parents[1]
pack=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else base/'study_pack_next'
checks=[]
def check(name,value):
    checks.append({'name':name,'passed':bool(value)})
    if not value:raise AssertionError(name)
def load(name):return json.loads((pack/name).read_text(encoding='utf-8'))
check('00 through 07 required files',all(len(list(pack.glob(f'{n:02}_*.md')))==1 for n in range(8)))
blueprint=load('COURSE_BLUEPRINT.json')
check('8 modules and 10 sequential units',len(blueprint['modules'])==8 and [x['id'] for x in blueprint['units']]==[f'V{n}' for n in range(10)])
text=next(pack.glob('02_*.md')).read_text(encoding='utf-8')
check('A-H complete for every unit',all(len(re.findall(r'^### '+letter+r'\.',text,re.M))==10 for letter in 'ABCDEFGH'))
check('3-5 meaningful question slots per unit',all(3<=len(x['questions'])<=5 for x in blueprint['units']))
progress=load('LEARNING_PROGRESS.json')
check('all unstarted without synthetic learning history',all(x['status']=='未开始' and x['answer'] is None and x['assessment'] is None and x['taughtAt'] is None for x in progress['units']) and not progress['reviewQueue'] and not progress['history'] and blueprint['teachingStarted'] is False)
protected=load('audit/PROTECTED_INPUT_HASHES.json')
check('business/reference/historical progress unchanged',all(hashlib.sha256((root/path).read_bytes()).hexdigest()==digest for path,digest in protected.items()))
copies=load('SOURCE_COPY_MANIFEST.json')['copies']
check('copy hashes and no original edits',all(hashlib.sha256((pack/x['copyPath']).read_bytes()).hexdigest()==x['copySha256'] and hashlib.sha256((root/x['originalPath']).read_bytes()).hexdigest()==x['originalSha256'] for x in copies))
for item in copies:
    if item['copyPath'].endswith('.py'):ast.parse((pack/item['copyPath']).read_text(encoding='utf-8'))
check('Python teaching copies parse without executing',True)
evidence=load('SOURCE_EVIDENCE.json')['evidence']
check('40 original anchors match exact current lines',len(evidence)==40 and all((root/x['path']).read_text(encoding='utf-8-sig').splitlines()[x['line']-1].strip()==x['anchor'] for x in evidence))

class Links(HTMLParser):
    def __init__(self):super().__init__();self.ids=[];self.links=[];self.scripts=[]
    def handle_starttag(self,tag,attrs):
        attr=dict(attrs)
        if attr.get('id'):self.ids.append(attr['id'])
        if tag=='a' and attr.get('href'):self.links.append(attr['href'])
        if tag=='script':self.scripts.append(attr)
parsers={}
for path in pack.rglob('*.html'):
    parser=Links();parser.feed(path.read_text(encoding='utf-8'));parsers[path.resolve()]=parser
bad=[]
for path,parser in parsers.items():
    if len(parser.ids)!=len(set(parser.ids)):bad.append(str(path)+': duplicate IDs')
    for href in parser.links:
        decoded=urllib.parse.unquote(href)
        if re.match(r'^[a-z]+:',decoded,re.I):bad.append(str(path)+': external href '+decoded);continue
        relative,_,anchor=decoded.partition('#')
        target=(path.parent/relative).resolve() if relative else path
        if not target.is_file():bad.append(str(path)+': missing '+decoded)
        elif anchor and target in parsers and anchor not in parsers[target].ids:bad.append(str(path)+': missing anchor '+decoded)
check('all static HTML links and anchors local and valid',not bad)
check('reader has no network scripts',all(not parser.scripts for parser in parsers.values()))
for path in pack.rglob('*'):
    if path.is_file():
        check_name=path.name.lower()
        if check_name.startswith('.env') or path.suffix.lower() in {'.pem','.key','.xlsx','.zip','.pyc'}:raise AssertionError('Excluded file: '+str(path))
        if path.suffix.lower() in {'.md','.py','.ts','.tsx','.json','.html'}:
            value=path.read_text(encoding='utf-8-sig')
            if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',value):raise AssertionError('Potential credential in '+str(path))
check('no env/keys/raw data/log bundles included',True)
record={'passed':all(x['passed'] for x in checks),'checks':checks,'protectedInputFiles':len(protected),'sourceFiles':len(copies),'sourceAnchors':len(evidence),'htmlFilesChecked':len(parsers),'brokenHtmlLinks':bad,'courseCharacters':len(text),'teachingStarted':False,'businessCodeModified':False,'platformTestsRerun':False}
(pack/'PACK_CHECK.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in record.items() if k not in ['checks','brokenHtmlLinks']},ensure_ascii=True))

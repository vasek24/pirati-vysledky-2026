import sys, json, collections, re
sys.path.insert(0,'/tmp/claude-1000/mesta-registry/scripts')
from load import *
PIR=720
def ni(s):
    s=str(s).strip()
    return int(s) if s.isdigit() else None
def pname(code):
    c=ni(code)
    if c is None: return '?'
    for d in (cns,cpp):
        for k,v in d.items():
            if ni(k)==c: return v.get('NAZEV_STRN') or v.get('NAZEV_STRP')
    return '?'
def zkr(code):
    c=ni(code)
    for k,v in cns.items():
        if ni(k)==c: return v['ZKRATKAN8']
    return str(c)
# council base (whole municipality = TYPZASTUP 1, excl. Prague KRAJ 1100)
council={}
for r in rzc:
    k=r['KODZASTUP']
    if k not in council:
        council[k]=dict(code=k,kraj=r['KRAJ'],okres=r['OKRES'],typ=r['TYPZASTUP'],druh=r['DRUHZASTUP'],
                        name=r['NAZEVZAST'],pop=r['POCOBYV'],mand=r['MANDATY'],stav=r['STAV_OBCE'],rows=0,popset=set())
    council[k]['rows']+=1; council[k]['popset'].add(r['POCOBYV'])
# lists
lists=collections.defaultdict(list)
for r in kvros: lists[r['KODZASTUP']].append(r)
# candidates keyed by (KODZASTUP,COBVODU,OSTRANA)
cands=collections.defaultdict(list)
for r in kvrk: cands[(r['KODZASTUP'],r['COBVODU'],r['OSTRANA'])].append(r)
def comp(r): return {ni(x) for x in r['SLOZENI'].split(',') if ni(x) is not None}
def ltype(r):
    c=comp(r)
    if PIR in c and c=={PIR}: return 'a'
    if PIR in c: return 'b'
    return ''
def analyze(code):
    cl=lists.get(code,[])
    out=dict(types=[], pir_lists=[], other_pir_cands=0, pir_cands_on_pir=0, examples=[])
    for L in cl:
        t=ltype(L)
        cs=cands.get((code,L['COBVODU'],L['OSTRANA']),[])
        if t:
            partners=sorted({pname(x) for x in comp(L)-{PIR}})
            out['pir_lists'].append(dict(t=t,ostrana=L['OSTRANA'],por=L['POR_STR_HL'],vstrana=L['VSTRANA'],
                 name=L['NAZEVCELK'],comp=L['SLOZENI'],partners=partners,
                 nc=len(cs),mand=L['MAND_STR'],hlasy=L['HLASY_STR'],proch=L['PROCHLSTR'],cobvodu=L['COBVODU']))
            out['pir_cands_on_pir']+=sum(1 for c in cs if c['PSTRANA']=='720')
        else:
            pc=[c for c in cs if c['PSTRANA']=='720']
            if pc:
                out['other_pir_cands']+=len(pc)
                for c in pc[:3]:
                    out['examples'].append(dict(list=L['NAZEVCELK'],ostrana=L['OSTRANA'],por=L['POR_STR_HL'],
                        vstrana=L['VSTRANA'],comp=L['SLOZENI'],poradi=c['PORCISLO'],jmeno=c['JMENO']+' '+c['PRIJMENI'],
                        nstrana=c['NSTRANA'],platnost=c['PLATNOST'],mandat=c['MANDAT']))
    out['types']=sorted({x['t'] for x in out['pir_lists']})
    return out
okres_name={ni(k):v for k,v in nuts.items()}
senate_names={o['nazevObvodu'] for o in json.load(open(B+'senate_obvody.json',encoding='utf-8'))['obvody']}
results={}
for code,c in council.items():
    if c['typ']!='1' or c['kraj']=='1100': continue
    results[code]=dict(c, **analyze(code))
json.dump(results, open(B+'scripts/results.json','w',encoding='utf-8'), ensure_ascii=False, indent=1, default=list)
print('whole-municipality councils (excl Prague):', len(results))
print('types counts:', collections.Counter(tuple(r['types']) for r in results.values()))
print('with any pirate list:', sum(1 for r in results.values() if r['types']))
print('whole-municipality with pirate-member cands on other lists:', sum(1 for r in results.values() if r['other_pir_cands']>0))
print('non-uniform POCOBYV:', [(k,v['popset']) for k,v in council.items() if len(v['popset'])>1])
print('STAV_OBCE=1 among results:', [(k,v['name']) for k,v in results.items() if v['stav']=='1'])
print('DRUHZASTUP among results:', collections.Counter(v['druh'] for v in results.values()))

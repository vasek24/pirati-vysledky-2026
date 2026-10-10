import sys, json, collections, re, csv
sys.path.insert(0,'/tmp/claude-1000/mesta-registry/scripts')
from load import *
R=json.load(open(B+'scripts/results.json',encoding='utf-8'))
senate={o['nazevObvodu'] for o in json.load(open(B+'senate_obvody.json',encoding='utf-8'))['obvody']}
def norm(s): return s.replace('–','-').replace('—','-').strip()
REG={'Central Bohemia':'2100','South Bohemia':'3100','Plzeň Region':'3200','Karlovy Vary Region':'4100',
 'Ústí nad Labem Region':'4200','Liberec Region':'5100','Hradec Králové Region':'5200','Pardubice Region':'5300',
 'Vysočina Region':'6100','South Moravia':'6200','Olomouc Region':'7100','Moravian-Silesian Region':'8100','Zlín Region':'7200'}
owner=[]  # (region, name)
for l in open('/home/vislousv/SyncThing/70_AI/pirati-elec-tracker/docs/analysis/mesta-towns.txt',encoding='utf-8'):
    if l.startswith('#') or ':' not in l: continue
    reg,rest=l.split(':',1)
    for n in rest.split('·'):
        n=n.strip()
        if n: owner.append((reg.strip(),n))
print('owner towns', len(owner))
# all whole-municipality councils by name
byname=collections.defaultdict(list)
for code,v in R.items(): byname[norm(v['name'])].append(v)
# also include councils with typ1 that failed selection (Prague excluded) -- not needed
def okres_name(code): return nuts.get(str(code),('',''))
def lname(v):
    t=''
    return t
def tlabel(v):
    return ','.join(v['types']) if v['types'] else 'd(none)'
def listnums(v):
    return ';'.join(f"OST{p['ostrana']}/POR{p['por']}({p['t']})" for p in v['pir_lists']) or ''
def coal(v):
    out=[]
    for p in v['pir_lists']:
        if p['t']=='a': out.append(f"{p['name']} [standalone]")
        else: out.append(f"{p['name']} | partners: {', '.join(p['partners'])}")
    return ' || '.join(out)
def senate_flag(name): return 'Y' if norm(name) in senate else ''
def okres_seat(v):
    on=okres_name(v['okres'])[1]
    return 'Y' if norm(v['name']).lower()==on.lower() else ''
rows88=[]; matchstats=collections.Counter(); unmatched=[]; ambig=[]
for reg,n in owner:
    kraj=REG[reg]
    cands=[v for v in byname.get(norm(n),[]) if v['kraj']==kraj]
    allc=byname.get(norm(n),[])
    if len(cands)==1:
        v=cands[0]; status='unique'
    elif len(cands)>1:
        v=max(cands,key=lambda c:int(c['pop'])); status='ambiguous->largest_pop'; ambig.append((n,[(c['code'],c['pop'],c['okres'],c['types']) for c in cands]))
    elif len(allc)==1:
        v=allc[0]; status='unique_nationwide(region_label_mismatch)'
    else:
        v=None; status='unmatched'; unmatched.append((n,[ (c['code'],c['kraj']) for c in allc ]))
    matchstats[status]+=1; (v is not None) and None
    rows88.append((reg,n,status,v))
print('matchstats', matchstats)
for reg,n,st,v in rows88:
    if v and v['kraj']!=REG[reg]: print('REGION-LABEL MISMATCH owner section',reg,'town',n,'-> ČSÚ kraj',v['kraj'])
print('unmatched', unmatched)
print('ambiguous', ambig)
with open(B+'specifics-table.tsv','w',encoding='utf-8',newline='') as f:
    w=csv.writer(f,delimiter='\t')
    w.writerow(['kraj','town','council_code','match','okres','pop_POCOBYV','seats_MANDATY','type','list_numbers(OSTRANA/POR_STR_HL)','coalition_or_list_name | partners','pirate_member_cands_on_other_lists','in_owner_list','ge10k','senate_seat','okres_seat'])
    for reg,n,status,v in rows88:
        if v:
            okr=okres_name(v['okres'])
            w.writerow([reg,n,v['code'],status,f"{okr[0]} {okr[1]}",v['pop'],v['mand'],tlabel(v),listnums(v),coal(v),v['other_pir_cands'],'Y',
               'Y' if int(v['pop'])>=10000 else ('borderline' if int(v['pop'])>=7000 else 'N'),senate_flag(v['name']),okres_seat(v)])
        else:
            w.writerow([reg,n,'',status,'','','','','','','','Y','','',''])
print('wrote specifics-table.tsv')
# nationwide qualifying (types a/b)
ownerset={norm(n) for _,n in owner}
owner_matched={ norm(v['name']) for reg,n,st,v in rows88 if v}
rows=[]
for code,v in R.items():
    if not v['types']: continue
    pop=int(v['pop'])
    if pop<7000: continue
    band='>=10000' if pop>=10000 else 'borderline 7000-9999'
    okr=okres_name(v['okres'])
    rows.append((band,pop,v,okr))
rows.sort(key=lambda x:(-x[1]))
hdr=['band','kraj','town','pop_POCOBYV','council_code','okres','type','list_numbers','coalition_or_list | partners','pirate_member_cands_on_other_lists','on_owner_list','senate_seat_flag','okres_seat_flag','pirate_2022_result']
with open(B+'qualifying-nationwide.tsv','w',encoding='utf-8',newline='') as f:
    w=csv.writer(f,delimiter='\t'); w.writerow(hdr)
    kraj_name=lambda code: nuts.get(str(code),('',''))[1]
    for band,pop,v,okr in rows:
        w.writerow([band,kraj_name(v['kraj']),v['name'],pop,v['code'],f"{okr[0]} {okr[1]}",tlabel(v),listnums(v),coal(v),v['other_pir_cands'],
                    'Y' if norm(v['name']) in ownerset else 'N',senate_flag(v['name']),okres_seat(v),''])
print('wrote qualifying-nationwide.tsv, rows', len(rows))
print('>=10k:', sum(1 for r in rows if r[0]=='>=10000'), ' borderline:', sum(1 for r in rows if r[0]!='>=10000'))
print('>=10k type a:', sum(1 for r in rows if r[0]=='>=10000' and r[2]['types']==['a']), ' type b-only:', sum(1 for r in rows if r[0]=='>=10000' and r[2]['types']==['b']), ' mixed:', sum(1 for r in rows if r[0]=='>=10000' and len(r[2]['types'])>1))

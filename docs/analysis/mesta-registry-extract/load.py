import csv, collections
B='/tmp/claude-1000/mesta-registry/'
def rd(p):
    with open(B+p, encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))
nuts = {r['NUMNUTS']:(r['NUTS'],r['NAZEVNUTS']) for r in rd('cis/csv_od/cnumnuts.csv')}
cpp = {r['PSTRANA']:r for r in rd('cis/csv_od/cpp.csv')}
cns = {r['NSTRANA']:r for r in rd('cis/csv_od/cns.csv')}
cvs = {r['VSTRANA']:r for r in rd('cis/csv_od/cvs.csv')}
rzc = rd('reg/csv_od/kvrzcoco.csv')
kvros = rd('reg/csv_od/kvros.csv')
kvrk = rd('reg/csv_od/kvrk.csv')

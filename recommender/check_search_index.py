"""Compare sampled MySQL products with OpenSearch documents (read-only).

Usage: MYSQL_USER=... MYSQL_PWD=... python3 recommender/check_search_index.py <alias>
"""
import json, subprocess, sys, urllib.request, os
alias = sys.argv[1]
ids = list(range(1, 10001, 50)) + [10000]  # 201 deterministic samples
q = f"""
select p.id, p.slug, p.name,
 (select group_concat(category_id order by sequence) from product_categories c where c.product_id=p.id),
 (select group_concat(value order by sequence separator '|') from product_tags t where t.product_id=p.id),
 (select min(total_price) from items i where i.product_id=p.id and i.sale_status='ALLOW' and i.deleted_at is null),
 (select max(total_price) from items i where i.product_id=p.id and i.sale_status='ALLOW' and i.deleted_at is null),
 (select group_concat(id order by sequence) from items i where i.product_id=p.id and i.sale_status='ALLOW' and i.deleted_at is null)
from products p where p.id in ({','.join(map(str, ids))}) order by p.id"""
out = subprocess.run(["/usr/local/mysql/bin/mysql","-h127.0.0.1","-u"+os.environ["MYSQL_USER"],"-N","-B","--default-character-set=utf8mb4","demo_nest_recommender","-e",q],capture_output=True,text=True,check=True).stdout
db = {}
for line in out.strip().split("\n"):
    pid, slug, name, cats, tags, mn, mx, items = line.split("\t")
    db[pid] = dict(slug=slug, name=name, categoryIds=cats.split(","), tags=sorted(tags.split("|")), minPrice=float(mn), maxPrice=float(mx), itemIds=items.split(","))
body = json.dumps({"size": len(ids), "query": {"ids": {"values": [str(i) for i in ids]}}}).encode()
req = urllib.request.Request(f"http://127.0.0.1:9200/{alias}/_search", body, {"Content-Type": "application/json"})
hits = json.load(urllib.request.urlopen(req))["hits"]["hits"]
os_ = {h["_id"]: h["_source"] for h in hits}
bad = []
for pid, d in db.items():
    s = os_.get(pid)
    if s is None: bad.append((pid, "missing")); continue
    got = dict(slug=s["slug"], name=s["name"], categoryIds=s["categoryIds"], tags=sorted(s["tags"]), minPrice=float(s["minPrice"]), maxPrice=float(s["maxPrice"]), itemIds=[i["itemId"] for i in s["items"]])
    if s["productId"] != pid: bad.append((pid, "productId"))
    for k in d:
        if d[k] != got[k]: bad.append((pid, k, d[k], got[k]))
print(json.dumps({"sampled": len(ids), "db_rows": len(db), "os_hits": len(os_), "mismatches": len(bad), "first": bad[:5]}, ensure_ascii=False))

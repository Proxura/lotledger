#!/usr/bin/env bash
# Seed a demo account on the local dev server for filming.
set -e
B=http://localhost:8788
J=/tmp/ll-demo-cookies.txt
rm -f $J
post() { curl -s -b $J -c $J -H 'content-type: application/json' -X POST "$B$1" -d "$2"; }
patch() { curl -s -b $J -c $J -H 'content-type: application/json' -X PATCH "$B$1" -d "$2"; }
EMAIL="demo+$(date +%s)@lotledger.local"
post /api/auth/signup "{\"email\":\"$EMAIL\",\"password\":\"demo-password-123\",\"business\":\"Four Waters\"}" >/dev/null
patch /api/account '{"lot_prefix":"FW-","lot_next":101,"lot_step":1}' >/dev/null
P1=$(post /api/products '{"name":"Fresh Milled Flour","unit_label":"bag","shelf_life_days":90}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
P2=$(post /api/products '{"name":"TaloVera Skin Cream","unit_label":"jar","shelf_life_days":365}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
P3=$(post /api/products '{"name":"Pure Vanilla Extract","unit_label":"jar","shelf_life_days":730}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
d() { date -d "$1 days ago" +%F; }
L1=$(post /api/lots "{\"product_id\":\"$P1\",\"made_at\":\"$(d 70)\",\"units_made\":24,\"unit_size\":\"2 lb\",\"supplier\":\"Janie's Mill\",\"inputs\":\"50 lb organic hard red wheat, mill lot 2211\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
L2=$(post /api/lots "{\"product_id\":\"$P2\",\"made_at\":\"$(d 40)\",\"units_made\":30,\"unit_size\":\"4 oz\",\"supplier\":\"home rendered suet\",\"inputs\":\"beef tallow batch T-14, aloe, jojoba\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
L3=$(post /api/lots "{\"product_id\":\"$P3\",\"made_at\":\"$(d 200)\",\"units_made\":18,\"unit_size\":\"2 oz\",\"supplier\":\"Madagascar beans, lot MB-7\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
L4=$(post /api/lots "{\"product_id\":\"$P1\",\"made_at\":\"$(d 12)\",\"units_made\":24,\"unit_size\":\"2 lb\",\"supplier\":\"Janie's Mill\",\"inputs\":\"50 lb organic hard red wheat, mill lot 2240\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
patch /api/lots/$L1 '{"move":{"kind":"sale","units":9,"note":"#1031"}}' >/dev/null
patch /api/lots/$L1 '{"move":{"kind":"market","units":8,"note":"Alma farmers market"}}' >/dev/null
patch /api/lots/$L2 '{"move":{"kind":"sale","units":11,"note":"#1033"}}' >/dev/null
patch /api/lots/$L3 '{"move":{"kind":"sale","units":6,"note":"#1020"}}' >/dev/null
patch /api/lots/$L3 '{"move":{"kind":"sample","units":2,"note":"market samples"}}' >/dev/null
post /api/orders '{"order_ref":"#1041","customer_name":"Dana Whitfield","email":"dana@example.com","line1":"118 Oak St","city":"Mount Pleasant","state":"MI","zip":"48858","items":"2 x Fresh Milled Flour","weight_oz":38}' >/dev/null
post /api/orders '{"order_ref":"#1042","customer_name":"Marcus Lee","email":"marcus@example.com","line1":"907 Birch Ave","line2":"Apt 2","city":"Grand Rapids","state":"MI","zip":"49503","items":"1 x TaloVera Skin Cream","weight_oz":7}' >/dev/null
post /api/orders '{"order_ref":"#1043","customer_name":"Priya Natarajan","line1":"41 Lakeshore Dr","city":"Traverse City","state":"MI","zip":"49684","items":"1 x Pure Vanilla Extract","weight_oz":9}' >/dev/null
echo "$EMAIL" > /tmp/ll-demo-email; echo "EMAIL=$EMAIL"

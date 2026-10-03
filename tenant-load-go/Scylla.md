# Project Horizon — Command Cheat Sheet

Quick lookup of every command used in the ScyllaDB benchmark. Organised by phase; each block says which machine to run it on.

---

## 0. Machines

| Role | Public IP (SSH) | Private IP | Prompt | Type |
|---|---|---|---|---|
| Node1 (seed) | 13.235.60.213 | 10.0.169.41 | `ubuntu@ip-10-0-169-41` | i4i.xlarge |
| Node2 | 13.207.206.160 | 10.0.161.242 | `ubuntu@ip-10-0-161-242` | i4i.xlarge |
| Node3 | 13.207.48.234 | 10.0.165.120 | `ubuntu@ip-10-0-165-120` | i4i.xlarge |
| LoadGen | 43.205.92.135 | 10.0.171.33 | `ubuntu@ip-10-0-171-33` | c7i.2xlarge |
| Monitoring | 43.205.137.135 | — | `ubuntu@I` | c7i.xlarge |

Rule: anything between instances uses **private IPs**. `nproc` tells LoadGen (8) from Monitoring (4).

---

## 1. SSH (from the Mac, folder with `sakey.pem`)

```bash
chmod 400 sakey.pem
ssh -i sakey.pem ubuntu@13.235.60.213     # Node1
ssh -i sakey.pem ubuntu@13.207.206.160    # Node2
ssh -i sakey.pem ubuntu@13.207.48.234     # Node3
ssh -i sakey.pem ubuntu@43.205.92.135     # LoadGen
ssh -i sakey.pem ubuntu@43.205.137.135    # Monitoring
ssh -i sakey.pem -L 3001:localhost:3001 ubuntu@43.205.137.135   # Monitoring + Grafana tunnel → http://localhost:3001
```

Optional `~/.ssh/config` so `ssh node1`, `ssh loadgen`, `ssh mon` work:
```
Host node1
  HostName 13.235.60.213
Host node2
  HostName 13.207.206.160
Host node3
  HostName 13.207.48.234
Host loadgen
  HostName 43.205.92.135
Host mon
  HostName 43.205.137.135
  LocalForward 3001 localhost:3001
Host node1 node2 node3 loadgen mon
  User ubuntu
  IdentityFile ~/Documents/SDB/sakey.pem
  ServerAliveInterval 30
```

---

## 2. Install ScyllaDB (each node)

```bash
lsblk                                         # find the ~873 GB instance-store NVMe (nvme0n1 or nvme1n1 — differs per node!)
curl -sSf get.scylladb.com/server | sudo bash
sudo scylla_setup                             # YES to RAID/XFS on the instance NVMe (never the root disk), io_setup, no developer mode
scylla --version                              # all nodes must match (2026.3.2-0.20260923.4ee3835abea7)
cat /etc/scylla.d/io_properties.yaml          # expect ~100k read IOPS, ~55k write IOPS
```

`/etc/scylla/scylla.yaml` (per node):
```yaml
cluster_name: 'horizon'
seed_provider:
  - class_name: org.apache.cassandra.locator.SimpleSeedProvider
    parameters:
      - seeds: "10.0.169.41"          # Node1 on ALL nodes
listen_address: <this node's private IP>
rpc_address: <this node's private IP>
endpoint_snitch: Ec2Snitch
```

Start one node at a time (Node1 first, wait for UN):
```bash
sudo systemctl start scylla-server
sudo journalctl -u scylla-server -f --since now     # Ctrl C at "serving"
nodetool status                                     # 3 × UN at the end
nodetool describecluster                            # one schema version
```

---

## 3. Troubleshooting fixes used

**Network between nodes**
```bash
nc -zv 10.0.169.41 7000
nc -zv 10.0.169.41 9042
```

**Join rejected: cluster name mismatch** — set `cluster_name` identically everywhere, wipe the joining node, retry:
```bash
sudo systemctl stop scylla-server
grep -n "cluster_name" /etc/scylla/scylla.yaml
sudo rm -rf /var/lib/scylla/data/* /var/lib/scylla/commitlog/* /var/lib/scylla/hints/* /var/lib/scylla/view_hints/*
```

**Join rejected: feature check (version mismatch)** — point the node at Node1's repo and pin the version:
```bash
cat /etc/apt/sources.list.d/scylla*.list    # on Node1
sudo rm -f /etc/apt/sources.list.d/scylla*.list
echo "deb [arch=amd64,arm64 signed-by=/etc/apt/keyrings/scylladb.gpg] https://downloads.scylladb.com/downloads/scylla/deb/debian-ubuntu/scylladb-2026.3 stable main" | sudo tee /etc/apt/sources.list.d/scylla.list
sudo apt-get update
apt-cache madison scylla-node-exporter | head -3
V="2026.3.2-0.20260923.4ee3835abea7-1"; NE="1:1.12.1-1"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::="--force-confold" \
  scylla=$V scylla-server=$V scylla-conf=$V scylla-kernel-conf=$V scylla-cqlsh=$V scylla-python3=$V scylla-node-exporter=$NE
```

**Node1 data on root EBS (disk full, node isolated)** — move data dir to the NVMe:
```bash
df -h /var/lib/scylla /                       # /dev/root at 100% = wrong disk
sudo systemctl stop scylla-server
sudo rm -rf /var/lib/scylla.old               # or: sudo bash -c 'rm -rf /var/lib/scylla/*' — frees the root disk
sudo /opt/scylladb/scripts/scylla_raid_setup --disks /dev/nvme0n1 --online-discard 1   # Node1's NVMe was nvme0n1
df -h /var/lib/scylla                         # must show ~873G, not /dev/root
sudo update-initramfs -u -k all
sudo chown scylla:scylla /var/lib/scylla
sudo scylla_io_setup                          # re-measure: 3,001 IOPS (EBS) → 100,000 (NVMe)
```

**nodetool "Connection refused"** = Scylla not running or still starting:
```bash
sudo systemctl status scylla-server --no-pager
sudo journalctl -u scylla-server -n 60 --no-pager | grep -iE "error|fail|exception"
```

---

## 4. Monitoring stack (Monitoring box)

```bash
sudo apt-get update && sudo apt-get install -y docker.io git python3 jq
sudo usermod -aG docker $USER && exit        # log back in
git clone https://github.com/scylladb/scylla-monitoring.git && cd scylla-monitoring
cat > prometheus/scylla_servers.yml <<'EOF'
- targets:
    - 10.0.169.41
    - 10.0.161.242
    - 10.0.165.120
  labels:
    cluster: horizon
    dc: ap-south
EOF
mkdir -p ~/prom_data
./start-all.sh -v 2026.3 -d ~/prom_data -g 3001     # Grafana on 3001
git rev-parse --short HEAD                           # used master @ 9b3dad7b
```

Checks:
```bash
curl -s localhost:9090/-/ready; echo
docker ps --format "table {{.Names}}\t{{.Status}}"
Q2() { curl -s localhost:9090/api/v1/query --data-urlencode "query=$1" | jq -r '.data.result[].value[1]'; }
Q2 'count(scylla_reactor_utilization)'               # 12 = all shards scraped
```

Grafana container conflict (`agraf-3001` exists):
```bash
docker rm -f agraf-3001 agrafrender-3001
./start-grafana.sh -L loki:3100 -E -p aprom:9090 -D --net=monitor-net -g 3001 -m aalert:9093 -M 3 -v 2026.3
```

What data exists over the last 10 h:
```bash
END=$(date -u +%s); START=$((END - 36000))
curl -s localhost:9090/api/v1/query_range --data-urlencode 'query=count(scylla_reactor_utilization)' \
  --data-urlencode "start=$START" --data-urlencode "end=$END" --data-urlencode 'step=600' |
  jq -r '.data.result[0].values[]? | "\(.[0] | todate)\t\(.[1]) series"'
```

---

## 5. scylla-bench (LoadGen)

```bash
sudo apt-get install -y tmux git
curl -sSL https://go.dev/dl/go1.23.4.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc && source ~/.bashrc
git clone https://github.com/scylladb/scylla-bench.git && cd scylla-bench
git checkout v1.3.3
go build -o ~/go/bin/scylla-bench .          # go install @latest fails (replace directives)
which scylla-bench
```

tmux: `tmux new -s NAME` · detach **Ctrl B, D** · `tmux attach -t NAME` · split **Ctrl B, %** · `tmux ls`

---

## 6. Keyspace (Node1)

```bash
cqlsh 10.0.169.41 -e "CREATE KEYSPACE IF NOT EXISTS scylla_bench WITH replication = {'class':'NetworkTopologyStrategy','ap-south':3};"
cqlsh 10.0.169.41 -e "DESCRIBE TABLE scylla_bench.test;"     # pk bigint, ck bigint, v blob; ICS compaction
```
Expected warning: not RF-rack-valid (RF 3, one rack).

---

## 7. Load ~100 GB (LoadGen, in tmux)

100k partitions × 1,000 rows × 1 KB ≈ 102 GB logical.
```bash
tmux new -s load2
source ~/.bashrc
date -u | tee ~/load.start
scylla-bench -workload sequential -mode write \
  -partition-count 100000 -clustering-row-count 1000 -clustering-row-size 1024 \
  -concurrency 200 -replication-factor 3 \
  -nodes 10.0.169.41,10.0.161.242,10.0.165.120 2>&1 | tee ~/load.log
```
Result: 100M rows in 16m 32s, 100,796 writes/s.

---

## 8. Measured run — 30k reads + 10k writes concurrently, 30 min (LoadGen)

```bash
tmux new -s run4
source ~/.bashrc
date -u | tee ~/run4.start
( scylla-bench -workload uniform -mode read -max-rate 30000 -duration 30m \
    -partition-count 100000 -clustering-row-count 1000 -clustering-row-size 1024 \
    -concurrency 200 -nodes 10.0.169.41,10.0.161.242,10.0.165.120 > ~/read4.log 2>&1 & ) ; \
scylla-bench -workload uniform -mode write -max-rate 10000 -duration 30m \
    -partition-count 100000 -clustering-row-count 1000 -clustering-row-size 1024 \
    -concurrency 100 -nodes 10.0.169.41,10.0.161.242,10.0.165.120 2>&1 | tee ~/write4.log
```

Check progress / results:
```bash
pgrep -a scylla-bench
tail -3 ~/read4.log ~/write4.log
tail -25 ~/read4.log | grep -A20 "^Results"
```

| Run | Reads/s | Read p99 | Writes/s | Write p99 (c-o) |
|---|---|---|---|---|
| Run 3, before compaction | 3,401 | 456 ms | 9,999 | 7.9 ms |
| Run 4, after compaction | 7,172 | 156 ms | 9,999 | 14.4 ms |

---

## 9. Compaction experiment (each node, one at a time)

```bash
nodetool tablehistograms scylla_bench test | tee ~/before-compact.txt   # SSTables p50 = 3
tmux new -s compact
nodetool compact scylla_bench test
watch -n 30 nodetool compactionstats          # done when pending = 0
nodetool tablehistograms scylla_bench test | tee ~/after-compact.txt
```

Verify all three nodes from the Mac (pass = partition size p50 1131752, min ~943128):
```bash
for ip in 13.235.60.213 13.207.206.160 13.207.48.234; do
  echo "===== $ip"
  ssh -i sakey.pem ubuntu@$ip '
    hostname -I | awk "{print \"node:\", \$1}"
    nodetool compactionstats | grep "pending tasks"
    nodetool tablestats scylla_bench.test | grep "SSTable count"
    nodetool tablehistograms scylla_bench test | awk "/^50%|^Min/ {print \$1, \"partition size:\", \$5}"
  '
done
```
Note: SSTable count stays ~128 with ICS (fragments of one run) — check partition size, not count.

---

## 10. Resource report for a run window (Monitoring box)

Set END = run start + 30 min (run 4: `2026-10-02T19:04:43Z`; run 3: `2026-10-01T03:49:24Z`).
```bash
END=2026-10-02T19:04:43Z
Q() { curl -s http://localhost:9090/api/v1/query --data-urlencode "query=$1" \
  --data-urlencode "time=$END" | jq -r '.data.result[] | "\(.metric.instance)\t\(.value[1])"'; }

echo "Reactor %";         Q 'avg by (instance)(avg_over_time(scylla_reactor_utilization[30m]))'
echo "Disk read MB/s";    Q 'sum by (instance)(rate(node_disk_read_bytes_total{device=~"nvme.*"}[30m]))/1e6'
echo "Disk read IOPS";    Q 'sum by (instance)(rate(node_disk_reads_completed_total{device=~"nvme.*"}[30m]))'
echo "KB per disk read";  Q 'sum by (instance)(rate(node_disk_read_bytes_total{device=~"nvme.*"}[30m])) / sum by (instance)(rate(node_disk_reads_completed_total{device=~"nvme.*"}[30m])) / 1024'
echo "Disk write MB/s";   Q 'sum by (instance)(rate(node_disk_written_bytes_total{device=~"nvme.*"}[30m]))/1e6'
echo "Disk write IOPS";   Q 'sum by (instance)(rate(node_disk_writes_completed_total{device=~"nvme.*"}[30m]))'
echo "KB per disk write"; Q 'sum by (instance)(rate(node_disk_written_bytes_total{device=~"nvme.*"}[30m])) / sum by (instance)(rate(node_disk_writes_completed_total{device=~"nvme.*"}[30m])) / 1024'
echo "Disk busy %";       Q '100*max by (instance)(rate(node_disk_io_time_seconds_total{device=~"nvme.*"}[30m]))'
echo "Cache hit %";       Q '100*sum by (instance)(rate(scylla_cache_row_hits[30m])) / (sum by (instance)(rate(scylla_cache_row_hits[30m])) + sum by (instance)(rate(scylla_cache_row_misses[30m])))'
```

---

## 11. Monitoring dump and restore

Dump (Monitoring box) — take screenshots and run queries first:
```bash
cd ~/scylla-monitoring && ./kill-all.sh
cd ~ && sudo tar czf horizon-prom-dump.tgz prom_data && sudo chown ubuntu:ubuntu horizon-prom-dump.tgz
```

Restore (Mac, needs Docker + bash 5):
```bash
brew install bash && export PATH="/opt/homebrew/bin:$PATH" && hash -r
tar xzf horizon-prom-dump.tgz && chmod -R a+rwX prom_data
git clone https://github.com/scylladb/scylla-monitoring && cd scylla-monitoring && git checkout 9b3dad7b
# create prometheus/scylla_servers.yml as in section 4
./start-all.sh -v 2026.3 -d ../prom_data -b "--storage.tsdb.retention.time=365d"
```

---

## 12. Copy files to the Mac

```bash
scp -i sakey.pem ubuntu@43.205.92.135:~/read4.log ubuntu@43.205.92.135:~/write4.log ubuntu@43.205.92.135:~/run4.start .
scp -i sakey.pem ubuntu@43.205.137.135:~/horizon-prom-dump.tgz .
```
Newer macOS scp: brace lists `{a,b}` don't work — list files separately or add `-O`.

---

## 13. Deliverable A schema validation (Node1)

```bash
scp -i sakey.pem horizon-schema.cql horizon-test.cql ubuntu@13.235.60.213:~
cqlsh 10.0.169.41 -f ~/horizon-schema.cql
cqlsh 10.0.169.41 -e "DESCRIBE KEYSPACE apexx;" > ~/apexx-schema.txt
cqlsh 10.0.169.41 -f ~/horizon-test.cql 2>&1 | tee ~/horizon-test.out
```
Views/indexes rejected on tablets (RF-rack-valid) → keyspace with `AND tablets = {'enabled': false}`.

Key test queries:
```sql
SELECT * FROM apexx.user_profiles WHERE user_id = 11111111-1111-1111-1111-111111111111;
TRACING ON; SELECT * FROM apexx.user_profiles WHERE email = 'alice@example.com'; TRACING OFF;   -- 2 hops, 0.9 ms
SELECT * FROM apexx.user_profiles_by_phone WHERE phone_number = '+14155550102';                 -- 2 rows
```

---

## 14. Table definitions

### scylla-bench table (Deliverable B — created by scylla-bench)
```sql
-- keyspace pre-created by us
CREATE KEYSPACE scylla_bench
  WITH replication = {'class': 'NetworkTopologyStrategy', 'ap-south': 3};

-- table created automatically by scylla-bench (check: DESCRIBE TABLE scylla_bench.test;)
CREATE TABLE scylla_bench.test (
  pk bigint,      -- partition key: 0 … 99,999
  ck bigint,      -- clustering key: 0 … 999 rows per partition
  v  blob,        -- 1 KB value (-clustering-row-size 1024)
  PRIMARY KEY (pk, ck)
) WITH compaction = {'class': 'IncrementalCompactionStrategy'};
```

### ApexX data model (Deliverable A — horizon-schema.cql)
```sql
-- Test cluster keyspace (production: 'us-east-1': 3, 'eu-west-1': 3, tablets on)
CREATE KEYSPACE IF NOT EXISTS apexx
  WITH replication = {'class': 'NetworkTopologyStrategy', 'ap-south': 3}
  AND tablets = {'enabled': false};   -- needed on the 1-rack test cluster for views/indexes

USE apexx;

-- TABLE 1: session state — one row per user, read on every auction
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      uuid,
  last_active  timestamp,
  device_type  text,
  email        text,
  phone_number text,
  PRIMARY KEY (user_id)                         -- partition key = whole primary key, no clustering key
) WITH compaction = {'class': 'LeveledCompactionStrategy'}
  AND per_partition_rate_limit = {'max_reads_per_second': 1000, 'max_writes_per_second': 200};

-- Support: lookup by email (global secondary index, 2 hops)
CREATE INDEX IF NOT EXISTS user_profiles_by_email ON user_profiles (email);

-- Fraud: lookup by phone (materialized view, 1 hop, returns every account on a number)
CREATE MATERIALIZED VIEW IF NOT EXISTS user_profiles_by_phone AS
  SELECT phone_number, user_id, email, device_type, last_active
  FROM user_profiles
  WHERE phone_number IS NOT NULL AND user_id IS NOT NULL
  PRIMARY KEY (phone_number, user_id);

-- Helper: bucket count per publisher, changed only at hour boundaries
CREATE TABLE IF NOT EXISTS publisher_shards (
  publisher_id   text,
  effective_from timestamp,
  shard_count    smallint,                      -- N = peak rows/s × 3,600 ÷ 100,000 (min 1)
  PRIMARY KEY (publisher_id, effective_from)
) WITH CLUSTERING ORDER BY (effective_from DESC);

-- TABLE 2: bid / impression log — append-only, by publisher over time, 30-day retention
CREATE TABLE IF NOT EXISTS bid_log (
  publisher_id     text,
  hour             timestamp,                   -- event time truncated to the hour
  shard            smallint,                    -- app sets hash(bid_id) % N (call it "bucket" in production)
  event_ts         timestamp,
  bid_id           timeuuid,
  auction_id       uuid,
  user_id          uuid,
  advertiser_id    text,
  bid_price_micros bigint,
  won              boolean,
  device_type      text,
  PRIMARY KEY ((publisher_id, hour, shard), event_ts, bid_id)
  --           └──── partition key ────┘   └─ clustering ─┘
) WITH CLUSTERING ORDER BY (event_ts DESC, bid_id ASC)
  AND default_time_to_live = 2592000            -- 30 days
  AND gc_grace_seconds = 86400                  -- insert-only: drop expired days after 1 day, not 10
  AND compaction = {'class': 'TimeWindowCompactionStrategy',
                    'compaction_window_unit': 'DAYS',
                    'compaction_window_size': 1};
```

### Key choices at a glance

| Table | Partition key | Clustering key | Why |
|---|---|---|---|
| `scylla_bench.test` | `pk` | `ck` | Benchmark's fixed schema: 100k partitions × 1,000 rows |
| `user_profiles` | `user_id` | none | One user, one profile, one row |
| `user_profiles_by_phone` | `phone_number` | `user_id` | One phone can map to several users (fraud signal) |
| `publisher_shards` | `publisher_id` | `effective_from DESC` | Latest bucket count first |
| `bid_log` | `(publisher_id, hour, shard)` | `event_ts DESC, bid_id` | Query by publisher; hour bounds size; shard spreads hot publishers; time-range slices; bid_id prevents overwrites |

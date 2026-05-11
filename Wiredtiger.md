# WiredTiger Configuration Guide for MongoDB
## Complete Tuning Parameters, Effects & Testing Methodology

---

## Table of Contents
1. [Cache & Memory Configuration](#cache--memory-configuration)
2. [Eviction Configuration](#eviction-configuration)
3. [Checkpoint Configuration](#checkpoint-configuration)
4. [I/O Configuration](#io-configuration)
5. [Logging Configuration](#logging-configuration)
6. [Advanced Performance Tuning](#advanced-performance-tuning)
7. [Testing Methodology](#testing-methodology)
8. [Monitoring & Metrics](#monitoring--metrics)

---

## How to Apply WiredTiger Configurations in MongoDB

### Method 1: mongod.conf (Standard Options)
```yaml
storage:
  dbPath: /data/db
  wiredTiger:
    engineConfig:
      cacheSizeGB: 2
      journalCompressor: snappy
      directoryForIndexes: false
    collectionConfig:
      blockCompressor: snappy
    indexConfig:
      prefixCompression: true
```

### Method 2: Command Line (Advanced Options)
```bash
mongod --wiredTigerEngineConfigString="eviction_dirty_target=10,eviction_dirty_trigger=25,cache_overhead=12"
```

### Method 3: mongod.conf with configString (Recommended for Advanced Tuning)
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 4
      configString: "eviction_dirty_target=10,eviction_dirty_trigger=25,cache_overhead=12,eviction_target=70,eviction_trigger=90"
```

---

## 1. Cache & Memory Configuration

### 1.1 cache_size
**Parameter:** `cacheSizeGB` (MongoDB) or `cache_size` (WiredTiger)

**Effect:** Controls the maximum amount of memory WiredTiger will use for caching data and indexes.

**Default:** 50% of RAM - 1GB (or 256MB if RAM < 1GB)

**Configuration:**
```yaml
# mongod.conf
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 4
```

**Testing Methodology:**
```bash
# 1. Monitor cache utilization before tuning
db.serverStatus().wiredTiger.cache

# 2. Run workload and observe:
# - Cache usage patterns
# - Eviction rates
# - Page faults

# 3. Key metrics to watch:
# - bytes currently in the cache
# - bytes read into cache
# - bytes written from cache
# - pages evicted by app threads
```

**Test Script:**
```javascript
// Insert test data to fill cache
for (let i = 0; i < 1000000; i++) {
    db.testCache.insert({
        _id: i,
        data: "x".repeat(1000),
        timestamp: new Date()
    });
}

// Monitor cache stats
let stats = db.serverStatus().wiredTiger.cache;
print("Cache size: " + stats["maximum bytes configured"]);
print("Currently in cache: " + stats["bytes currently in the cache"]);
print("Cache utilization %: " + (stats["bytes currently in the cache"] / stats["maximum bytes configured"] * 100).toFixed(2));
```

**Expected Impact:**
- **Increase cache:** Fewer disk reads, faster queries, higher memory usage
- **Decrease cache:** More disk I/O, slower queries, lower memory usage
- **Optimal:** 60-80% of available RAM for dedicated MongoDB servers

---

### 1.2 cache_overhead
**Parameter:** `cache_overhead`

**Effect:** Accounts for memory allocator overhead. WiredTiger treats cache as (cache_size * (100 + overhead) / 100).

**Default:** 8%

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "cache_overhead=12"
```

**When to Adjust:**
- Use `12-15%` for jemalloc
- Use `8-10%` for glibc malloc
- Use `5-8%` for tcmalloc

**Testing:**
```javascript
// Monitor actual memory usage vs configured cache
// Compare RSS (Resident Set Size) with configured cache

// Run this in shell:
db.serverStatus().mem
// Compare 'resident' with your cacheSizeGB setting
```

**Expected Impact:**
- Higher overhead → More conservative cache management
- Lower overhead → More aggressive cache usage, risk of OOM

---

## 2. Eviction Configuration

Eviction is the process of removing pages from cache to make room for new data. This is the most critical area for performance tuning.

### 2.1 eviction_target
**Parameter:** `eviction_target`

**Effect:** Cache usage % at which background eviction threads start working.

**Default:** 80%

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "eviction_target=70"
```

**Testing Script:**
```javascript
// Test eviction behavior
function testEvictionTarget() {
    // Fill cache beyond eviction_target
    for (let i = 0; i < 2000000; i++) {
        db.evictionTest.insert({
            _id: i,
            payload: "x".repeat(5000),
            nested: { field1: i, field2: i * 2 }
        });
        
        if (i % 50000 === 0) {
            let cache = db.serverStatus().wiredTiger.cache;
            let cacheUsed = cache["bytes currently in the cache"];
            let cacheMax = cache["maximum bytes configured"];
            let pctUsed = (cacheUsed / cacheMax * 100).toFixed(2);
            
            print(`Iteration ${i}: Cache ${pctUsed}% full`);
            print(`  Eviction worker threads: ${cache["eviction worker thread active"]}`);
            print(`  Pages evicted: ${cache["pages evicted by app threads"]}`);
        }
    }
}

testEvictionTarget();
```

**Expected Impact:**
- **Lower value (60-70%):** More aggressive eviction, smoother performance, higher CPU
- **Higher value (85-90%):** Less eviction overhead, risk of application thread eviction
- **Optimal:** 70-75% for write-heavy, 80-85% for read-heavy

---

### 2.2 eviction_trigger
**Parameter:** `eviction_trigger`

**Effect:** Cache usage % at which application threads must participate in eviction.

**Default:** 95%

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "eviction_trigger=90"
```

**Testing:**
```javascript
function monitorAppThreadEviction() {
    let before = db.serverStatus().wiredTiger.cache["application threads page read from disk to cache count"];
    
    // Run heavy workload
    db.evictionTest.find({}).limit(100000).forEach(doc => {
        db.evictionTest.update({_id: doc._id}, {$set: {modified: new Date()}});
    });
    
    let after = db.serverStatus().wiredTiger.cache["application threads page read from disk to cache count"];
    let appEvictions = db.serverStatus().wiredTiger.cache["pages evicted by app threads"];
    
    print(`App thread reads: ${after - before}`);
    print(`App thread evictions: ${appEvictions}`);
    
    if (appEvictions > 0) {
        print("WARNING: Application threads participating in eviction!");
        print("Consider lowering eviction_trigger or increasing cache size");
    }
}

monitorAppThreadEviction();
```

**Expected Impact:**
- **Lower value (85-90%):** Application threads help earlier, more predictable latency
- **Higher value (95-98%):** More cache utilization, risk of sudden latency spikes
- **Rule:** eviction_trigger should be 15-20 points higher than eviction_target

---

### 2.3 eviction_dirty_target
**Parameter:** `eviction_dirty_target`

**Effect:** % of cache filled with dirty (modified) pages before background eviction starts.

**Default:** 5%

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "eviction_dirty_target=10,eviction_dirty_trigger=20"
```

**Testing:**
```javascript
function testDirtyEviction() {
    db.dirtyTest.drop();
    db.dirtyTest.createIndex({field1: 1});
    
    // Generate dirty pages
    for (let i = 0; i < 500000; i++) {
        db.dirtyTest.insert({
            _id: i,
            field1: Math.floor(Math.random() * 100000),
            data: "x".repeat(2000)
        });
    }
    
    // Update to create more dirty pages
    db.dirtyTest.updateMany({}, {$set: {modified: new Date(), counter: 1}});
    
    let cache = db.serverStatus().wiredTiger.cache;
    let dirtyBytes = cache["tracked dirty bytes in the cache"];
    let totalBytes = cache["bytes currently in the cache"];
    let dirtyPct = (dirtyBytes / totalBytes * 100).toFixed(2);
    
    print(`Dirty pages: ${dirtyPct}% of cache`);
    print(`Dirty bytes: ${(dirtyBytes / 1024 / 1024).toFixed(2)} MB`);
    print(`Modified pages evicted: ${cache["modified pages evicted"]}`);
}

testDirtyEviction();
```

**Expected Impact:**
- **Write-heavy workload:** Increase to 10-15% to reduce checkpoint overhead
- **Read-heavy workload:** Keep at default 5%
- **High dirty ratio:** May cause checkpoint stalls

---

### 2.4 eviction_updates_target / eviction_updates_trigger
**Parameter:** `eviction_updates_target`, `eviction_updates_trigger`

**Effect:** Controls eviction based on update chain length (MVCC overhead).

**Default:** 
- Target: 0 (calculated as eviction_dirty_target / 2)
- Trigger: 0 (calculated as eviction_dirty_trigger / 2)

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "eviction_updates_target=5,eviction_updates_trigger=10"
```

**Testing:**
```javascript
function testUpdateChains() {
    db.updateTest.drop();
    db.updateTest.insert({_id: 1, counter: 0, data: "initial"});
    
    // Create long update chains
    for (let i = 0; i < 10000; i++) {
        db.updateTest.update({_id: 1}, {$inc: {counter: 1}, $set: {data: "update_" + i}});
        
        if (i % 1000 === 0) {
            let cache = db.serverStatus().wiredTiger.cache;
            print(`Iteration ${i}:`);
            print(`  Bytes allocated for updates: ${cache["bytes allocated for updates"]}`);
        }
    }
    
    let cache = db.serverStatus().wiredTiger.cache;
    let updateBytes = cache["bytes allocated for updates"];
    let totalBytes = cache["bytes currently in the cache"];
    let updatePct = (updateBytes / totalBytes * 100).toFixed(2);
    
    print(`\nUpdate overhead: ${updatePct}% of cache`);
}

testUpdateChains();
```

**Expected Impact:**
- Critical for workloads with frequent updates to same documents
- Lower values → Earlier eviction of pages with long update chains
- Prevents cache from being dominated by MVCC metadata

---

### 2.5 eviction.threads_min / threads_max
**Parameter:** `eviction=(threads_min=X,threads_max=Y)`

**Effect:** Controls number of eviction worker threads.

**Default:** min=1, max=8

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "eviction=(threads_min=2,threads_max=16)"
```

**Testing:**
```javascript
function monitorEvictionThreads() {
    let interval = setInterval(() => {
        let cache = db.serverStatus().wiredTiger.cache;
        print(`Active eviction workers: ${cache["eviction worker thread active"]}`);
        print(`Stable workers: ${cache["eviction worker thread stable number"]}`);
    }, 1000);
    
    // Run workload
    for (let i = 0; i < 100000; i++) {
        db.threadTest.insert({_id: i, data: "x".repeat(5000)});
    }
    
    clearInterval(interval);
}

monitorEvictionThreads();
```

**Expected Impact:**
- **More threads:** Better for high-throughput systems, more CPU usage
- **Fewer threads:** Lower overhead, may bottleneck on busy systems
- **Optimal:** 1 thread per 2-4 CPU cores

---

## 3. Checkpoint Configuration

### 3.1 checkpoint.wait
**Parameter:** `checkpoint=(wait=X)`

**Effect:** Seconds between automatic checkpoints.

**Default:** 60 seconds (when logging enabled) or 0 (disabled when logging disabled)

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "checkpoint=(wait=300)"
```

```bash
# Or use MongoDB's native setting
mongod --wiredTigerCheckpointDelaySecs=300
```

**Testing:**
```javascript
function testCheckpointInterval() {
    let checkpoints = [];
    
    // Monitor for 10 minutes
    for (let i = 0; i < 600; i++) {
        let log = db.serverStatus().wiredTiger.log;
        if (log && log["log records processed by checkpoint"]) {
            checkpoints.push({
                time: new Date(),
                records: log["log records processed by checkpoint"]
            });
        }
        sleep(1000);
    }
    
    // Analyze checkpoint intervals
    for (let i = 1; i < checkpoints.length; i++) {
        let interval = (checkpoints[i].time - checkpoints[i-1].time) / 1000;
        print(`Checkpoint interval: ${interval} seconds`);
    }
}

testCheckpointInterval();
```

**Impact on Performance:**
```javascript
function measureCheckpointImpact() {
    let before = Date.now();
    let beforeOps = db.serverStatus().opcounters;
    
    // Force checkpoint
    db.adminCommand({fsync: 1});
    
    let after = Date.now();
    let afterOps = db.serverStatus().opcounters;
    
    print(`Checkpoint duration: ${after - before}ms`);
    print(`Operations during checkpoint: ${afterOps.insert - beforeOps.insert} inserts`);
}

measureCheckpointImpact();
```

**Expected Impact:**
- **Shorter intervals (30-60s):** Faster recovery, more I/O overhead, more predictable performance
- **Longer intervals (300-600s):** Less I/O overhead, longer recovery, larger dirty page accumulation
- **Write-heavy:** Use shorter intervals (60-120s)
- **Read-heavy:** Use longer intervals (180-300s)

---

### 3.2 checkpoint.log_size
**Parameter:** `checkpoint=(log_size=X)`

**Effect:** Triggers checkpoint after X bytes written to journal.

**Default:** 0 (disabled)

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "checkpoint=(wait=120,log_size=2GB)"
```

**Testing:**
```javascript
function monitorLogSizeCheckpoints() {
    let initialLogSize = db.serverStatus().wiredTiger.log["log bytes written"];
    
    // Heavy write workload
    for (let i = 0; i < 1000000; i++) {
        db.logTest.insert({
            _id: i,
            data: "x".repeat(2048),
            timestamp: new Date()
        });
        
        if (i % 50000 === 0) {
            let currentLogSize = db.serverStatus().wiredTiger.log["log bytes written"];
            let written = (currentLogSize - initialLogSize) / 1024 / 1024 / 1024;
            print(`Log written: ${written.toFixed(2)} GB`);
        }
    }
}

monitorLogSizeCheckpoints();
```

**Expected Impact:**
- Prevents journal from growing too large between checkpoints
- Critical for write-heavy workloads
- Set to 1-2x log file size

---

## 4. I/O Configuration

### 4.1 file_manager
**Parameter:** `file_manager=(close_handle_minimum=X,close_idle_time=Y,close_scan_interval=Z)`

**Effect:** Controls file handle management.

**Default:** 
- close_handle_minimum: 250
- close_idle_time: 30 seconds
- close_scan_interval: 10 seconds

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "file_manager=(close_handle_minimum=500,close_idle_time=60,close_scan_interval=20)"
```

**Testing:**
```javascript
function testFileHandles() {
    // Create many collections
    for (let i = 0; i < 100; i++) {
        db[`collection_${i}`].insert({test: 1});
    }
    
    let conn = db.serverStatus().wiredTiger.connection;
    print(`Open file handles: ${conn["files currently open"]}`);
    
    // Wait for idle scan
    sleep(70000);
    
    conn = db.serverStatus().wiredTiger.connection;
    print(`File handles after idle scan: ${conn["files currently open"]}`);
}

testFileHandles();
```

**Expected Impact:**
- **More handles:** Faster access, higher OS resource usage
- **Fewer handles:** Lower resource usage, potential slowdown on reopen
- **Optimal:** Set based on ulimit and number of collections

---

### 4.2 io_capacity
**Parameter:** `io_capacity=(total=X)`

**Effect:** Throttles I/O to prevent disk saturation.

**Default:** 0 (unlimited)

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "io_capacity=(total=100MB)"
```

**Testing:**
```bash
# Monitor disk I/O during throttling
iostat -x 1 30

# In MongoDB shell:
db.ioTest.insert({data: "x".repeat(10000000)})

# Compare I/O rates with and without throttling
```

**Expected Impact:**
- Prevents disk saturation during heavy writes
- May slow down bulk operations
- Useful for multi-tenant environments

---

## 5. Logging Configuration

### 5.1 log.enabled
**Parameter:** `log=(enabled=true)`

**Effect:** Enables WiredTiger's write-ahead logging for durability.

**Default:** false (but MongoDB enables it by default)

**Configuration:**
```yaml
storage:
  journal:
    enabled: true  # MongoDB level
  wiredTiger:
    engineConfig:
      configString: "log=(enabled=true,file_max=100MB)"
```

**Testing:**
```javascript
function testJournalingOverhead() {
    // Test with journaling
    let start = Date.now();
    for (let i = 0; i < 100000; i++) {
        db.journalTest.insert({_id: i, data: "x".repeat(1000)});
    }
    let withJournal = Date.now() - start;
    
    print(`With journaling: ${withJournal}ms`);
    print(`Throughput: ${(100000 / (withJournal / 1000)).toFixed(2)} ops/sec`);
    
    // Check journal stats
    let log = db.serverStatus().wiredTiger.log;
    print(`Log bytes written: ${(log["log bytes written"] / 1024 / 1024).toFixed(2)} MB`);
    print(`Log sync operations: ${log["log sync operations"]}`);
}

testJournalingOverhead();
```

---

### 5.2 log.file_max
**Parameter:** `log=(file_max=X)`

**Effect:** Maximum size of journal files.

**Default:** 100MB

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "log=(file_max=200MB)"
```

**Testing:**
```javascript
function monitorJournalFiles() {
    // In shell, list journal files
    // ls -lh /data/db/journal/
    
    let log = db.serverStatus().wiredTiger.log;
    print(`Log bytes written: ${(log["log bytes written"] / 1024 / 1024).toFixed(2)} MB`);
    print(`Number of log files: ${log["number of log files"]}`);
}

monitorJournalFiles();
```

**Expected Impact:**
- **Larger files:** Fewer file rotations, more disk space
- **Smaller files:** More frequent rotations, easier to manage
- **Optimal:** 100-200MB for most workloads

---

## 6. Advanced Performance Tuning

### 6.1 statistics
**Parameter:** `statistics=[fast|all|none]`

**Effect:** Controls statistics collection granularity.

**Default:** none

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "statistics=[fast]"
```

Or in mongod.conf:
```yaml
setParameter:
  diagnosticDataCollectionEnabled: true
```

**Testing Impact:**
```javascript
function measureStatisticsOverhead() {
    // Test without statistics
    let start = Date.now();
    for (let i = 0; i < 50000; i++) {
        db.statsTest.insert({_id: i, data: "test"});
    }
    let withoutStats = Date.now() - start;
    
    // Restart with statistics=fast and retest
    // Compare performance difference
    
    print(`Without stats: ${withoutStats}ms`);
}

measureStatisticsOverhead();
```

**Expected Impact:**
- `none`: No overhead, no visibility
- `fast`: ~1-2% overhead, good operational visibility
- `all`: ~5-10% overhead, detailed debugging info

---

### 6.2 hash.buckets
**Parameter:** `hash=(buckets=X)`

**Effect:** Number of hash buckets for internal hash tables.

**Default:** 512

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "hash=(buckets=2048,dhandle_buckets=2048)"
```

**When to Increase:**
- More than 1000 collections
- High concurrency workloads
- Frequent metadata operations

**Expected Impact:**
- More buckets → Less hash collision, more memory usage
- Must be power of 2

---

### 6.3 cache_max_wait_ms
**Parameter:** `cache_max_wait_ms=X`

**Effect:** Maximum milliseconds to wait for cache space before giving up.

**Default:** 0 (wait forever)

**Configuration:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      configString: "cache_max_wait_ms=60000"
```

**Testing:**
```javascript
function testCacheWait() {
    // Fill cache completely
    try {
        for (let i = 0; i < 10000000; i++) {
            db.waitTest.insert({_id: i, data: "x".repeat(10000)});
        }
    } catch(e) {
        print("Cache wait timeout: " + e);
    }
}

testCacheWait();
```

**Expected Impact:**
- Set to 0: Operations wait forever (risk of hanging)
- Set to >0: Operations fail after timeout (better than hanging)
- Recommended: 30000-60000ms

---

## 7. Testing Methodology

### 7.1 Baseline Performance Test
```javascript
function baselineTest() {
    // Record current configuration
    let config = db.serverStatus().wiredTiger;
    printjson(config);
    
    // Test 1: Insert performance
    let insertStart = Date.now();
    for (let i = 0; i < 100000; i++) {
        db.baseline.insert({
            _id: i,
            data: "x".repeat(1000),
            timestamp: new Date(),
            random: Math.random()
        });
    }
    let insertTime = Date.now() - insertStart;
    
    // Test 2: Query performance
    let queryStart = Date.now();
    db.baseline.find({random: {$gt: 0.5}}).limit(10000).toArray();
    let queryTime = Date.now() - queryStart;
    
    // Test 3: Update performance
    let updateStart = Date.now();
    db.baseline.updateMany({random: {$lt: 0.5}}, {$set: {modified: new Date()}});
    let updateTime = Date.now() - updateStart;
    
    // Results
    print("\n=== BASELINE RESULTS ===");
    print(`Insert: ${insertTime}ms (${(100000/insertTime*1000).toFixed(2)} ops/sec)`);
    print(`Query: ${queryTime}ms`);
    print(`Update: ${updateTime}ms`);
    
    // Cache stats
    let cache = db.serverStatus().wiredTiger.cache;
    print(`\nCache utilization: ${(cache["bytes currently in the cache"] / cache["maximum bytes configured"] * 100).toFixed(2)}%`);
    print(`Dirty pages: ${(cache["tracked dirty bytes in the cache"] / cache["bytes currently in the cache"] * 100).toFixed(2)}%`);
    
    return {
        insertTime: insertTime,
        queryTime: queryTime,
        updateTime: updateTime,
        cacheUtilization: (cache["bytes currently in the cache"] / cache["maximum bytes configured"] * 100)
    };
}

// Run baseline
let baseline = baselineTest();
```

### 7.2 Load Testing Framework
```javascript
function loadTest(params) {
    let results = {
        startTime: new Date(),
        params: params,
        metrics: []
    };
    
    // Continuous load for specified duration
    let endTime = Date.now() + (params.durationMinutes * 60 * 1000);
    let iteration = 0;
    
    while (Date.now() < endTime) {
        let iterStart = Date.now();
        
        // Mixed workload
        for (let i = 0; i < params.opsPerIteration; i++) {
            let rand = Math.random();
            
            if (rand < 0.7) {
                // 70% reads
                db[params.collection].findOne({_id: Math.floor(Math.random() * params.docCount)});
            } else if (rand < 0.9) {
                // 20% updates
                db[params.collection].update(
                    {_id: Math.floor(Math.random() * params.docCount)},
                    {$set: {modified: new Date(), counter: iteration}}
                );
            } else {
                // 10% inserts
                db[params.collection].insert({
                    _id: params.docCount + iteration++,
                    data: "x".repeat(params.docSize),
                    created: new Date()
                });
            }
        }
        
        let iterTime = Date.now() - iterStart;
        
        // Collect metrics
        let cache = db.serverStatus().wiredTiger.cache;
        let metric = {
            iteration: iteration,
            duration: iterTime,
            cacheUsage: (cache["bytes currently in the cache"] / cache["maximum bytes configured"] * 100).toFixed(2),
            dirtyPages: (cache["tracked dirty bytes in the cache"] / cache["bytes currently in the cache"] * 100).toFixed(2),
            evictionWorkers: cache["eviction worker thread active"],
            appEvictions: cache["pages evicted by app threads"]
        };
        
        results.metrics.push(metric);
        
        if (iteration % 10 === 0) {
            print(`Iteration ${iteration}: ${iterTime}ms, Cache: ${metric.cacheUsage}%`);
        }
        
        iteration++;
    }
    
    results.endTime = new Date();
    return results;
}

// Example usage
let loadTestResults = loadTest({
    collection: "loadTest",
    durationMinutes: 5,
    opsPerIteration: 1000,
    docCount: 100000,
    docSize: 1000
});
```

### 7.3 Comparative Testing
```javascript
function compareConfigurations(configs) {
    let results = {};
    
    for (let configName in configs) {
        print(`\n========================================`);
        print(`Testing configuration: ${configName}`);
        print(`========================================`);
        
        // Note: You'll need to restart MongoDB with new config
        print(`Please restart MongoDB with: ${configs[configName]}`);
        print("Press Enter when ready...");
        
        // Run standardized test
        results[configName] = baselineTest();
        
        // Additional metrics
        results[configName].serverStatus = db.serverStatus().wiredTiger;
    }
    
    // Compare results
    print("\n========================================");
    print("COMPARISON RESULTS");
    print("========================================");
    
    for (let config in results) {
        print(`\n${config}:`);
        printjson(results[config]);
    }
    
    return results;
}

// Example configurations to compare
let testConfigs = {
    "default": "No custom WT config",
    "aggressive_eviction": "eviction_target=65,eviction_trigger=85,eviction_dirty_target=8,eviction_dirty_trigger=15",
    "conservative_eviction": "eviction_target=80,eviction_trigger=95,eviction_dirty_target=5,eviction_dirty_trigger=20",
    "high_concurrency": "eviction=(threads_min=4,threads_max=16),hash=(buckets=2048)"
};
```

---

## 8. Monitoring & Metrics

### 8.1 Key Metrics to Monitor

```javascript
function comprehensiveMonitoring() {
    let wt = db.serverStatus().wiredTiger;
    
    print("\n=== CACHE METRICS ===");
    print(`Maximum configured: ${(wt.cache["maximum bytes configured"] / 1024 / 1024 / 1024).toFixed(2)} GB`);
    print(`Currently in cache: ${(wt.cache["bytes currently in the cache"] / 1024 / 1024 / 1024).toFixed(2)} GB`);
    print(`Utilization: ${(wt.cache["bytes currently in the cache"] / wt.cache["maximum bytes configured"] * 100).toFixed(2)}%`);
    print(`Dirty bytes: ${(wt.cache["tracked dirty bytes in the cache"] / 1024 / 1024).toFixed(2)} MB`);
    print(`Dirty %: ${(wt.cache["tracked dirty bytes in the cache"] / wt.cache["bytes currently in the cache"] * 100).toFixed(2)}%`);
    
    print("\n=== EVICTION METRICS ===");
    print(`Eviction workers active: ${wt.cache["eviction worker thread active"]}`);
    print(`Eviction workers stable: ${wt.cache["eviction worker thread stable number"]}`);
    print(`Pages evicted (total): ${wt.cache["pages evicted by app threads"] + wt.cache["modified pages evicted"]}`);
    print(`Pages evicted by app threads: ${wt.cache["pages evicted by app threads"]}`);
    print(`Modified pages evicted: ${wt.cache["modified pages evicted"]}`);
    print(`Hazard pointer blocks: ${wt.cache["hazard pointer blocked page eviction"]}`);
    
    print("\n=== CHECKPOINT METRICS ===");
    if (wt.transaction && wt.transaction.checkpoint) {
        let ckpt = wt.transaction.checkpoint;
        print(`Checkpoints: ${ckpt["checkpoints"] || "N/A"}`);
        print(`Checkpoint time (ms): ${ckpt["checkpoint min time (msecs)"] || "N/A"} - ${ckpt["checkpoint max time (msecs)"] || "N/A"}`);
    }
    
    print("\n=== I/O METRICS ===");
    if (wt.block_manager) {
        let bm = wt["block-manager"];
        print(`Blocks read: ${bm["blocks read"]}`);
        print(`Blocks written: ${bm["blocks written"]}`);
        print(`Bytes read: ${(bm["bytes read"] / 1024 / 1024 / 1024).toFixed(2)} GB`);
        print(`Bytes written: ${(bm["bytes written"] / 1024 / 1024 / 1024).toFixed(2)} GB`);
    }
    
    print("\n=== LOG/JOURNAL METRICS ===");
    if (wt.log) {
        print(`Log bytes written: ${(wt.log["log bytes written"] / 1024 / 1024 / 1024).toFixed(2)} GB`);
        print(`Log sync operations: ${wt.log["log sync operations"]}`);
        print(`Log files: ${wt.log["number of log files"]}`);
    }
}

// Run every minute
function continuousMonitoring(durationMinutes) {
    for (let i = 0; i < durationMinutes; i++) {
        print(`\n\n========== MINUTE ${i + 1} ==========`);
        comprehensiveMonitoring();
        sleep(60000);
    }
}

// Example: Monitor for 10 minutes
continuousMonitoring(10);
```

### 8.2 Alert Thresholds

```javascript
function checkThresholds() {
    let wt = db.serverStatus().wiredTiger;
    let cache = wt.cache;
    let alerts = [];
    
    // Cache utilization
    let cacheUtilization = cache["bytes currently in the cache"] / cache["maximum bytes configured"] * 100;
    if (cacheUtilization > 90) {
        alerts.push(`HIGH: Cache utilization at ${cacheUtilization.toFixed(2)}%`);
    }
    
    // Dirty pages
    let dirtyPct = cache["tracked dirty bytes in the cache"] / cache["bytes currently in the cache"] * 100;
    if (dirtyPct > 20) {
        alerts.push(`HIGH: Dirty pages at ${dirtyPct.toFixed(2)}%`);
    }
    
    // App thread eviction
    if (cache["pages evicted by app threads"] > 0) {
        alerts.push(`WARNING: Application threads evicting pages (${cache["pages evicted by app threads"]})`);
    }
    
    // Eviction failures
    if (cache["eviction worker thread evictable pages queued"] === 0) {
        alerts.push("WARNING: Eviction queue empty");
    }
    
    if (alerts.length > 0) {
        print("\n!!! ALERTS !!!");
        alerts.forEach(alert => print(alert));
    } else {
        print("All metrics within normal range");
    }
    
    return alerts;
}

// Run continuously
setInterval(checkThresholds, 30000); // Every 30 seconds
```

---

## 9. Recommended Configurations by Workload Type

### 9.1 Write-Heavy Workload
```yaml
# mongod.conf
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 8
      configString: >
        eviction_target=70,
        eviction_trigger=90,
        eviction_dirty_target=10,
        eviction_dirty_trigger=20,
        eviction_updates_target=5,
        eviction_updates_trigger=10,
        eviction=(threads_min=2,threads_max=16),
        checkpoint=(wait=120,log_size=2GB),
        cache_overhead=12
```

**Test:**
```javascript
// Measure write throughput
function testWriteHeavy() {
    let start = Date.now();
    let count = 0;
    
    while (Date.now() - start < 60000) { // 1 minute
        db.writeHeavy.insert({
            _id: count++,
            data: "x".repeat(2000),
            timestamp: new Date()
        });
    }
    
    print(`Write throughput: ${count} docs/min (${(count/60).toFixed(2)} docs/sec)`);
}
```

### 9.2 Read-Heavy Workload
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 16  # Larger cache for reads
      configString: >
        eviction_target=85,
        eviction_trigger=95,
        eviction_dirty_target=5,
        eviction_dirty_trigger=15,
        eviction=(threads_min=1,threads_max=8),
        checkpoint=(wait=300),
        cache_overhead=8
```

**Test:**
```javascript
// Measure read throughput
function testReadHeavy() {
    // Pre-populate data
    for (let i = 0; i < 1000000; i++) {
        db.readHeavy.insert({_id: i, data: "x".repeat(1000)});
    }
    db.readHeavy.createIndex({data: 1});
    
    let start = Date.now();
    let count = 0;
    
    while (Date.now() - start < 60000) {
        db.readHeavy.findOne({_id: Math.floor(Math.random() * 1000000)});
        count++;
    }
    
    print(`Read throughput: ${count} ops/min (${(count/60).toFixed(2)} ops/sec)`);
}
```

### 9.3 Mixed Workload (OLTP)
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 12
      configString: >
        eviction_target=75,
        eviction_trigger=90,
        eviction_dirty_target=8,
        eviction_dirty_trigger=18,
        eviction_updates_target=4,
        eviction_updates_trigger=8,
        eviction=(threads_min=2,threads_max=12),
        checkpoint=(wait=180),
        cache_overhead=10,
        hash=(buckets=1024)
```

### 9.4 Analytics/Reporting Workload
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 24  # Maximum cache
      configString: >
        eviction_target=90,
        eviction_trigger=98,
        checkpoint=(wait=600),
        file_manager=(close_handle_minimum=1000,close_idle_time=120),
        cache_overhead=8
```

---

## 10. Production Deployment Checklist

### Pre-Deployment Testing
```javascript
function preDeploymentChecklist() {
    print("=== PRE-DEPLOYMENT CHECKLIST ===\n");
    
    // 1. Verify configuration
    print("1. Configuration verification:");
    let config = db.serverStatus().wiredTiger;
    printjson(config.cache["maximum bytes configured"]);
    
    // 2. Run baseline test
    print("\n2. Baseline performance test:");
    let baseline = baselineTest();
    
    // 3. Load test
    print("\n3. Load test (5 minutes):");
    let loadResults = loadTest({
        collection: "preDeployTest",
        durationMinutes: 5,
        opsPerIteration: 500,
        docCount: 100000,
        docSize: 1000
    });
    
    // 4. Check for alerts
    print("\n4. Threshold checks:");
    checkThresholds();
    
    // 5. Document results
    print("\n5. Results summary:");
    return {
        baseline: baseline,
        loadTest: loadResults,
        config: config
    };
}

// Run checklist
let deploymentResults = preDeploymentChecklist();
```

### Post-Deployment Monitoring
```bash
# Create monitoring script
cat > monitor_wiredtiger.sh << 'EOF'
#!/bin/bash

while true; do
    echo "=== $(date) ==="
    mongo --quiet --eval "
        let wt = db.serverStatus().wiredTiger;
        let cache = wt.cache;
        print('Cache: ' + (cache['bytes currently in the cache'] / cache['maximum bytes configured'] * 100).toFixed(2) + '%');
        print('Dirty: ' + (cache['tracked dirty bytes in the cache'] / cache['bytes currently in the cache'] * 100).toFixed(2) + '%');
        print('App evictions: ' + cache['pages evicted by app threads']);
    "
    sleep 60
done
EOF

chmod +x monitor_wiredtiger.sh
./monitor_wiredtiger.sh > wt_monitor.log &
```

---

## 11. Troubleshooting Guide

### Problem: High Cache Usage (>95%)
**Symptoms:**
- Application threads participating in eviction
- Slow query performance
- High latency spikes

**Diagnosis:**
```javascript
let cache = db.serverStatus().wiredTiger.cache;
print("Cache usage: " + (cache["bytes currently in the cache"] / cache["maximum bytes configured"] * 100));
print("App thread evictions: " + cache["pages evicted by app threads"]);
```

**Solutions:**
1. Increase cache size: `cacheSizeGB: X`
2. Lower eviction triggers: `eviction_trigger=90`
3. Add more eviction threads: `eviction=(threads_max=16)`

### Problem: High Dirty Page Ratio (>20%)
**Symptoms:**
- Long checkpoint times
- Write stalls
- Inconsistent performance

**Diagnosis:**
```javascript
let cache = db.serverStatus().wiredTiger.cache;
let dirtyPct = cache["tracked dirty bytes in the cache"] / cache["bytes currently in the cache"] * 100;
print("Dirty pages: " + dirtyPct + "%");
```

**Solutions:**
1. Lower dirty triggers: `eviction_dirty_target=8,eviction_dirty_trigger=15`
2. Shorter checkpoint intervals: `checkpoint=(wait=120)`
3. Increase eviction threads

### Problem: Slow Checkpoints
**Diagnosis:**
```javascript
db.serverStatus().wiredTiger.transaction.checkpoint
```

**Solutions:**
1. Reduce checkpoint interval
2. Lower dirty page targets
3. Increase I/O capacity

---

## 12. Performance Tuning Worksheet

Use this worksheet to document your tuning process:

```
SERVER SPECS:
- CPU Cores: ___
- RAM: ___GB
- Disk Type: ___ (SSD/HDD)
- MongoDB Version: ___

WORKLOAD CHARACTERISTICS:
- Primary operation: ___ (Read/Write/Mixed)
- Documents per second: ___
- Average document size: ___KB
- Number of collections: ___
- Index size: ___GB
- Working set size: ___GB

BASELINE METRICS (before tuning):
- Insert throughput: ___ ops/sec
- Query latency (p95): ___ms
- Cache utilization: ___%
- Dirty page ratio: ___%
- App thread evictions: ___

TARGET METRICS:
- Desired insert throughput: ___ ops/sec
- Target query latency (p95): ___ms
- Target cache utilization: ___%

CONFIGURATION CHANGES:
1. ___
2. ___
3. ___

AFTER TUNING METRICS:
- Insert throughput: ___ ops/sec (Δ: ___)
- Query latency (p95): ___ms (Δ: ___)
- Cache utilization: ___% (Δ: ___)
- Dirty page ratio: ___% (Δ: ___)

NOTES:
___
```

---

## Summary: Quick Reference

### Most Impactful Settings (Priority Order)

1. **cache_size** - Start here, affects everything
2. **eviction_target / eviction_trigger** - Prevents cache thrashing
3. **eviction_dirty_target / eviction_dirty_trigger** - Critical for write workloads
4. **checkpoint.wait** - Balances durability vs performance
5. **eviction.threads_max** - Scale eviction capacity
6. **eviction_updates_target / eviction_updates_trigger** - For update-heavy workloads
7. **cache_overhead** - Fine-tune memory accounting
8. **file_manager** - For many collections
9. **statistics** - Enable monitoring with minimal overhead

### Safe Starting Point (Production)
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: <60-70% of RAM>
      configString: >
        eviction_target=75,
        eviction_trigger=90,
        eviction_dirty_target=8,
        eviction_dirty_trigger=18,
        eviction=(threads_min=2,threads_max=8),
        checkpoint=(wait=120),
        cache_overhead=10,
        statistics=[fast]
```

### Testing Commands Quick Reference
```javascript
// Cache stats
db.serverStatus().wiredTiger.cache

// Eviction stats
db.serverStatus().wiredTiger.cache["pages evicted by app threads"]

// Checkpoint stats
db.serverStatus().wiredTiger.transaction.checkpoint

// Force checkpoint
db.adminCommand({fsync: 1})

// Complete server status
db.serverStatus().wiredTiger
```

---

**Document Version:** 1.0  
**Last Updated:** February 2026  
**Author:** Comprehensive WiredTiger Tuning Guide
**ErrorCodes:** : https://www.mongodb.com/docs/manual/reference/error-codes/#std-label-server-error-codes

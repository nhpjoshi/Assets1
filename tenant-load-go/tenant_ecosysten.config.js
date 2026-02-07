module.exports = {
  apps: [
    {
      name: "tenant-load",
      script: "./tenant_load",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 5,
      time: true,
      env: {
        TENANTS: "T1001,T1002,T1003,T1004,T1005,T1006,T1007,T1008,T1009,T1010",
        INGEST_INTERVAL: "2s",
        USERS: "10",
        MONGO_URI:""
//           ""
      }
    },
    {
      name: "tenant-read",
      script: "./tenant_read",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      time: true,
      env: {
        TENANTS: "T1001,T1002,T1003,T1004,T1005,T1006,T1007,T1008,T1009,T1010",
        USERS_MAP: "T1001=50,T1002=50,T1003=50,T1004=50,T1005=50,T1006=50,T1007=50,T1008=50,T1009=50,T1010=50",
        RATE: "high",
        MONGO_URI:
          ""
      }
    }
  ]
};


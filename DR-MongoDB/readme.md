# 🛡️ MongoDB Disaster Recovery (DR) Simulator

This project simulates a MongoDB deployment across multiple regions to test disaster recovery (DR) scenarios. It demonstrates how MongoDB replica sets can maintain availability and data integrity even when one or more regions go down.

We use **Docker** to simulate the following multi-region topology with a total of **5 MongoDB nodes**:

- **Region 1**: 2 nodes
- **Region 2**: 2 nodes
- **Region 3**: 1 node

All MongoDB containers run version **6.0** and communicate over a shared Docker network named `shared`.

---

## 🧱 Step 1: Create Regional MongoDB Nodes

Each region has its own Docker Compose file stored in a dedicated folder:

- `region1/docker-compose.yml`
- `region2/docker-compose.yml`
- `region3/docker-compose.yml`

### 🔗 Create Shared Docker Network

To enable inter-container communication across regions, create a shared network first:

```bash
docker network create shared
```

### 🚀 Start Each Region

Navigate to each region’s folder and bring up the containers one by one using:

```bash
docker-compose up -d
```

Repeat this command for `region1`, `region2`, and `region3`.

> After startup, you will see separate folders in Docker Desktop representing each group of MongoDB containers (Region 1, 2, and 3). These services run independently but are linked via the `shared` Docker network.

---

## 🧩 Step 2: Run the Application

A sample application is provided in the `app` directory. This app performs write operations to the MongoDB replica set and is used to simulate real-world usage during DR testing.

Build the application Docker image if needed, or run it directly (assuming `mongo-write-app` is already built):

```bash
docker run --rm \
  --network shared \
  -e MONGO_URI="mongodb://mongo1:27017,mongo2:27018,mongo3:27019,mongo4:27020,mongo5:27021/?replicaSet=rs0&retryWrites=true&w=majority" \
  mongo-write-app
```

This command:

- Runs the app in a container.
- Connects it to the shared Docker network.
- Passes the MongoDB connection URI using environment variables.

---

## 🔄 Step 3: Simulate Disaster Recovery (DR)

You can now test failover and high availability of the replica set.

### 🔥 Example Test: Bring Down Region 1

```bash
cd region1
docker-compose down
```

This simulates a failure in Region 1. MongoDB will automatically elect a new primary from the remaining nodes in Region 2 and Region 3, maintaining availability without disrupting write operations from the app.

> The write app will continue functioning because of the replica set's built-in failover capability.

---

### 🧪 Try Other Test Scenarios

- Bring down Region 2 and check if Region 1 and Region 3 maintain quorum.
- Temporarily disconnect Region 3 and observe the impact.
- Restart containers and validate replica rejoining.

This simulator is perfect for educational demos, DR drills, and understanding replica set behavior under stress.

---

## 🛠️ Troubleshooting

- Make sure Docker is installed and the Docker daemon is running.
- Always start the shared Docker network before launching the regions.
- Use `docker ps` to check running containers and `docker logs <container_name>` to debug issues.

---

## 📘 License

MIT License – Feel free to fork, improve, and use for demos or internal testing.

---

## 🙌 Contributions

Feel free to open issues or pull requests to enhance the simulator or add more test cases!

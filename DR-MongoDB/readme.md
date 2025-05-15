# Create the README.md file content as specified and save it to a file

readme_content = """

# MongoDB Disaster Recovery (DR) Simulator

This project simulates a MongoDB deployment across multiple regions to test disaster recovery scenarios. It uses Docker to simulate three regions with a total of **5 MongoDB nodes** distributed as follows:

- **Region 1**: 2 nodes
- **Region 2**: 2 nodes
- **Region 3**: 1 node

All containers run MongoDB 6 and are connected using a shared Docker network named `shared`.

---

## 🧱 Step 1: Create Regions

Each region has its own Docker Compose file. Ensure the `shared` network is created first, so all services can communicate.

### 🔧 Create Shared Network

Before starting the services, create a shared Docker network:

```bash
docker network create shared
```

const clusterList = document.getElementById("cluster-list");

// Function to fetch cluster data from the API
async function fetchClusters() {
  // Display a loading spinner
  clusterList.innerHTML = "<div class='loading'>Loading clusters...</div>";

  try {
    const response = await fetch("http://localhost:5001/clusters");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const jsonData = await response.json();
    displayClusters(jsonData.results);
  } catch (error) {
    console.error("Failed to fetch clusters:", error);
    clusterList.innerHTML =
      "<p style='color: red;'>Failed to fetch cluster data. Please try again later.</p>";
  }
}

// Function to display clusters in the UI
function displayClusters(clusters) {
  clusterList.innerHTML = ""; // Clear existing content

  clusters.forEach((cluster) => {
    const listItem = document.createElement("li");

    // Determine if cluster is running or idle
    const clusterState = cluster.paused ? "Idle" : "Running";
    const statusColor = cluster.paused ? "red" : "green"; // Red for idle, green for running

    // Create "Start" and "Stop" buttons
    const startButton = document.createElement("button");
    startButton.textContent = "Start";
    startButton.style.backgroundColor = "#007bff"; // Blue for start
    startButton.style.color = "white";
    startButton.style.border = "none";
    startButton.style.padding = "10px";
    startButton.style.cursor = "pointer";
    startButton.style.marginRight = "10px";

    const stopButton = document.createElement("button");
    stopButton.textContent = "Stop";
    stopButton.style.backgroundColor = "#f0ad4e"; // Orange for stop
    stopButton.style.color = "white";
    stopButton.style.border = "none";
    stopButton.style.padding = "10px";
    stopButton.style.cursor = "pointer";

    // Handle button clicks
    startButton.addEventListener("click", () =>
      handleClusterAction(cluster.name, false)
    );
    stopButton.addEventListener("click", () =>
      handleClusterAction(cluster.name, true)
    );

    listItem.innerHTML = `
        <h2>${cluster.name}</h2>
        <p>Instance Size: ${cluster.providerSettings.instanceSizeName}</p>
        <p>Disk Size: ${cluster.diskSizeGB} GB</p>
        <p>State: ${clusterState} <span style="color: ${statusColor}; font-weight: bold; font-size: 20px;">●</span></p>
        <p>Connection String: <a href="${cluster.connectionStrings.standardSrv}" target="_blank">${cluster.connectionStrings.standardSrv}</a></p>
    `;

    // Append buttons and cluster details
    listItem.appendChild(startButton);
    listItem.appendChild(stopButton);
    clusterList.appendChild(listItem);
  });
}

// Function to handle cluster action (start or stop)
async function handleClusterAction(clusterName, paused) {
  try {
    const response = await fetch("http://localhost:5001/state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clusterName, paused }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log(data);
    alert(`Cluster ${data.name} is now ${paused ? "paused" : "running"}!`);

    // Refetch clusters after action to update UI
    fetchClusters();
  } catch (error) {
    console.error(`Error updating cluster state:`, error);
    alert(`Failed to update cluster state.`);
  }
}

// Fetch clusters when the popup is opened
document.addEventListener("DOMContentLoaded", fetchClusters);

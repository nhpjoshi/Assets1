document.addEventListener("DOMContentLoaded", function () {
  // Find the submit button by its id
  var submitButton = document.getElementById("submitData");

  // Add a click event listener to the submit button
  submitButton.addEventListener("click", function () {
    // Call the postData function when the button is clicked
    postData();
  });
});

document.addEventListener("DOMContentLoaded", function () {
  // Find the submit button by its id
  var submitButton = document.getElementById("searchButton");

  // Add a click event listener to the submit button
  submitButton.addEventListener("click", function () {
    // Call the postData function when the button is clicked
    getData();
  });
});

function postData() {
  var formData = {
    Link: document.getElementById("Link").value,
    description: document.getElementById("description").value,
  };
  console.log("Request body:", JSON.stringify(formData));
  fetch("http://localhost:3000/processData", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(formData),
  })
    .then((response) => {
      console.log("Success:", response);
      Link.value = "";
      reference.value = "";
      description.value = "";
      // Handle success response
    })
    .catch((error) => {
      console.error("Error:", error);
      // Handle error response
    });
}

async function getData() {
  var formData = {
    query: document.getElementById("searchTerm").value,
  };
  console.log("Request body:", JSON.stringify(formData));

  try {
    const response = await fetch("http://localhost:3000/getData", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      throw new Error("Network response was not ok " + response.statusText);
    }

    const data = await response.json();
    console.log("Success:", data);
    displayResults(data);
  } catch (error) {
    console.error("Error:", error);
  }
}

function displayData(data) {
  const resultsTextArea = document.getElementById("resultsTextArea");
  resultsTextArea.value = ""; // Clear previous results

  if (!Array.isArray(data) || data.length === 0) {
    resultsTextArea.value = "No data found.";
    return;
  }

  const resultsText = data
    .map((item, index) => {
      if (item) {
        return `${index + 1}.${item}`;
      } else {
        console.error("Invalid item or missing Link property:", item);
        return `${index + 1}. Invalid item`;
      }
    })
    .join("\n\n"); // Added extra newline characters for gaps

  resultsTextArea.value = resultsText;
}

function displayResults(data) {
  const resultsDiv = document.getElementById("resultsDiv");
  resultsDiv.innerHTML = ""; // Clear previous results

  if (!Array.isArray(data) || data.length === 0) {
    resultsDiv.textContent = "No data found.";
    return;
  }

  data.forEach((item, index) => {
    if (item && item) {
      const linkElement = document.createElement("a");
      linkElement.href = item;
      linkElement.textContent = `${index + 1}. ${item}`;
      linkElement.target = "_blank";
      resultsDiv.appendChild(linkElement);
      resultsDiv.appendChild(document.createElement("br"));
    } else {
      console.error("Invalid item or missing Link property:", item);
      const invalidItem = document.createElement("div");
      invalidItem.textContent = `${index + 1}. Invalid item`;
      resultsDiv.appendChild(invalidItem);
    }
  });

  // Apply CSS to left-align the output
  resultsDiv.style.textAlign = "left";
}

function getText() {
  var inputValue = document.getElementById("Link").value;

  fetch("http://localhost:3000/getText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: inputValue }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json();
    })
    .then((data) => {
      console.log("Success:", data);
      populateLetterByLetter(data.description);
    })
    .catch((error) => {
      console.error("Error:", error);
      document.getElementById("outputField").value =
        "Error occurred while processing request";
    });
}

function populateLetterByLetter(text) {
  var index = 0;
  var interval = setInterval(function () {
    if (index < text.length) {
      document.getElementById("outputField").value += text[index];
      index++;
    } else {
      clearInterval(interval);
    }
  }, 10); // Adjust the delay between letters (in milliseconds) as needed
}

// script.js
document.addEventListener("DOMContentLoaded", function () {
  // Trigger sendRequest() when Enter key is pressed in the input field
  document
    .getElementById("Link")
    .addEventListener("keypress", function (event) {
      if (event.key === "Enter") {
        sendRequest();
      }
    });

  // Trigger sendRequest() when the button is clicked
  document.addEventListener("click", function (event) {
    if (event.target && event.target.dataset.action === "sendRequest") {
      sendRequest();
    }
  });
});

function sendRequest() {
  var inputValue = document.getElementById("Link").value;

  fetch("http://localhost:3000/getText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: inputValue }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json();
    })
    .then((data) => {
      console.log("Success:", data);
      populateLetterByLetter(data.description);
    })
    .catch((error) => {
      console.error("Error:", error);
      document.getElementById("description").value =
        "Error occurred while processing request";
    });
}

function populateLetterByLetter(text) {
  var index = 0;
  var interval = setInterval(function () {
    if (index < text.length) {
      document.getElementById("description").value += text[index];
      index++;
    } else {
      clearInterval(interval);
    }
  }, 20); // Adjust the delay between letters (in milliseconds) as needed
}

document.addEventListener("DOMContentLoaded", async function () {
  // Get the active tab's URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    const linkInput = document.getElementById("Link");
    if (linkInput) {
      linkInput.value = tab.url; // Populate the URL
      sendRequest();
    }

    // Add click listener to copy URL button
    const copyButton = document.getElementById("copyURLButton");
    if (copyButton) {
      copyButton.addEventListener("click", function () {
        navigator.clipboard
          .writeText(tab.url)
          .then(() => {
            alert("URL copied to clipboard!");
          })
          .catch((err) => {
            console.error("Failed to copy URL: ", err);
          });
      });
    }
  } else {
    console.error("No active tab found or URL is unavailable.");
  }
});

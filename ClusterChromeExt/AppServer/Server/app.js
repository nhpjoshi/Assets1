const http = require("http");
const urllib = require("urllib");

const baseUrl =
  "https://cloud.mongodb.com/api/atlas/v2/groups/65afa10de7cfa50a87ebf807/clusters";
const ATLAS_USER = "";
const ATLAS_USER_KEY = "";

const options = {
  digestAuth: `${ATLAS_USER}:${ATLAS_USER_KEY}`,
  headers: {
    Accept: "application/vnd.atlas.2023-01-01+json",
    "Content-Type": "application/json",
  },
};

const setCORSHeaders = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const requestHandler = (req, res) => {
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    setCORSHeaders(res);
    res.writeHead(204); // No Content
    res.end();
    return;
  }

  // /clusters GET request
  if (req.method === "GET" && req.url === "/clusters") {
    setCORSHeaders(res);

    urllib
      .request(baseUrl, options)
      .then(({ data, res: apiRes }) => {
        if (apiRes.statusCode !== 200) {
          res.writeHead(apiRes.statusCode, { "Content-Type": "text/plain" });
          res.end(
            `Unexpected Status: ${apiRes.statusCode}: ${apiRes.statusMessage}`
          );
        } else {
          const jsonRes = JSON.parse(data);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(jsonRes, null, 2));
        }
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Error occurred: ${error.message}`);
      });
  }

  // /state POST request
  else if (req.method === "POST" && req.url === "/state") {
    setCORSHeaders(res);

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const parsedBody = JSON.parse(body);
        const { clusterName, paused } = parsedBody;

        if (typeof paused !== "boolean" || !clusterName) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(
            "Invalid input. Ensure 'clusterName' and 'paused' (boolean) are provided."
          );
          return;
        }

        const payload = JSON.stringify({ paused });
        const clusterUrl = `${baseUrl}/${clusterName}`;

        urllib
          .request(clusterUrl, {
            ...options,
            method: "PATCH",
            data: payload,
          })
          .then(({ data, res: apiRes }) => {
            if (apiRes.statusCode === 409) {
              // Handle 409 Conflict by reading response body
              res.writeHead(409, { "Content-Type": "application/json" });
              res.end(data); // Send the conflict details back to the client
            } else if (apiRes.statusCode !== 200) {
              res.writeHead(apiRes.statusCode, {
                "Content-Type": "text/plain",
              });
              res.end(
                `Unexpected Status: ${apiRes.statusCode}: ${apiRes.statusMessage}`
              );
            } else {
              const jsonRes = JSON.parse(data);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(jsonRes, null, 2));
            }
          })
          .catch((error) => {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end(`Error occurred: ${error.message}`);
          });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Error processing the request: ${error.message}`);
      }
    });
  }

  // 404 for any other routes
  else {
    setCORSHeaders(res);
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
};

const server = http.createServer(requestHandler);

const PORT = 5001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

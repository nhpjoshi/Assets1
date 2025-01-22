# Use Node.js as the base image
FROM node:16

# Set the working directory inside the container
WORKDIR /usr/src/client

# Copy package.json and package-lock.json for dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the WebSocket client code
COPY . .

# Command to start the client
CMD ["node", "wsClient.js"]

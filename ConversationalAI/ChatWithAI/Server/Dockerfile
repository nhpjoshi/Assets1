# Use Node.js as the base image
FROM node:16

# Set the working directory inside the container
WORKDIR /usr/src/server

# Copy package.json and package-lock.json for dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the WebSocket server code
COPY . .

# Expose the WebSocket server port
EXPOSE 4000

# Command to start the server
CMD ["node", "WSServer.js"]

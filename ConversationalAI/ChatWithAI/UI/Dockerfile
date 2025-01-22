# Use Node.js as the base image
FROM node:16

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the React app for production
RUN npm run build

# Use a lightweight web server to serve the React app
RUN npm install -g serve
CMD ["serve", "-s", "build", "-l", "3001"]

# Expose the frontend port
EXPOSE 3001

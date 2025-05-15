# Use official Node.js image
FROM node:16

# Set working directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Expose port
EXPOSE 3000

# Run the application
CMD ["node", "app.js"]

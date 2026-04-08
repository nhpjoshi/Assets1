const redis = require('redis');

async function pingTest() {
  // Create client
  const client = redis.createClient({
    socket: {
      host: '127.0.0.1', // change if needed
      port: 6379
    }
  });

  // Event listeners (good for debugging)
  client.on('connect', () => {
    console.log('✅ Connected to Redis');
  });

  client.on('error', (err) => {
    console.error('❌ Redis Error:', err);
  });

  try {
    // Connect to Redis
    await client.connect();

    // Send PING
    const response = await client.ping();

    console.log(' Redis PING Response:', response);

    // Disconnect
    await client.quit();

  } catch (err) {
    console.error(' Failed to ping Redis:', err);
  }
}

pingTest();
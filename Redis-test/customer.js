const redis = require('redis');
const readline = require('readline-sync');

// Create Redis client
const client = redis.createClient({
  socket: {
    host: '127.0.0.1',
    port: 6379
  }
});

client.on('error', (err) => console.error('❌ Redis Error:', err));

// Connect
async function connectRedis() {
  await client.connect();
  console.log('✅ Connected to Redis\n');
}

// Dynamic field input
function getDynamicFields() {
  const data = {};

  while (true) {
    const field = readline.question('Enter field name (or press enter to stop): ');
    if (!field) break;

    const value = readline.question(`Enter value for ${field}: `);
    data[field] = value;
  }

  return data;
}

// Create / Update Customer
async function upsertCustomer() {
  const customerId = readline.question('Enter Customer ID: ');
  const key = `customer:${customerId}`;

  console.log('\nEnter customer fields:');
  const data = getDynamicFields();

  if (Object.keys(data).length === 0) {
    console.log('⚠️ No data entered.');
    return;
  }

  await client.hSet(key, data);
  console.log(`✅ Customer ${customerId} saved/updated\n`);
}

// Get Customer
async function getCustomer() {
  const customerId = readline.question('Enter Customer ID: ');
  const key = `customer:${customerId}`;

  // Get customer profile
  const data = await client.hGetAll(key);

  if (Object.keys(data).length === 0) {
    console.log('⚠️ Customer not found\n');
    return;
  }

  // Get all order IDs
  const orderIds = await client.lRange(`customer:${customerId}:orders`, 0, -1);

  // Fetch only pending orders
  const orders = await Promise.all(
    orderIds.map(async (orderId) => {
      const orderData = await client.hGetAll(orderId);

      // Filter condition
      if (orderData.status === 'pending') {
        return {
          order_id: orderId,
          ...orderData
        };
      }

      return null;
    })
  );

  // Remove null values (non-pending orders)
  data.orders = orders.filter(order => order !== null);

  console.log('📦 Customer Pending Orders:\n', JSON.stringify(data, null, 2), '\n');
}

// Increment Loyalty
async function incrementLoyalty() {
  const customerId = readline.question('Enter Customer ID: ');
  const points = readline.questionInt('Enter points to add: ');

  const key = `customer:${customerId}`;

  await client.hIncrBy(key, 'loyalty_points', points);
  console.log('⭐ Loyalty points updated\n');
}

// Menu
async function menu() {
  while (true) {
    console.log('==== Redis Cafe Menu ====');
    console.log('1. Add/Update Customer');
    console.log('2. Get Customer');
    console.log('3. Add Loyalty Points');
    console.log('4. Exit');

    const choice = readline.question('Choose option: ');

    switch (choice) {
      case '1':
        await upsertCustomer();
        break;
      case '2':
        await getCustomer();
        break;
      case '3':
        await incrementLoyalty();
        break;
      case '4':
        await client.quit();
        console.log('👋 Exiting...');
        process.exit(0);
      default:
        console.log('❌ Invalid choice\n');
    }
  }
}

// Run app
(async () => {
  await connectRedis();
  await menu();
})();
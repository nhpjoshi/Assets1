const redis = require('redis');
const readline = require('readline-sync');

const client = redis.createClient({
  socket: { host: '127.0.0.1', port: 6379 }
});

client.on('error', (err) => console.error('❌ Redis Error:', err));

async function connectRedis() {
  await client.connect();
  console.log('✅ Connected to Redis\n');
}

// 🔹 Create Order + Push to Queue
async function createOrder() {
  const customerId = readline.question('Enter Customer ID: ');

  const orderNumber = await client.incr('order:counter');
  const orderId = `order:'Order_'${orderNumber}`;

  const drink = readline.question('Enter drink: ');
  const size = readline.question('Enter size: ');

  await client.hSet(orderId, {
    customer_id: customerId,
    drink,
    size,
    status: 'pending',
    timestamp: Date.now()
  });

  const queueKey = `customer:${customerId}:orders`;
  await client.lPush(queueKey, orderId);

  console.log(`✅ Order created: ${orderId}\n`);
}

// 🔹 View Orders (LRANGE)
async function viewCustomerOrders() {
  const customerId = readline.question('Enter Customer ID: ');
  const key = `customer:${customerId}:orders`;

  const orders = await client.lRange(key, 0, -1);

  if (orders.length === 0) {
    console.log('⚠️ No orders found\n');
    return;
  }

  console.log(`📦 Orders in queue:`, orders, '\n');
}

// 🔹 Process Order (LPOP + update counter + leaderboard)
async function processCustomerOrder() {
  const customerId = readline.question('Enter Customer ID: ');
  const key = `customer:${customerId}:orders`;

  const orderId = await client.lPop(key);

  if (!orderId) {
    console.log('⚠️ No orders to process\n');
    return;
  }

  const orderDetails = await client.hGetAll(orderId);

  console.log('☕ Processing Order:', orderId);
  console.log(orderDetails, '\n');

  // Update status
  await client.hSet(orderId, 'status', 'completed');

  const drink = orderDetails.drink;

  // 🔥 Increment per-drink counter
  await client.incr(`drink:${drink}:count`);

  // 🔥 Update leaderboard
  await client.zIncrBy('leaderboard:drinks', 1, drink);

  console.log(`📊 Updated counter + leaderboard for ${drink}\n`);
}

// 🔹 View Leaderboard
async function viewLeaderboard() {
  const result = await client.zRangeWithScores('leaderboard:drinks', 0, -1, {
    REV: true
  });

  if (result.length === 0) {
    console.log(' No leaderboard data\n');
    return;
  }

  console.log('\n Top Selling Drinks (Descending):');

  for (const item of result) {
    console.log(`${item.value} → ${item.score} sales`);
  }

  console.log('');
}
// 🔹 Get Individual Drink Count
async function getDrinkCount() {
  const drink = readline.question('Enter drink name: ');

  const count = await client.get(`drink:${drink}:count`);

  console.log(` ${drink} sold: ${count || 0}\n`);
}

// 🔹 Menu
async function menu() {
  while (true) {
    console.log('==== Redis Cafe ====');
    console.log('1. Create Order (LPUSH)');
    console.log('2. View Orders (LRANGE)');
    console.log('3. Process Order (LPOP)');
    console.log('4. View Leaderboard');
    console.log('5. Get Drink Count');
    console.log('6. Exit');

    const choice = readline.question('Choose option: ');

    switch (choice) {
      case '1':
        await createOrder();
        break;
      case '2':
        await viewCustomerOrders();
        break;
      case '3':
        await processCustomerOrder();
        break;
      case '4':
        await viewLeaderboard();
        break;
      case '5':
        await getDrinkCount();
        break;
      case '6':
        await client.quit();
        console.log('👋 Exiting...');
        process.exit(0);
      default:
        console.log('❌ Invalid choice\n');
    }
  }
}

// 🔹 Run App
(async () => {
  await connectRedis();
  await menu();
})();
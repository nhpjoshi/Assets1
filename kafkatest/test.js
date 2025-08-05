const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "iot-client",
  brokers: ["34.31.13.135:9092"],
});

const topic = "topic_IoT";

const startProducer = async (producer) => {
  await producer.connect();
  console.log("🚀 Producer connected");

  setInterval(async () => {
    const message = {
      key: "device1",
      value: JSON.stringify({
        temperature: (Math.random() * 100).toFixed(2),
        timestamp: new Date().toISOString(),
      }),
    };

    try {
      await producer.send({
        topic,
        messages: [message],
      });
      console.log("✅ Sent:", message.value);
    } catch (err) {
      console.error("❌ Error sending message:", err);
    }
  }, 15000); // 15 seconds
};

const startConsumer = async (consumer) => {
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  console.log("📡 Consumer connected, listening...");

  await consumer.run({
    eachMessage: async ({ message }) => {
      console.log(
        `📥 Received: ${message.key?.toString()} => ${message.value?.toString()}`
      );
    },
  });
};

const run = async () => {
  const producer = kafka.producer();
  const consumer = kafka.consumer({ groupId: "iot-consumer-group" });

  await startProducer(producer);
  await startConsumer(consumer);
};

run().catch((e) => {
  console.error("❌ Error in Kafka client:", e);
});

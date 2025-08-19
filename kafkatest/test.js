const { Kafka, logLevel } = require("kafkajs");

// === CONFIG ===
const BROKERS = ["34.31.13.135:9092"];
const TOPIC = "topic_IoT2";
const ENDIAN = "BE"; // "BE" for big-endian (C code style), "LE" for little-endian
const USERNAME = "brokerUser";
const PASSWORD = "brokerPass";

const kafka = new Kafka({
  clientId: "iot-client",
  brokers: BROKERS,
  ssl: false, // SASL_PLAINTEXT
  sasl: { mechanism: "plain", username: USERNAME, password: PASSWORD },
  logLevel: logLevel.INFO,
});

// Encode temp (°C) as int16 (hundredths) into a 2-byte Buffer
function encodeTemp(tempC) {
  const i16 = Math.max(-327.68, Math.min(327.67, tempC)); // clamp to int16/100 range
  const val = Math.round(i16 * 100); // e.g., 25.34°C -> 2534
  const buf = Buffer.alloc(2);
  if (ENDIAN === "BE") buf.writeInt16BE(val, 0);
  else buf.writeInt16LE(val, 0);
  return buf;
}

// Decode back (for consumer log)
function decodeTemp(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return null;
  const val = ENDIAN === "BE" ? buf.readInt16BE(0) : buf.readInt16LE(0);
  return val / 100;
}

const startProducer = async (producer) => {
  await producer.connect();
  console.log(
    `🚀 Producer connected (SASL/PLAIN) → ${TOPIC}, ${ENDIAN}-endian`
  );

  setInterval(async () => {
    const temp = +(Math.random() * 100).toFixed(2); // 0..100 °C
    const payload = encodeTemp(temp); // 2 bytes

    try {
      await producer.send({
        topic: TOPIC,
        messages: [
          {
            key: "device1",
            value: payload, // binary payload (2 bytes)
            headers: { ts: new Date().toISOString() }, // optional timestamp header
          },
        ],
      });
      console.log(
        `✅ Sent temp ${temp}°C as hex ${payload.toString("hex")} (${ENDIAN})`
      );
    } catch (err) {
      console.error("❌ Error sending message:", err);
    }
  }, 15000);
};

const startConsumer = async (consumer) => {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
  console.log("📡 Consumer connected (SASL/PLAIN), listening...");

  await consumer.run({
    eachMessage: async ({ partition, message }) => {
      const hex = message.value?.toString("hex");
      const decoded = decodeTemp(message.value);
      console.log(
        `[p${partition}] 📥 ${message.key?.toString()} => 0x${hex}  → ${decoded}°C (${ENDIAN})  ts=${message.headers?.ts?.toString()}`
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

run().catch((e) => console.error("❌ Kafka client error:", e));

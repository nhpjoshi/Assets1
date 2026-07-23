/**
 * Generates a synthetic but realistic supply chain dataset for the GraphRAG demo.
 *
 * Produces data/supplychainDataset.json with two top-level keys:
 *   - "nodes": list of entity documents (Supplier, Component, Product, Factory,
 *              Warehouse, DistributionCenter, Customer, Shipment, RiskEvent)
 *   - "edges": list of {from, to, type} relationship documents
 *
 * Run: node data/generateData.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "supplychainDataset.json");

const nodes = [];
const edges = [];

function addNode(id, type, name, attributes, text) {
  nodes.push({ _id: id, type, name, attributes, text });
}

function addEdge(from, to, type) {
  edges.push({ from, to, type });
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
const suppliers = [
  ["supplier_001", "Meridian Steel Works", "Germany", 1, 0.12,
    "Meridian Steel Works is a Tier-1 supplier of structural steel and aluminum " +
    "alloys based in Duisburg, Germany. Long-standing supplier with high reliability."],
  ["supplier_002", "Pacific Rubber Co", "Vietnam", 2, 0.28,
    "Pacific Rubber Co supplies synthetic rubber compounds for gaskets and seals, " +
    "based in Ho Chi Minh City, Vietnam. Tier-2 supplier feeding into component makers."],
  ["supplier_003", "Andes Lithium Group", "Chile", 1, 0.35,
    "Andes Lithium Group mines and refines lithium carbonate for battery production, " +
    "based in Antofagasta, Chile. Subject to periodic export regulation changes."],
  ["supplier_004", "Nexon Circuits", "Taiwan", 1, 0.42,
    "Nexon Circuits is a Tier-1 semiconductor and PCB supplier based in Hsinchu, " +
    "Taiwan. Supplies control boards to multiple product lines. Located in a " +
    "typhoon-prone coastal region."],
  ["supplier_005", "Baltic Glass Industries", "Poland", 2, 0.15,
    "Baltic Glass Industries manufactures tempered glass components, based in " +
    "Gdansk, Poland. Tier-2 supplier with stable output."],
  ["supplier_006", "Sahara Solar Materials", "Morocco", 2, 0.30,
    "Sahara Solar Materials produces photovoltaic-grade silicon wafers, based in " +
    "Casablanca, Morocco. Growing supplier for renewable energy product lines."],
  ["supplier_007", "Nippon Precision Motors", "Japan", 1, 0.10,
    "Nippon Precision Motors manufactures high-precision electric motors, based in " +
    "Nagoya, Japan. Tier-1 supplier known for exceptional quality control."],
  ["supplier_008", "Coastal Plastics Ltd", "Malaysia", 2, 0.33,
    "Coastal Plastics Ltd molds injection-plastic housings and enclosures, based in " +
    "Penang, Malaysia. Operates near the Port of Penang."],
];
for (const [sid, name, country, tier, risk, text] of suppliers) {
  addNode(sid, "Supplier", name, { country, tier, risk_score: risk }, text);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
const components = [
  ["component_001", "Structural Steel Frame", "supplier_001",
    "Structural Steel Frame: load-bearing chassis frame made of high-tensile steel."],
  ["component_002", "Rubber Gasket Seal", "supplier_002",
    "Rubber Gasket Seal: weatherproof synthetic rubber sealing component."],
  ["component_003", "Lithium Battery Cell", "supplier_003",
    "Lithium Battery Cell: rechargeable cell used in battery packs."],
  ["component_004", "Control Board PCB", "supplier_004",
    "Control Board PCB: main logic board with embedded microcontroller."],
  ["component_005", "Tempered Glass Panel", "supplier_005",
    "Tempered Glass Panel: impact-resistant glass panel for display housings."],
  ["component_006", "Photovoltaic Wafer", "supplier_006",
    "Photovoltaic Wafer: silicon wafer used in solar charging modules."],
  ["component_007", "Precision Drive Motor", "supplier_007",
    "Precision Drive Motor: brushless electric motor for mechanical actuation."],
  ["component_008", "Injection-Molded Housing", "supplier_008",
    "Injection-Molded Housing: outer plastic casing for device enclosures."],
  ["component_009", "Sensor Array Module", "supplier_004",
    "Sensor Array Module: multi-sensor board manufactured alongside control boards."],
];
for (const [cid, name, supplierId, text] of components) {
  addNode(cid, "Component", name, {}, text);
  addEdge(supplierId, cid, "SUPPLIES");
}

// ---------------------------------------------------------------------------
// Products (each uses several components)
// ---------------------------------------------------------------------------
const products = [
  ["product_001", "SolarCharge Portable Panel",
    ["component_006", "component_005", "component_008"],
    "SolarCharge Portable Panel: a foldable consumer solar charging device."],
  ["product_002", "UrbanMove E-Scooter",
    ["component_001", "component_007", "component_004", "component_003", "component_002"],
    "UrbanMove E-Scooter: an electric scooter for last-mile urban transport."],
  ["product_003", "HomeGuard Security Camera",
    ["component_004", "component_009", "component_008", "component_005"],
    "HomeGuard Security Camera: a smart home security camera with onboard sensors."],
  ["product_004", "PowerCell Battery Pack",
    ["component_003", "component_002", "component_008"],
    "PowerCell Battery Pack: a modular rechargeable battery pack for tools and devices."],
  ["product_005", "IndustriBot Actuator Arm",
    ["component_001", "component_007", "component_004", "component_009"],
    "IndustriBot Actuator Arm: a robotic arm module used in factory automation."],
];
for (const [pid, name, compIds, text] of products) {
  addNode(pid, "Product", name, {}, text);
  for (const cid of compIds) addEdge(cid, pid, "USED_IN");
}

// ---------------------------------------------------------------------------
// Factories (manufacture products)
// ---------------------------------------------------------------------------
const factories = [
  ["factory_001", "Rotterdam Assembly Plant", "Netherlands", ["product_002", "product_005"],
    "Rotterdam Assembly Plant: primary European assembly facility for mobility and " +
    "robotics product lines."],
  ["factory_002", "Shenzhen Electronics Plant", "China", ["product_003", "product_004"],
    "Shenzhen Electronics Plant: high-volume electronics assembly facility in " +
    "Guangdong province."],
  ["factory_003", "Austin Solar Fabrication", "USA", ["product_001"],
    "Austin Solar Fabrication: dedicated fabrication line for solar charging products."],
];
for (const [fid, name, country, productIds, text] of factories) {
  addNode(fid, "Factory", name, { country }, text);
  for (const pid of productIds) addEdge(pid, fid, "MANUFACTURED_AT");
}

// ---------------------------------------------------------------------------
// Warehouses & Distribution Centers
// ---------------------------------------------------------------------------
const warehouses = [
  ["warehouse_001", "Rotterdam Central Warehouse", "Netherlands", "factory_001",
    "Rotterdam Central Warehouse: regional storage hub for European-assembled goods."],
  ["warehouse_002", "Shenzhen Regional Warehouse", "China", "factory_002",
    "Shenzhen Regional Warehouse: storage and export hub for electronics products."],
  ["warehouse_003", "Austin Distribution Warehouse", "USA", "factory_003",
    "Austin Distribution Warehouse: storage hub for solar product exports."],
];
for (const [wid, name, country, factoryId, text] of warehouses) {
  addNode(wid, "Warehouse", name, { country }, text);
  addEdge(factoryId, wid, "STORED_AT");
}

const distributionCenters = [
  ["dc_001", "North America DC", "USA",
    "North America DC: final-mile distribution center serving US and Canada retailers."],
  ["dc_002", "Europe DC", "Germany",
    "Europe DC: final-mile distribution center serving EU retailers."],
  ["dc_003", "APAC DC", "Singapore",
    "APAC DC: final-mile distribution center serving Asia-Pacific retailers."],
];
for (const [did, name, country, text] of distributionCenters) {
  addNode(did, "DistributionCenter", name, { country }, text);
}

// Warehouses ship to distribution centers
addEdge("warehouse_001", "dc_002", "SHIPPED_TO");
addEdge("warehouse_002", "dc_003", "SHIPPED_TO");
addEdge("warehouse_002", "dc_001", "SHIPPED_TO");
addEdge("warehouse_003", "dc_001", "SHIPPED_TO");

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
const customers = [
  ["customer_001", "GreenGrid Retail", "USA", "dc_001",
    "GreenGrid Retail: large US retail chain carrying solar and battery products."],
  ["customer_002", "UrbanTransit GmbH", "Germany", "dc_002",
    "UrbanTransit GmbH: European mobility fleet operator purchasing e-scooters."],
  ["customer_003", "SecureHome Asia", "Singapore", "dc_003",
    "SecureHome Asia: APAC smart-home distributor carrying security cameras."],
  ["customer_004", "FactoryTech Automation", "USA", "dc_001",
    "FactoryTech Automation: industrial automation integrator purchasing robotic arms."],
];
for (const [cuid, name, country, dcId, text] of customers) {
  addNode(cuid, "Customer", name, { country }, text);
  addEdge(dcId, cuid, "SUPPLIES_CUSTOMER");
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------
const shipments = [
  ["shipment_001", "component_004", "factory_001", "delayed",
    "Shipment of control board PCBs from Nexon Circuits to Rotterdam Assembly Plant, " +
    "currently delayed."],
  ["shipment_002", "component_003", "factory_002", "in_transit",
    "Shipment of lithium battery cells from Andes Lithium Group to Shenzhen " +
    "Electronics Plant, currently in transit."],
  ["shipment_003", "warehouse_002", "dc_001", "delayed",
    "Shipment of finished goods from Shenzhen Regional Warehouse to North America DC, " +
    "delayed due to a port strike."],
  ["shipment_004", "component_006", "factory_003", "on_time",
    "Shipment of photovoltaic wafers from Sahara Solar Materials to Austin Solar " +
    "Fabrication, on schedule."],
];
for (const [sid, fromId, toId, status, text] of shipments) {
  addNode(sid, "Shipment", sid, { status }, text);
  addEdge(fromId, sid, "SHIPPED_VIA");
  addEdge(sid, toId, "ARRIVES_AT");
}

// ---------------------------------------------------------------------------
// Risk events
// ---------------------------------------------------------------------------
const riskEvents = [
  ["risk_event_001", "Typhoon near Hsinchu, Taiwan", ["supplier_004"], "severe",
    "A category-4 typhoon is forecast to make landfall near Hsinchu, Taiwan within " +
    "72 hours, threatening operations at semiconductor and PCB suppliers in the region, " +
    "including Nexon Circuits."],
  ["risk_event_002", "Port of Shenzhen labor strike", ["warehouse_002"], "moderate",
    "A labor strike at the Port of Shenzhen is delaying outbound container shipments " +
    "from the Shenzhen Regional Warehouse by an estimated 5-7 days."],
  ["risk_event_003", "Chilean lithium export quota change", ["supplier_003"], "moderate",
    "Chile has announced new export quotas on lithium carbonate, potentially " +
    "constraining supply from Andes Lithium Group over the next quarter."],
];
for (const [rid, name, affectedIds, severity, text] of riskEvents) {
  addNode(rid, "RiskEvent", name, { severity }, text);
  for (const aid of affectedIds) addEdge(rid, aid, "AFFECTS");
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
const dataset = { nodes, edges };
fs.writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2));

console.log(`Generated ${nodes.length} nodes and ${edges.length} edges -> ${OUT_PATH}`);

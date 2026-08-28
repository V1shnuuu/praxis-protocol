const fs = require("fs");
const path = require("path");

const ADDRESS_FILE = path.resolve(__dirname, "..", "..", "deployed-addresses.json");

/** Reads the address book written by scripts/deploy.js for a given network. */
function loadDeployment(networkName) {
  if (!fs.existsSync(ADDRESS_FILE)) {
    throw new Error(`${ADDRESS_FILE} not found. Deploy first: npm run deploy:amoy`);
  }
  const book = JSON.parse(fs.readFileSync(ADDRESS_FILE, "utf8"));
  const record = book[networkName];
  if (!record) {
    throw new Error(
      `No deployment recorded for network "${networkName}". Available: ${Object.keys(book).join(", ") || "none"}`
    );
  }
  return record;
}

module.exports = { loadDeployment, ADDRESS_FILE };

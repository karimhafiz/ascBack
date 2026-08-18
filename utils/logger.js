require("dotenv").config();
const logger = require("pino")({ level: process.env.LOGGER_LEVEL || "error" });

module.exports = logger;

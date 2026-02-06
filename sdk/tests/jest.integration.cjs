const path = require("node:path");

module.exports = {
  rootDir: path.resolve(__dirname, ".."),
  testEnvironment: "node",
  roots: ["<rootDir>/tests/integration"],
  transform: {
    "^.+\\.js$": ["babel-jest", { presets: ["@babel/preset-env"] }]
  },
  setupFilesAfterEnv: [],
  testTimeout: 30000
};

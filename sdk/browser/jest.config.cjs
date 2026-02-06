module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup-globals.js"],
  transform: {
    "^.+\\.js$": ["babel-jest", { presets: ["@babel/preset-env"] }]
  },
  transformIgnorePatterns: ["/node_modules/(?!nanoid)/"]
};

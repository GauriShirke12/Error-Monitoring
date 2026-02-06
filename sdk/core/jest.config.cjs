module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  transform: {
    "^.+\\.js$": ["babel-jest", { presets: ["@babel/preset-env"] }]
  }
};

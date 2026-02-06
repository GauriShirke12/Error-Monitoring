const path = require("node:path");

module.exports = {
  mode: "production",
  entry: path.resolve(__dirname, "src", "index.js"),
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "error-monitor.browser.js",
    library: {
      name: "ErrorMonitor",
      type: "umd"
    },
    globalObject: "this",
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [["@babel/preset-env", { targets: ">0.5%, not dead", modules: false }]]
          }
        }
      }
    ]
  },
  resolve: {
    alias: {
      "@error-monitor/sdk-core": path.resolve(__dirname, "../core/src/index.js")
    }
  },
  optimization: {
    minimize: true
  }
};

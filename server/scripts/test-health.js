const http = require('http');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const createApp = require('../src/app');
const { connectDatabase } = require('../src/config/database');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const run = async () => {
  const app = createApp();
  let server;

  try {
    await connectDatabase();

    server = app.listen(0, () => {
      const { port } = server.address();

      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log('Health response status:', res.statusCode);
          console.log('Health response body:', data);
          server.close();
          mongoose.disconnect();
        });
      }).on('error', (err) => {
        console.error('Health request failed', err);
        server.close();
        mongoose.disconnect();
        process.exitCode = 1;
      });
    });
  } catch (error) {
    console.error('Health test failed', error);
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
    process.exitCode = 1;
  }
};

run();

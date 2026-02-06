const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const crypto = require('crypto');

const { connectDatabase } = require('../src/config/database');
const ErrorEvent = require('../src/models/Error');
const Project = require('../src/models/Project');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const run = async () => {
  try {
    await connectDatabase();
    console.log('Connected to MongoDB');

    const project = await Project.create({
      name: 'db-test-project',
      apiKey: crypto.randomBytes(12).toString('hex'),
    });

    const samplePayload = {
      message: 'TypeError: Cannot read properties of undefined',
      stackTrace: [
        {
          file: 'App.js',
          line: 42,
          column: 13,
          function: 'handleSubmit',
          inApp: true,
        },
      ],
      fingerprint: 'demo:TypeError:App.js:42',
      environment: 'development',
      metadata: {
        release: '1.0.0',
        user: { id: 'user-123' },
      },
      projectId: project._id,
    };

    const created = await ErrorEvent.create(samplePayload);
    console.log('Created error event', created.id);

    const fetched = await ErrorEvent.findOne({ fingerprint: samplePayload.fingerprint, projectId: project._id });
    console.log('Fetched message', fetched.message);

    fetched.count += 1;
    await fetched.save();
    console.log('Incremented count to', fetched.count);

    await ErrorEvent.deleteMany({ fingerprint: samplePayload.fingerprint, projectId: project._id });
    await Project.deleteOne({ _id: project._id });
    console.log('Cleaned up test documents');
  } catch (error) {
    console.error('Database test failed', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();

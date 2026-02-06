const mongoose = require('mongoose');

const connectDatabase = async () => {
  const uri = process.env.MONGODB_URI;
  const minPoolSize = Number.isFinite(Number(process.env.DB_MIN_POOL_SIZE))
    ? Number(process.env.DB_MIN_POOL_SIZE)
    : 10;
  const maxPoolSize = Number.isFinite(Number(process.env.DB_MAX_POOL_SIZE))
    ? Number(process.env.DB_MAX_POOL_SIZE)
    : 50;
  const queryMaxTimeMs = Number.isFinite(Number(process.env.DB_QUERY_MAX_TIME_MS))
    ? Number(process.env.DB_QUERY_MAX_TIME_MS)
    : 5000;

  if (!uri) {
    throw new Error('MONGODB_URI is not defined');
  }

  try {
    // Apply default maxTimeMS to all queries/aggregations for safety.
    mongoose.set('maxTimeMS', queryMaxTimeMs);

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      minPoolSize: Math.max(0, minPoolSize),
      maxPoolSize: Math.max(minPoolSize, maxPoolSize),
      socketTimeoutMS: queryMaxTimeMs + 2000,
    });
    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection failed', error);
    throw error;
  }
};

module.exports = {
  connectDatabase,
};

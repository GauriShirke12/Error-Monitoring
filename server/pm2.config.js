module.exports = {
  apps: [
    {
      name: 'error-monitor-api',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
    },
    {
      name: 'error-monitor-worker',
      script: 'src/worker.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
    },
  ],
};

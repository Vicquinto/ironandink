module.exports = {
  apps: [
    {
      name:           'ironandink',
      script:         'server.js',

      // Wait for process.send('ready') before PM2 considers the app online.
      // Enables true zero-downtime with `pm2 reload ironandink`.
      wait_ready:     true,
      listen_timeout: 10000,  // ms to wait for 'ready' signal before giving up

      // Keep old process alive until new one is ready during graceful reload
      kill_timeout:   5000,

      // Restart policy
      max_restarts:   10,
      restart_delay:  1000,

      // Inherit the current environment (reads .env via dotenv in server.js)
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
